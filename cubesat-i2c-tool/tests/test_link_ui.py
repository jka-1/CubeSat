"""Link Health page: model semantics, mock source, SSE source against the real bridge (if available), GUI wiring."""
import os, shutil, socket, subprocess, sys, time, json, pytest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from cubesat_i2c.link_source import LinkModel, MockLinkSource, SseLinkSource

ISO = "2026-10-13T23:00:%02d.%03dZ"


def tel(sec, seq, port=5000, rssi=None):
    pkt = {"seq": seq}
    if rssi is not None:
        pkt["link"] = {"rssi_dbm": rssi}
    return {"type": "telemetry", "source": "udp", "received_at": ISO % (sec, 0),
            "network": {"remote_address": "10.0.0.5", "remote_port": port, "bytes": 80}, "packet": pkt}


def test_model_replay_port_change_rssi_commands():
    m = LinkModel()
    m.on_event(tel(0, 99))                                    # replay before any status: unknown skew -> stale, skipped
    m.on_event({"type": "status", "server_time": ISO % (3, 0)})
    m.on_event(tel(0, 98))                                    # 3 s old replay -> skipped
    m.on_event(tel(1, 10)); m.expect_replay = True; m.on_event(tel(1, 10))  # reconnect replay ignored
    m.on_event(tel(2, 11, rssi=-60)); m.on_event(tel(3, 1, port=5001))
    m.on_event({"type": "command_status", "status": "completed", "updated_at": ISO % (3, 500), "round_trip_ms": 22})
    m.on_event({"type": "command_status", "status": "completed", "updated_at": ISO % (0, 0), "round_trip_ms": 99})  # stale replay
    m.on_event({"type": "command_status", "status": "pending", "updated_at": ISO % (3, 600)})
    m.on_event({"type": "status", "server_time": ISO % (4, 0), "pending_commands": 1, "command_ready": True})
    ev, cmds, st = m.snapshot()
    assert [e["seq"] for e in ev] == [10, 11, 1] and ev[1]["rssi"] == -60 and "rssi" not in ev[0]
    assert m.port_changes == 1 and m.last_rssi is None
    assert cmds == [{"t": cmds[0]["t"], "status": "completed", "rtt": 22}]
    assert st["pending_commands"] == 1


def test_mock_source_produces_stats():
    from cubesat_i2c.link_stats import analyze_window
    m = LinkModel(); src = MockLinkSource(m, period_ms=20, seed=3); src.start(); time.sleep(1.5); src.stop()
    ev, cmds, _ = m.snapshot()
    r = analyze_window(ev, cmds, period_ms=20, window_ms=60000)
    assert r["summary"]["packets_received"] > 30 and r["summary"]["rssi_dbm"] is not None


BRIDGE = os.environ.get("LINK_BRIDGE", str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/telemetry-bridge/server.js")
SYNTH = os.environ.get("LINK_SYNTH", str(__import__("pathlib").Path(__file__).resolve().parents[2]) + "/tools/link-tools/synth_sender.mjs")


def free_port(kind=socket.SOCK_STREAM):
    s = socket.socket(socket.AF_INET, kind); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.mark.skipif(not (shutil.which("node") and os.path.exists(BRIDGE) and os.path.exists(SYNTH)), reason="needs node + repo bridge")
def test_sse_source_against_real_bridge():
    from cubesat_i2c.link_stats import analyze_window
    hp, up = free_port(), free_port(socket.SOCK_DGRAM)
    env = dict(os.environ, HTTP_PORT=str(hp), UDP_PORT=str(up), UDP_BIND_ADDRESS="127.0.0.1", COMMAND_TOKEN="t")
    b = subprocess.Popen(["node", BRIDGE], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        time.sleep(1.0)
        m = LinkModel(); src = SseLinkSource(m, "http://127.0.0.1:%d/events" % hp, "http://127.0.0.1:%d/health" % hp); src.start()
        time.sleep(0.7)
        subprocess.run(["node", SYNTH, "--target", "127.0.0.1:%d" % up, "--count", "40", "--period", "50",
                        "--drop", "5,6", "--dup", "10", "--reorder", "20", "--linger-ms", "300"], check=True, capture_output=True)
        time.sleep(0.5); src.stop()
        ev, cmds, st = m.snapshot()
        s = analyze_window(ev, cmds, period_ms=50, window_ms=60000)["summary"]
        assert (s["lost"], s["duplicates"], s["out_of_order"]) == (2, 1, 1)
        assert st.get("command_auth_configured") is True and st.get("udp_port") == up
    finally:
        b.kill()


def test_main_window_has_link_tab_and_old_tabs(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    from cubesat_i2c.gui import MainWindow
    app = QApplication.instance() or QApplication([])
    w = MainWindow(mock=True, mock_link=True)
    names = [w.tabs.tabText(i) for i in range(w.tabs.count())]
    assert names == ["Connection", "Registers", "Add / Delete", "Sequences", "Test Log", "Link Health", "Streaming Telemetry", "Recordings"]
    time.sleep(0.6); w.link_page.refresh()
    assert w.link_page.t_state.value.text() in ("Connected", "Stale")
    w.link_page.disconnect_source(); w.close()
