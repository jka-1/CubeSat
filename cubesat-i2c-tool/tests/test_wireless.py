"""Debug (Wireless) source: WirelessSession against the real bridge + synth_sender debug emulation for
all / subset / single / none device configurations, plus GUI wiring. Skips if node or the repos are missing."""
import os, shutil, socket, subprocess, time, json, pytest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from cubesat_i2c import protocol as P
from cubesat_i2c.registers import default_devices
from cubesat_i2c.session import run_sequence
from cubesat_i2c.wireless_session import WirelessSession, format_detect

REPO = os.environ.get("CUBESAT_REPO", str(__import__("pathlib").Path(__file__).resolve().parents[2]))
TOOLS = os.environ.get("CUBESAT_TOOLS", str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/tools/link-tools")
NODE = shutil.which("node")
need = pytest.mark.skipif(not (NODE and os.path.exists(os.path.join(REPO, "telemetry-bridge", "server.js"))
                               and os.path.exists(os.path.join(TOOLS, "synth_sender.mjs"))), reason="node/bridge/tools missing")
TOKEN = "wireless-test-token"


def free_port(kind=socket.SOCK_STREAM):
    s = socket.socket(socket.AF_INET, kind); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.fixture(scope="module")
def bridge():
    http, udp = free_port(), free_port(socket.SOCK_DGRAM)
    env = dict(os.environ, HTTP_PORT=str(http), UDP_PORT=str(udp), HTTP_BIND_ADDRESS="127.0.0.1",
               UDP_BIND_ADDRESS="127.0.0.1", COMMAND_TOKEN=TOKEN, TELEMETRY_STALE_MS="1500", COMMAND_TIMEOUT_MS="800")
    b = subprocess.Popen([NODE, os.path.join(REPO, "telemetry-bridge", "server.js")], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    yield "http://127.0.0.1:%d" % http, udp
    b.terminate(); b.wait(5)


def synth(udp, present, debug=True):
    args = [NODE, os.path.join(TOOLS, "synth_sender.mjs"), "--target", "127.0.0.1:%d" % udp, "--count", "0",
            "--period", "200", "--present", present] + (["--debug"] if debug else [])
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_health(sess, pred, timeout=4.0):
    end = time.time() + timeout
    while time.time() < end:
        h = sess.health()
        if pred(h): return h
        time.sleep(0.1)
    raise AssertionError("health condition not met: %s" % json.dumps(sess.health())[:400])


def reg(dev_addr, name):
    d = next(d for d in default_devices() if d["addr"] == dev_addr)
    return next(r for r in d["registers"] if name in r["name"])


CASES = [("all", {"pv", "bms", "mppt"}), ("pv,mppt", {"pv", "mppt"}), ("bms", {"bms"}), ("none", set())]
ADDR = {"pv": 0x40, "bms": 0x08, "mppt": 0x6B}


@need
@pytest.mark.parametrize("present,expected", CASES)
def test_configurations(bridge, present, expected):
    base, udp = bridge
    s = synth(udp, present)
    try:
        sess = WirelessSession.open(base, TOKEN)
        mask = sum(b for k, b in (("pv", 1), ("bms", 2), ("mppt", 4)) if k in expected)
        wait_health(sess, lambda h: h.get("telemetry_connected") and (h.get("debug_mode") or {}).get("present_mask") == mask)
        h, tiles = sess.presence()
        states = {k: st for k, _, _, st, _ in tiles}
        assert states == {k: ("present" if k in expected else "absent") for k in ADDR}
        assert sess.detect() == sorted(ADDR[k] for k in expected)
        # register read/convert through the unchanged Session.read_reg path
        if "pv" in expected:
            data, raw, val, txt = sess.read_reg(0x40, reg("0x40", "Manufacturer"))
            assert data == [0x54, 0x49] and raw == 0x5449
            assert sess.write_reg("0x40", "0x05", [0x0A, 0x00]) == "Write OK"
            assert sess.read_reg(0x40, reg("0x40", "Calibration"))[1] == 0x0A00
        else:
            with pytest.raises(IOError, match="Read failed: ESP_FAIL"):
                sess.read_reg(0x40, reg("0x40", "Manufacturer"))
            with pytest.raises(IOError):
                P.parse_set(sess.send("i2cset -c 0x40 -r 0x05 0x0a 0x00"))
        if "mppt" in expected:
            assert "PN=3" in sess.read_reg(0x6B, reg("0x6B", "Part Information"))[3]
        assert "present" in sess.send("probe 0x08") if "bms" in expected else "no ACK" in sess.send("probe 0x08")
        # sequence runner unchanged
        res = run_sequence(sess, ["i2cconfig --scl=2 --sda=1", "debug on", "scan_period 300", "delay 10", "i2cdetect",
                                  "i2cget -c 0x08 -r 0x14 -l 2"], sleep=lambda s: None)
        oks = [r[1] for r in res]
        assert oks[:5] == [True] * 5 and oks[5] == ("bms" in expected)
        wait_health(sess, lambda h: (h.get("debug_mode") or {}).get("scan_period_ms") == 300)
    finally:
        s.terminate(); s.wait(5); time.sleep(1.7)  # let the bridge go stale before the next configuration


@need
def test_debug_toggle_and_rejections(bridge):
    base, udp = bridge
    s = synth(udp, "all", debug=False)
    try:
        sess = WirelessSession.open(base, TOKEN)
        wait_health(sess, lambda h: h.get("telemetry_packet_format") == "hex-v4-peripheral-sensors" and h.get("telemetry_connected"))
        assert sess.presence()[1][0][3] == "unknown"
        assert sess.send("debug on").startswith("Debug mode ON")
        wait_health(sess, lambda h: h.get("telemetry_packet_format") in ("hex-v5-debug", "hex-v6-streaming"))
        assert "failed" in sess.send("scan_period 100")           # bridge 400 (bounded 200..5000)
        assert P.is_error(sess.send("i2cdump -c 0x40"))
        bad = WirelessSession.open(base, "wrong-token")
        assert "HTTP 401" in bad.send("i2cdetect")
        assert sess.send("debug off").startswith("Debug mode OFF")
        wait_health(sess, lambda h: h.get("telemetry_packet_format") == "hex-v4-peripheral-sensors")
    finally:
        s.terminate(); s.wait(5); time.sleep(1.7)


def test_format_detect_roundtrip():
    assert P.parse_detect(format_detect(["0x08", "0x40", "0x6B"])) == [0x08, 0x40, 0x6B]
    assert P.parse_detect(format_detect([])) == []


@need
def test_gui_wireless_source(bridge, tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication, QMessageBox
    from cubesat_i2c.gui import MainWindow
    base, udp = bridge
    s = synth(udp, "pv,mppt")
    app = QApplication.instance() or QApplication([])
    try:
        w = MainWindow()
        w.source.setCurrentIndex(1)
        assert w.wireless_box.isVisibleTo(w) and not w.serial_box.isVisibleTo(w)
        w.bridge_url.setText(base); w.bridge_token.setText(TOKEN)
        time.sleep(1.0)
        w.toggle_wireless()
        assert isinstance(w.session, WirelessSession)
        end = time.time() + 5
        while time.time() < end and "Absent" not in w.ptiles["bms"][0].text():
            app.processEvents(); time.sleep(0.05)
        assert "Present" in w.ptiles["pv"][0].text() and "Absent" in w.ptiles["bms"][0].text()
        w.period.setValue(450); w.wireless_cmd("scan_period %d" % w.period.value())
        assert "Scan period 450 ms" in w.term.toPlainText()
        # Registers page over the bridge
        w.dev.setCurrentIndex(w.dev.findText("INA226"))
        w.reg.setCurrentIndex([r["name"] for r in w.cur_dev()["registers"]].index("Manufacturer ID"))
        w.read_one()
        assert "0x5449" in w.result.text()
        w.dev.setCurrentIndex(w.dev.findText("BMS (BQ76942)")); w.reg.setCurrentIndex(0); w.read_one()
        assert "ERROR" in w.result.text() and "ESP_FAIL" in w.result.text()
        w.toggle_wireless(); assert w.session is None
        w.source.setCurrentIndex(0)
        assert w.serial_box.isVisibleTo(w)
        w.close()
    finally:
        s.terminate(); s.wait(5)
