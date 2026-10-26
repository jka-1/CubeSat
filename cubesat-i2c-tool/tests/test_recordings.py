"""Recordings tab (telemetry-recording branch /runs API): pure model helpers, WirelessSession request shape,
and an end-to-end run against the real bridge with RECORDING_DB_PATH + synth_sender. The e2e part skips if
node, the bridge dependencies (better-sqlite3) or the tools are missing."""
import io, json, os, shutil, socket, subprocess, tempfile, time, csv, pytest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from pathlib import Path
from cubesat_i2c import runs_model as M
from cubesat_i2c.wireless_session import WirelessSession

ROOT = Path(__file__).resolve().parents[2]
REPO = os.environ.get("CUBESAT_REPO", str(ROOT))
TOOLS = os.environ.get("CUBESAT_TOOLS", str(ROOT / "tools" / "link-tools"))
NODE = shutil.which("node")
TOKEN = "recordings-test-token"


# ------------------------------------------------------------------ model
def test_metric_allowlist_matches_bridge_store():
    store = (Path(REPO) / "telemetry-bridge" / "recording" / "store.mjs")
    if not store.exists(): pytest.skip("bridge sources missing")
    text = store.read_text(encoding="utf-8")
    for mid in M.METRIC_IDS:
        assert "'%s'" % mid in text, mid


def test_csv_cell_neutralises_formulas_and_blank_none():
    assert M.csv_cell("=SUM(A1)") == "'=SUM(A1)" and M.csv_cell("-1") == "'-1" and M.csv_cell("@x") == "'@x"
    assert M.csv_cell(None) == "" and M.csv_cell(1.5) == 1.5 and M.csv_cell("ok") == "ok"


def test_series_segments_keep_gaps_and_summary_ignores_nulls():
    pts = [{"start_ms": i * 100, "end_ms": i * 100 + 100, "mean": 1.0 + i, "min": 1.0 + i, "max": 1.0 + i,
            "valid_count": 1, "sample_count": 1} for i in (0, 1, 2, 10, 11)]
    pts.append({"start_ms": 1300, "end_ms": 1400, "mean": None, "min": None, "max": None, "valid_count": 0, "sample_count": 2})
    segs = M.series_segments(pts)
    assert [len(s) for s in segs] == [3, 2]
    sm = M.series_summary(pts)
    assert sm["min"] == 1.0 and sm["max"] == 12.0 and sm["valid"] == 5 and sm["samples"] == 7
    assert M.series_summary([])["mean"] is None


def test_metric_value_cell_slot_and_missing():
    s = {"envelope": {"packet": {"telemetry": {"bms": {"cellVoltagesV": [3.7, 3.8, 3.9, 4.0]}, "pv": {"currentA": None}}}}}
    assert M.metric_value(s, "bms.cellSlot4V") == 4.0 and M.metric_value(s, "bms.cell1V") == 3.7
    assert M.metric_value(s, "pv.currentA") is None and M.metric_value({}, "mppt.vbusV") is None


def test_run_rows_labels_and_window_presets():
    run = {"name": "Startup", "run_type": "live_telemetry", "status": "completed", "started_ms": 1_000_000,
           "ended_ms": 1_065_000, "sample_count": 65, "end_reason": "source_switch", "contains_debug": 1}
    row = M.run_row(run, 2_000_000)
    assert row[0] == "Startup" and row[1] == "Live telemetry + debug" and row[4] == "1m 5s" and row[6] == "Power source switched"
    live = dict(run, status="recording", ended_ms=None, current_source="bat_secondary")
    assert M.run_row(live, 1_010_000)[6] == "Source BAT/secondary"
    w = M.window_for_preset(run, "30s", 0); assert w["end"] - w["start"] == 30_000
    assert M.window_for_preset(run, "full", 0)["start"] == run["started_ms"]
    ev = M.event_row({"at_ms": 1_000_500, "type": "sequence_step", "details": {"sequence_name": "Boot", "step_number": 2,
                                                                                "step_text": "debug on", "phase": "completed", "ok": True}})
    assert ev[1] == "sequence step" and "Boot L2 debug on" in ev[2] and ev[2].endswith("OK")


def test_recording_note_only_when_unavailable():
    assert "not enabled" in M.recording_note({"recording": {"enabled": False}})
    assert M.recording_note({"recording": {"enabled": True, "ready": True}}) == ""


def test_export_csv_paginates_and_caps_rows():
    pages = {0: {"items": [{"received_ms": 1_700_000_000_000 + i, "seq": i, "raw_base64": "AA==", "envelope": {"packet": {"telemetry": {"pv": {"busVoltageV": 5.0}}}}}
                           for i in range(3)], "next_after": 3},
             3: {"items": [{"received_ms": 1_700_000_000_010, "seq": 9, "raw_base64": "=cmd", "envelope": {}}], "next_after": None}}
    buf = io.StringIO()
    n = M.export_csv(lambda a, b, after, lim: pages[after], "pv.busVoltageV", 0, 1, buf)
    rows = list(csv.reader(io.StringIO(buf.getvalue())))
    assert n == 4 and rows[0] == list(M.CSV_HEADER) and rows[1][7] == "5.0" and rows[4][8] == "'=cmd" and rows[4][7] == ""
    with pytest.raises(ValueError):
        M.export_csv(lambda a, b, after, lim: pages[after], "pv.busVoltageV", 0, 1, io.StringIO(), max_rows=2)


# ------------------------------------------------------------------ session request shape
def test_run_read_requests_carry_command_token_and_encode_ids():
    calls = []

    class R:
        def __init__(self, b): self.b = b
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps(self.b).encode()

    def opener(req, timeout):
        calls.append((req.full_url, dict(req.header_items())))
        return R({"runs": [], "recording": {"enabled": True, "ready": True, "active_run_id": "r/1"}, "run": {"id": "r/1"}, "items": []})

    s = WirelessSession("http://bridge.example:8080", token="tok", opener=opener)
    assert s.list_runs(10, 20)["runs"] == [] and s.active_run_id == "r/1"
    s.get_run("r/1"); s.run_events("r/1", 5, 50); s.run_samples("r/1", 1, 2, 0, 500); s.run_series("r/1", "pv.currentA", 1, 2, 100)
    urls = [u for u, _ in calls]
    assert urls[0].endswith("/runs?limit=10&offset=20") and urls[1].endswith("/runs/r%2F1")
    assert "/runs/r%2F1/events?after=5&limit=50" in urls[2] and "start=1&end=2&after=0&limit=500" in urls[3]
    assert "metric=pv.currentA" in urls[4] and "points=100" in urls[4]
    assert all(h.get("X-command-token") == "tok" for _, h in calls)


# ------------------------------------------------------------------ end to end against the real bridge
def _bridge_ready():
    if not (NODE and (Path(REPO) / "telemetry-bridge" / "recording" / "store.mjs").exists()
            and (Path(TOOLS) / "synth_sender.mjs").exists()):
        return False
    r = subprocess.run([NODE, "-e", "require('better-sqlite3')"], cwd=str(Path(REPO) / "telemetry-bridge"),
                       capture_output=True)
    return r.returncode == 0


need = pytest.mark.skipif(not _bridge_ready(), reason="node / bridge deps (npm ci) / tools missing")


def free_port(kind=socket.SOCK_STREAM):
    s = socket.socket(socket.AF_INET, kind); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.fixture(scope="module")
def recording_bridge():
    d = tempfile.mkdtemp(prefix="cubesat-rec-")
    http, udp = free_port(), free_port(socket.SOCK_DGRAM)
    env = dict(os.environ, HTTP_PORT=str(http), UDP_PORT=str(udp), HTTP_BIND_ADDRESS="127.0.0.1", UDP_BIND_ADDRESS="127.0.0.1",
               COMMAND_TOKEN=TOKEN, ALLOW_UNAUTHENTICATED_COMMANDS="false", RECORDING_DB_PATH=os.path.join(d, "runs.sqlite"),
               TELEMETRY_STALE_MS="3000", COMMAND_TARGET_HOST="", COMMAND_TARGET_PORT="")
    b = subprocess.Popen([NODE, str(Path(REPO) / "telemetry-bridge" / "server.js")], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sy = subprocess.Popen([NODE, str(Path(TOOLS) / "synth_sender.mjs"), "--target", "127.0.0.1:%d" % udp, "--count", "0",
                           "--period", "100", "--debug"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = "http://127.0.0.1:%d" % http
    try:
        yield base
    finally:
        sy.terminate(); b.terminate(); sy.wait(5); b.wait(5)
        shutil.rmtree(d, ignore_errors=True)


def _wait(fn, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception:
            pass
        time.sleep(0.1)
    raise AssertionError("timed out")


@need
def test_record_mark_stop_list_and_export_against_real_bridge(recording_bridge, tmp_path):
    s = _wait(lambda: WirelessSession.open(recording_bridge, TOKEN))
    _wait(lambda: s.health().get("telemetry_connected"))
    st = s.list_runs()
    assert st["recording"]["enabled"] and st["recording"]["ready"]
    run = _wait(lambda: s.start_recording("pytest run"))
    assert run["name"] == "pytest run" and s.active_run_id == run["id"]
    m = s.sequence_marker("pytest", 0, "debug on", "started")
    assert m and m["run_id"] == run["id"]
    time.sleep(1.2)
    s.stop_recording()
    got = s.get_run(run["id"])
    assert got["status"] == "completed" and got["sample_count"] >= 3 and got["end_reason"] == "operator_stop"
    assert any(r["id"] == run["id"] for r in s.list_runs()["runs"])
    ev = s.run_events(run["id"])["items"]
    assert {"run_started", "sequence_step", "run_ended"} <= {e["type"] for e in ev}
    w = M.window_for_preset(got, "full", time.time() * 1000)
    ser = s.run_series(run["id"], "pv.busVoltageV", w["start"], w["end"], 50)
    assert M.series_summary(ser["points"])["samples"] >= 3
    out = tmp_path / "run.csv"
    with open(out, "w", newline="", encoding="utf-8") as fh:
        n = M.export_csv(lambda a, b, after, lim: s.run_samples(run["id"], a, b, after, lim), "pv.busVoltageV", w["start"], w["end"], fh)
    rows = list(csv.reader(open(out, encoding="utf-8")))
    assert n == got["sample_count"] == len(rows) - 1 and rows[1][2]
    s.close()


@need
def test_recordings_tab_lists_runs_and_controls_follow_recorder(recording_bridge, tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from cubesat_i2c.runs_page import RecordingsPage
    page = RecordingsPage(); page.show()
    s = _wait(lambda: WirelessSession.open(recording_bridge, TOKEN))
    _wait(lambda: s.health().get("telemetry_connected"))

    def pump(pred, timeout=8.0):
        end = time.time() + timeout
        while time.time() < end:
            app.processEvents()
            if pred(): return True
            time.sleep(0.05)
        raise AssertionError("GUI did not update")

    page.use_session(s)
    pump(lambda: page.start_btn.isEnabled() and "READY" in page.indicator.text())
    assert not page.note.isVisible() or "No recorded runs" in page.note.text()
    page.run_name.setText("tab run"); page.start_recording()
    pump(lambda: page.stop_btn.isEnabled() and "RECORDING" in page.indicator.text())
    time.sleep(0.6); page.stop_recording()
    pump(lambda: page.start_btn.isEnabled() and page.run_table.rowCount() >= 1 and page.run_table.item(0, 2).text() == "completed")
    page.run_table.selectRow(0)
    pump(lambda: page.chart.data is not None and page.event_table.rowCount() >= 2)
    assert page.run_table.item(0, 0).text() == "tab run" and page.info["provenance"].text() == "unsigned"
    page.use_session(None)
    assert page.indicator.text() == "RECORDINGS · NOT CONNECTED" and not page.start_btn.isEnabled()
    s.close()


def test_recordings_tab_without_recorder_shows_note_only(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from cubesat_i2c.runs_page import RecordingsPage

    class Fake:
        auth_enabled, user = False, None
        def list_runs(self, *a): return {"runs": [], "recording": {"enabled": False}}

    page = RecordingsPage(); page.use_session(Fake())
    end = time.time() + 3
    while time.time() < end and not page.note.text():
        app.processEvents(); time.sleep(0.02)
    assert "not enabled" in page.note.text() and not page.start_btn.isEnabled()
    assert "UNAVAILABLE" in page.indicator.text() and page.run_table.rowCount() == 0
    page.use_session(None)


def test_streaming_snapshot_reports_signed_provenance_and_recording():
    from cubesat_i2c.streaming_model import StreamingModel
    m = StreamingModel()
    m.ingest({"type": "status", "server_time": "2026-10-26T20:00:00.000Z", "recording": {"enabled": True, "active_run_id": "r1"}})
    m.ingest({"type": "telemetry", "received_at": "2026-10-26T20:00:00.000Z", "provenance": {"authenticated": True, "scheme": "hmac-sha256"},
              "packet": {"packet_format": "v4", "seq": 1, "telemetry": {}}})
    s = m.snapshot()
    assert s["signed"] is True and s["recording"] is True
    m.ingest({"type": "status", "server_time": "2026-10-26T20:00:01.000Z", "recording": {"enabled": True, "active_run_id": None}})
    assert m.snapshot()["recording"] is False
