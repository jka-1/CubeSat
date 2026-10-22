"""Streaming Telemetry (app): Python port of the shared model on the same fixtures as the JS unit tests
(present-only for all/subset/single/none, v4 + v5, stale/skew/dedupe), plus the tab against the real bridge."""
import copy, datetime, json, os, shutil, socket, subprocess, time, pytest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from cubesat_i2c.streaming_model import StreamingModel, device_visibility, decode_devices, fmt_si
from cubesat_i2c.link_source import parse_iso_ms

FX = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "streaming-envelopes.json")))
T0 = parse_iso_ms(FX["v5_all"]["received_at"])


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def at(env, ms):
    e = copy.deepcopy(env); e["received_at"] = iso(ms); return e


def status(ms, **extra):
    return dict({"type": "status", "server_time": iso(ms), "telemetry_stale_after_ms": 5000, "telemetry_connected": True}, **extra)


CASES = [("all", ["pv", "bms", "mppt"]), ("subset_pv_mppt", ["pv", "mppt"]), ("single_bms", ["bms"]), ("none", [])]


@pytest.mark.parametrize("fmt", ["v4", "v5"])
@pytest.mark.parametrize("name,expected", CASES)
def test_present_only(fmt, name, expected):
    m = StreamingModel()
    m.ingest(status(T0), T0)
    assert m.ingest(at(FX["%s_%s" % (fmt, name)], T0), T0)
    s = m.snapshot(T0 + 100)
    assert [d["key"] for d in s["devices"]] == expected
    assert sorted(h["key"] for h in s["hidden"]) == sorted(k for k in ("pv", "bms", "mppt") if k not in expected)
    assert all(h["state"] == ("absent" if fmt == "v5" else "not_polled") for h in s["hidden"])
    assert all(d["source"] == ("v5" if fmt == "v5" else "polling-mask") for d in s["devices"])
    assert s["stale"] is False and s["mcu"]["tempC"] == 26 and s["peripheral"]["relativeLightLevel"] == 0.5
    for k, sk in (("pv", "pv.currentA"), ("bms", "bms.cell0"), ("mppt", "mppt.faults")):
        assert (m.series[sk][-1][1] is None) == (k not in expected), k


def test_conversions_match_js():
    d = decode_devices(FX["v5_all"]["packet"])
    assert d["pv"]["busV"] == 4003 * 0.00125
    assert [c["label"] for c in d["bms"]["cells"]] == ["Cell 1", "Cell 2", "Cell 3", "Cell 4"]
    assert (d["bms"]["minV"], d["bms"]["maxV"], d["bms"]["deltaMv"], d["bms"]["packV"]) == (3.676, 3.813, 137, None)
    assert (d["mppt"]["acdrv"], d["mppt"]["reg13"], len(d["mppt"]["faults"]), d["mppt"]["activeFaults"]) == ("acdrv1", 0x61, 8, 0)
    assert d["mppt"]["vbusV"] is None and d["mppt"]["vbatV"] is None
    p = copy.deepcopy(FX["v4_all"]["packet"]); p["raw"]["mppt"]["fault20"] = 0b10000101
    assert [f["name"] for f in decode_devices(p)["mppt"]["faults"] if f["active"]] == ["VAC1_OVP_STAT", "CONV_OCP_STAT", "BAT_REG_STAT"]


def test_timeout_and_legacy():
    v = device_visibility(FX["v5_pv_timeout"]["packet"])
    assert (v["pv"]["state"], v["pv"]["visible"], v["bms"]["visible"], v["mppt"]["visible"]) == ("error", False, True, True)
    legacy = {"packet_format": "hex-v2-engineering",
              "telemetry": {"pv": {}, "bms": {"cellVoltagesV": [4, 4, 4, 4]}, "mppt": {"switchState": "on", "faults": []}}}
    assert all(x["source"] == "assumed" and x["visible"] for x in device_visibility(legacy).values())


def test_stale_skew_dedupe_window():
    m = StreamingModel()
    skew = 7000                                   # client clock 7 s ahead of the server
    m.ingest(status(T0), T0 + skew)
    assert m.ingest(at(FX["v5_all"], T0), T0 + skew)
    assert not m.ingest(at(FX["v5_all"], T0), T0 + skew)        # SSE replay of the same envelope
    assert m.age_ms(T0 + skew + 200) == 200 and not m.is_stale(T0 + skew + 200)
    s = m.snapshot(T0 + skew + 6000)
    assert s["stale"] and all(d["state"] == "stale" for d in s["devices"])
    m.ingest(status(T0, telemetry_stale_after_ms=1500), T0 + skew)
    assert m.is_stale(T0 + skew + 1600)
    for i in range(1, 5):
        e = at(FX["v5_all"], T0 + i * 60_000); e["packet"] = dict(e["packet"], seq=100 + i); m.ingest(e, T0 + skew + i * 60_000)
    w = m.series_window("pv.busV", 120_000, T0 + skew + 4 * 60_000)
    assert len(w["points"]) == 3
    assert fmt_si(0.0000008, "A") == "0.8 µA" and fmt_si(0.0123, "W") == "12.30 mW" and fmt_si(1.5, "A") == "1.500 A"


# ------------------------------------------------------------------ real bridge + synth_sender
REPO = os.environ.get("CUBESAT_REPO", str(__import__("pathlib").Path(__file__).resolve().parents[2]))
TOOLS = os.environ.get("CUBESAT_TOOLS", str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/tools/link-tools")
NODE = shutil.which("node")
need = pytest.mark.skipif(not (NODE and os.path.exists(os.path.join(REPO, "telemetry-bridge", "server.js"))
                               and os.path.exists(os.path.join(TOOLS, "synth_sender.mjs"))), reason="node/bridge/tools missing")


def free_port(kind=socket.SOCK_STREAM):
    s = socket.socket(socket.AF_INET, kind); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.fixture(scope="module")
def bridge():
    http, udp = free_port(), free_port(socket.SOCK_DGRAM)
    env = dict(os.environ, HTTP_PORT=str(http), UDP_PORT=str(udp), HTTP_BIND_ADDRESS="127.0.0.1",
               UDP_BIND_ADDRESS="127.0.0.1", COMMAND_TOKEN="stream-test", TELEMETRY_STALE_MS="1500")
    b = subprocess.Popen([NODE, os.path.join(REPO, "telemetry-bridge", "server.js")], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    yield "http://127.0.0.1:%d" % http, udp
    b.terminate(); b.wait(5)


def wait(app, pred, timeout=6.0):
    end = time.time() + timeout
    while time.time() < end:
        app.processEvents()
        if pred(): return True
        time.sleep(0.05)
    return False


SHOTS = os.environ.get("STREAM_SHOTS")   # e.g. ./screens -> saves stream-app-<case>.png


@need
@pytest.mark.parametrize("present,expected", [("all", ["pv", "bms", "mppt"]), ("pv,mppt", ["pv", "mppt"]),
                                              ("bms", ["bms"]), ("none", [])])
@pytest.mark.parametrize("debug", [True, False])
def test_tab_against_real_bridge(bridge, present, expected, debug, tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    from cubesat_i2c.gui import MainWindow
    base, udp = bridge
    app = QApplication.instance() or QApplication([])
    s = subprocess.Popen([NODE, os.path.join(TOOLS, "synth_sender.mjs"), "--target", "127.0.0.1:%d" % udp, "--count", "0",
                          "--period", "150", "--present", present, "--wiggle"] + (["--debug"] if debug else []),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        w = MainWindow(); w.resize(1280, 820)
        w.tabs.setCurrentWidget(w.stream_page); w.show()
        pg = w.stream_page
        pg.start(base, True)
        fmt = "hex-v6-streaming" if debug else "hex-v4-peripheral-sensors"   # debug firmware now streams v6
        ok = wait(app, lambda: (pg.refresh() or True) and pg.model.packets > 8 and
                  (pg.model.latest or {}).get("packet", {}).get("packet_format") == fmt)
        assert ok, "no %s packets" % fmt
        snap = pg.model.snapshot()
        assert [d["key"] for d in snap["devices"]] == expected
        assert pg._layout_key == tuple(expected + ["mcu", "peripheral"])
        assert all(pg.cards[k].isVisible() == (k in pg._layout_key) for k in pg.cards)
        assert "LIVE" in pg.indicator.text()
        if "pv" in expected:
            assert pg.cards["pv"].rows["busV"][0].text().endswith(" V")
        if "bms" in expected:
            if debug:   # v6: measured pack voltage / internal temperature
                assert pg.cards["bms"].rows["packV"][0].text() == "14.98 V" or pg.cards["bms"].rows["packV"][0].text().endswith(" V")
                assert pg.cards["bms"].rows["intTempC"][0].text().endswith(" °C")
            else:
                assert "need v6 firmware" not in pg.cards["bms"].summary.text()
                assert pg.cards["bms"].rows["packV"][0].text() == "--"
        if "mppt" in expected and debug:
            assert pg.cards["mppt"].rows["vbusV"][0].text().endswith(" V") and "VAC1" in pg.cards["mppt"].vb.text()
        assert pg.hidden_lbl.isVisible() == (len(expected) < 3)
        if SHOTS:
            time.sleep(1.5); wait(app, lambda: False, 0.6); pg.refresh(); app.processEvents()
            w.grab().save(os.path.join(SHOTS, (os.environ.get("SHOT_PREFIX", "stream-app-") + "%s%s.png") % (present.replace(",", "-"), "" if debug else "-v4")))
        s.terminate(); s.wait(5)
        assert wait(app, lambda: (pg.refresh() or True) and "STALE" in pg.indicator.text(), 5)
        assert all(pg.cards[k].stale for k in pg._layout_key)
        if SHOTS and present == "all" and debug:
            w.grab().save(os.path.join(SHOTS, "stream-app-stale.png"))
        pg.stop(); assert "OFF" in (pg.refresh() or pg.indicator.text())
        w.close()
    finally:
        if s.poll() is None: s.terminate(); s.wait(5)


@need
def test_wireless_connect_starts_streaming_tab(bridge, tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    from cubesat_i2c.gui import MainWindow
    base, udp = bridge
    app = QApplication.instance() or QApplication([])
    s = subprocess.Popen([NODE, os.path.join(TOOLS, "synth_sender.mjs"), "--target", "127.0.0.1:%d" % udp, "--count", "0",
                          "--period", "150", "--present", "pv,mppt", "--debug"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        w = MainWindow(); w.source.setCurrentIndex(1); w.bridge_url.setText(base)
        time.sleep(0.8); w.toggle_wireless()
        assert w.stream_page.running() and w.stream_page.url.text() == base
        assert wait(app, lambda: (w.stream_page.refresh() or True) and w.stream_page._layout_key == ("pv", "mppt", "mcu", "peripheral"))
        w.toggle_wireless(); assert not w.stream_page.running()
        w.close()
    finally:
        s.terminate(); s.wait(5)


@pytest.mark.parametrize("name,expected", [("all", ["pv", "bms", "mppt"]), ("subset_pv_mppt", ["pv", "mppt"]),
                                           ("single_bms", ["bms"]), ("none", [])])
def test_v6_streaming_fields(name, expected):
    m = StreamingModel()
    m.ingest(status(T0), T0)
    assert m.ingest(at(FX["v6_%s" % name], T0), T0)
    s = m.snapshot(T0 + 100)
    assert s["format"] == "hex-v6-streaming"
    assert [d["key"] for d in s["devices"]] == expected
    d = decode_devices(FX["v6_%s" % name]["packet"])
    if "pv" in expected:
        assert d["pv"]["busV"] == 5.00375 and d["pv"]["currentMa"] is not None and d["pv"]["powerMw"] is not None
    else:
        assert d["pv"]["busV"] is None
    if "bms" in expected:
        assert [c["label"] for c in d["bms"]["cells"]] == ["Cell 1", "Cell 2", "Cell 3", "Cell 4"]
        assert (d["bms"]["packV"], d["bms"]["intTempC"]) == (14.98, 24.75)
    else:
        assert (d["bms"]["packV"], d["bms"]["intTempC"]) == (None, None)
    path = [d["mppt"][k] for k in ("vbusV", "vac1V", "vbatV", "vsysV", "ibusMa", "dieTempC")]
    assert path == ([5.024, 5.04, 14.553, 12.806, 250, 19] if "mppt" in expected else [None] * 6)
    assert s["adc"]["temp"]["mv"] == 750 and s["adc"]["temp"]["gpio"] == 1 and s["adc"]["light"]["gpio"] == 2



def test_light_levels_and_mcp9700():
    from cubesat_i2c.streaming_model import light_level_from_mv, mcp9700_temp_c_from_mv, LIGHT_BRIGHT_MIN_MV, LIGHT_VERY_BRIGHT_MIN_MV
    assert (LIGHT_BRIGHT_MIN_MV, LIGHT_VERY_BRIGHT_MIN_MV) == (800, 1800)
    assert [light_level_from_mv(v) for v in (0, 799, 800, 1517, 1800, 1801, 3300)] == [
        "Lightly Lit", "Lightly Lit", "Bright", "Bright", "Bright", "Very Bright", "Very Bright"]
    assert light_level_from_mv(None) is None
    assert mcp9700_temp_c_from_mv(750) == 25 and mcp9700_temp_c_from_mv(500) == 0
    d = decode_devices(FX["v6_all"]["packet"])
    assert d["adc"]["light"]["level"] == "Bright" and d["adc"]["light"]["mv"] == 1550


def test_pv_current_from_raw_registers_and_cal():
    # Live bench words: CAL 0x0A00, 0x04 current 81, 0x03 power 26, 0x02 bus 6308 -> 81 mA like the Registers tab,
    # even if an old bridge sent currentA decoded with a 100 ohm shunt (1.62 uA).
    from cubesat_i2c.streaming_model import ina226_current_lsb_a
    assert abs(ina226_current_lsb_a(0x0A00) - 0.001) < 1e-12
    from cubesat_i2c import streaming_model as sm
    fn = sm.decode_devices
    pkt = {"telemetry": {"pv": {"currentA": 0.00000162, "powerW": 0.000013, "busVoltageV": 7.885}},
           "raw": {"pv": {"calibration": 2560, "shunt": 65, "bus": 6308, "power": 26, "current": 81}}}
    d = fn(pkt)
    assert d["pv"]["currentA"] == 0.081 and d["pv"]["currentMa"] == 81.0
    assert abs(d["pv"]["powerW"] - 0.65) < 1e-9 and d["pv"]["busV"] == 7.885
