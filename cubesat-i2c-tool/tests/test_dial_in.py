"""t57u: card toggles, no notes on live cards, bridge live-mode flag from the exe, I²C wording."""
import json, os, pytest

pytest.importorskip("PySide6")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


def test_card_toggles_default_on_and_persist(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    from cubesat_i2c.storage import Store
    from cubesat_i2c.streaming_page import StreamingPage, card_toggles, CARD_TOGGLES
    app = QApplication.instance() or QApplication([])
    assert [k for k, _ in CARD_TOGGLES] == ["pv", "bms", "mppt", "mcu", "mcp9700", "temt6000"]
    assert all(card_toggles({}).values())
    st = Store(); pg = StreamingPage(st)
    pg.toggle_boxes["bms"].setChecked(False); pg.toggle_boxes["temt6000"].setChecked(False)
    again = card_toggles(Store().settings)
    assert again["bms"] is False and again["temt6000"] is False and again["pv"] is True
    pg2 = StreamingPage(Store())
    assert not pg2.toggle_boxes["bms"].isChecked() and pg2.toggle_boxes["mcp9700"].isChecked()


def test_live_cards_have_registers_and_no_notes():
    src = open(os.path.join(os.path.dirname(__file__), "..", "cubesat_i2c", "streaming_page.py"), encoding="utf-8").read()
    for reg in ("0x02", "0x03", "0x04", "0x14", "0x1A", "0x36", "0x68", "0x13", "0x20", "0x35", "0x41", "GPIO1", "GPIO2"):
        assert reg in src
    for note in ("need v6 firmware", "(ADC off)", "(sat)", "No telemetry yet", "QScrollArea()"):
        assert note not in src


def test_set_live_mode_posts_flag_with_token():
    from cubesat_i2c.wireless_session import WirelessSession
    sent = {}

    class R:
        def __init__(self, body): self.body = body
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return self.body

    def opener(req, t):
        sent["url"], sent["hdr"], sent["data"] = req.full_url, dict(req.header_items()), json.loads(req.data.decode())
        return R(json.dumps({"live_mode": sent["data"]["on"]}).encode())

    s = WirelessSession("http://bridge/telemetry", token="t0k", opener=opener)
    assert s.set_live_mode(True) is True
    assert sent["url"] == "http://bridge/telemetry/live-mode" and sent["data"] == {"on": True, "source": "exe"}
    assert sent["hdr"].get("X-command-token") == "t0k"
    assert s.set_live_mode(False) is True and sent["data"]["on"] is False


def test_window_title_uses_superscript_two(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBESAT_I2C_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    from cubesat_i2c.gui import MainWindow
    app = QApplication.instance() or QApplication([])
    w = MainWindow()
    assert "I²C" in w.windowTitle() and "I2C " not in w.windowTitle()
    if QApplication.platformName() != "offscreen":   # offscreen has no system fonts (Windows build runs it)
        assert w.fontMetrics().inFont("²")
