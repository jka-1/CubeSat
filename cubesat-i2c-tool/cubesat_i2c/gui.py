"""PySide6 GUI for the CubeSat ESP32 i2c-tools console."""
import os, sys, threading, datetime
from PySide6.QtCore import Qt, QObject, Signal, QThread, QTimer
from PySide6.QtGui import QFont, QTextCursor
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QTabWidget, QVBoxLayout,
    QHBoxLayout, QFormLayout, QGridLayout, QLabel, QLineEdit, QComboBox, QPushButton, QSpinBox,
    QPlainTextEdit, QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox, QCheckBox,
    QInputDialog, QGroupBox, QListWidget, QFileDialog, QDoubleSpinBox)

from . import protocol as P
from .session import Session, run_sequence
from .storage import Store, TestLog, DEFAULT_CONFIG
from .conversions import convert
from .link_page import LinkHealthPage
from .streaming_page import StreamingPage
from .runs_page import RecordingsPage
from .wireless_session import WirelessSession

MONO = QFont("Consolas", 10)


def list_ports():
    try:
        from serial.tools import list_ports as lp
        return [(p.device, "%s  %s" % (p.device, p.description)) for p in lp.comports()]
    except Exception:
        return []


class Worker(QObject):
    step = Signal(int, str, bool, str)
    done = Signal(str)

    def __init__(self, session, steps, stop_on_error, stop_event, sequence_name):
        super().__init__()
        self.session, self.steps, self.soe, self.stop = session, steps, stop_on_error, stop_event
        self.sequence_name = sequence_name

    def marker(self, index, line, phase, ok=None, result=None):
        if isinstance(self.session, WirelessSession) and self.session.active_run_id:
            try: self.session.sequence_marker(self.sequence_name, index, line, phase, ok, result)
            except Exception as e: self.session._log("SEQ", "marker failed: %s" % e)

    def run(self):
        try:
            res = run_sequence(self.session, self.steps,
                               on_step_start=lambda i, l: self.marker(i, l, "started"),
                               on_step=lambda i, l, ok, r: (self.marker(i, l, "completed" if ok else "failed", ok, r),
                                                            self.step.emit(i, l, ok, r)),
                               stop_event=self.stop, stop_on_error=self.soe)
            ok = sum(1 for r in res if r[1])
            self.done.emit("Finished: %d/%d steps OK" % (ok, len(res)))
        except Exception as e:
            self.done.emit("Sequence error: %s" % e)


class MainWindow(QMainWindow):
    log_signal = Signal()
    presence_signal = Signal(object)

    def __init__(self, mock=False, mock_link=False):
        super().__init__()
        self.setWindowTitle("CubeSat I²C Tool (ESP32-S3 i2c-tools)")
        self.resize(1100, 760)
        self.store = Store()
        log_dir = os.path.join(self.store.root, "logs")
        self.log = TestLog(os.path.join(log_dir, "test_log_%s.txt" % datetime.date.today().isoformat()))
        self.session = None
        self.mock = mock
        tabs = QTabWidget()
        tabs.addTab(self._conn_tab(), "Connection")
        tabs.addTab(self._reg_tab(), "Registers")
        tabs.addTab(self._manage_tab(), "Add / Delete")
        tabs.addTab(self._seq_tab(), "Sequences")
        tabs.addTab(self._log_tab(), "Test Log")
        self.link_page = LinkHealthPage(self.store, mock_default=mock_link)
        tabs.addTab(self.link_page, "Link Health")
        self.stream_page = StreamingPage(self.store)
        tabs.addTab(self.stream_page, "Streaming Telemetry")
        self.runs_page = RecordingsPage(self.store, on_recording_changed=lambda: self.sync_recording_state())
        tabs.addTab(self.runs_page, "Recordings")
        self.tabs = tabs
        tabs.currentChanged.connect(lambda i: i == 4 and self.refresh_log())
        self.setCentralWidget(tabs)
        self.statusBar().showMessage("Disconnected. Data folder: %s" % self.store.root)
        self.log_signal.connect(self.refresh_log)
        self.presence_signal.connect(self._show_presence)
        self._presence_busy = False
        self.ptimer = QTimer(self); self.ptimer.setInterval(2000); self.ptimer.timeout.connect(self.poll_presence)

    # ---------------------------------------------------------------- helpers
    def need(self):
        if not self.session or not self.session.connected:
            QMessageBox.warning(self, "Not connected", "Connect to the ESP32 first.")
            return False
        return True

    def console(self, text):
        self.term.appendPlainText(text)
        self.term.moveCursor(QTextCursor.End)

    def send_raw(self, cmd):
        if not self.need():
            return None
        try:
            resp = self.session.send(cmd)
        except Exception as e:
            self.console("!! %s" % e); return None
        self.console("> " + cmd)
        self.console("\n".join(P.strip_echo(resp, cmd)))
        return resp

    # ---------------------------------------------------------------- connection
    def _conn_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        hs = QHBoxLayout()
        self.source = QComboBox(); self.source.addItems(["Serial (USB)", "Debug (Wireless)"])
        self.source.currentIndexChanged.connect(self.on_source)
        hs.addWidget(QLabel("Source")); hs.addWidget(self.source); hs.addStretch(); v.addLayout(hs)
        self.serial_box = g = QGroupBox("Serial"); f = QHBoxLayout(g)
        self.port = QComboBox(); self.port.setEditable(True); self.port.setMinimumWidth(320)
        self.baud = QComboBox(); self.baud.setEditable(True)
        self.baud.addItems(["115200", "230400", "460800", "921600", "57600", "9600"])
        self.baud.setCurrentText(str(self.store.settings["baud"]))
        rb = QPushButton("Refresh"); rb.clicked.connect(self.refresh_ports)
        self.cbtn = QPushButton("Connect"); self.cbtn.clicked.connect(self.toggle_connect)
        for x in (QLabel("Port"), self.port, QLabel("Baud"), self.baud, rb, self.cbtn):
            f.addWidget(x)
        f.addStretch(); v.addWidget(g)
        self.refresh_ports()

        self.cfg_box = g2 = QGroupBox("I²C config (preloaded, saved)"); f2 = QHBoxLayout(g2)
        self.cfg = QLineEdit(self.store.settings["i2cconfig"])
        self.cfg_auto = QCheckBox("Send on connect")
        self.cfg_auto.setChecked(self.store.settings["send_config_on_connect"])
        sv = QPushButton("Save"); sv.clicked.connect(self.save_cfg)
        df = QPushButton("Default"); df.clicked.connect(lambda: self.cfg.setText(DEFAULT_CONFIG))
        ap = QPushButton("Apply now"); ap.clicked.connect(lambda: self.send_raw(self.cfg.text().strip()))
        for x in (self.cfg, self.cfg_auto, sv, df, ap):
            f2.addWidget(x)
        v.addWidget(g2)
        v.addWidget(self._wireless_box())
        v.addWidget(self._debug_box())

        h = QHBoxLayout()
        self.raw = QLineEdit(); self.raw.setPlaceholderText("Raw command, e.g. i2cdetect / i2cget -c 0x6b -r 0x48")
        self.raw.returnPressed.connect(self._raw_send)
        b = QPushButton("Send"); b.clicked.connect(self._raw_send)
        d = QPushButton("i2cdetect"); d.clicked.connect(self.detect)
        h.addWidget(self.raw); h.addWidget(b); h.addWidget(d); v.addLayout(h)
        self.term = QPlainTextEdit(); self.term.setReadOnly(True); self.term.setFont(MONO)
        v.addWidget(self.term)
        self.on_source()
        return w

    # ---------------------------------------------------------------- debug (wireless)
    def _wireless_box(self):
        self.wireless_box = g = QGroupBox("Debug (Wireless) - telemetry bridge HTTP API"); f = QGridLayout(g)
        self.bridge_url = QLineEdit(self.store.settings.get("bridge_url", "http://127.0.0.1:8080"))
        self.bridge_url.setMinimumWidth(280)
        self.bridge_url.setToolTip("Bridge base URL, e.g. http://<droplet>:8080 or https://<site>/telemetry")
        self.bridge_user = QLineEdit(self.store.settings.get("bridge_username", ""))
        self.bridge_user.setPlaceholderText("username when JWT login is enabled")
        self.bridge_password = QLineEdit(); self.bridge_password.setEchoMode(QLineEdit.Password)
        self.bridge_password.setPlaceholderText("password (not saved)")
        self.bridge_token = QLineEdit(os.environ.get("COMMAND_TOKEN", ""))
        self.bridge_token.setEchoMode(QLineEdit.Password); self.bridge_token.setPlaceholderText("command token (not saved)")
        self.bridge_tls = QCheckBox("Verify TLS"); self.bridge_tls.setChecked(True)
        self.wbtn = QPushButton("Connect"); self.wbtn.clicked.connect(self.toggle_wireless)
        f.addWidget(QLabel("Bridge"), 0, 0); f.addWidget(self.bridge_url, 0, 1, 1, 3)
        f.addWidget(self.bridge_tls, 0, 4); f.addWidget(self.wbtn, 0, 5)
        f.addWidget(QLabel("Login"), 1, 0); f.addWidget(self.bridge_user, 1, 1)
        f.addWidget(self.bridge_password, 1, 2); f.addWidget(QLabel("Command token"), 1, 3)
        f.addWidget(self.bridge_token, 1, 4, 1, 2)
        f.setColumnStretch(1, 1); f.setColumnStretch(2, 1); f.setColumnStretch(4, 1)
        return g

    def _debug_box(self):
        self.debug_box = g = QGroupBox("Debug mode / device presence"); v = QVBoxLayout(g)
        tiles = QHBoxLayout(); self.ptiles = {}
        for key, label, addr in (("pv", "PV / INA226", "0x40"), ("bms", "BMS / BQ76942", "0x08"), ("mppt", "MPPT / BQ25798", "0x6B")):
            t = QLabel(); t.setMinimumHeight(64); t.setAlignment(Qt.AlignCenter); t.setWordWrap(True)
            self.ptiles[key] = (t, label, addr); tiles.addWidget(t)
        v.addLayout(tiles)
        h = QHBoxLayout()
        on = QPushButton("Enable debug"); on.clicked.connect(lambda: self.wireless_cmd("debug on"))
        off = QPushButton("Disable debug"); off.clicked.connect(lambda: self.wireless_cmd("debug off"))
        self.period = QSpinBox(); self.period.setRange(200, 5000); self.period.setSingleStep(50); self.period.setValue(1000)
        self.period.setSuffix(" ms")
        ap = QPushButton("Apply scan period"); ap.clicked.connect(lambda: self.wireless_cmd("scan_period %d" % self.period.value()))
        sc = QPushButton("Bus scan + probe"); sc.clicked.connect(self.detect)
        for x in (on, off, QLabel("Scan period"), self.period, ap, sc): h.addWidget(x)
        h.addStretch(); v.addLayout(h)
        self.dbg_status = QLabel("Not connected"); v.addWidget(self.dbg_status)
        self._show_presence(None)
        return g

    def on_source(self, *_):
        wireless = self.source.currentIndex() == 1
        self.serial_box.setVisible(not wireless); self.cfg_box.setVisible(not wireless)
        self.wireless_box.setVisible(wireless); self.debug_box.setVisible(wireless)

    def toggle_wireless(self):
        if isinstance(self.session, WirelessSession):
            self.session.set_live_mode(False)
            self.stream_page.stop(); self.link_page.use_bridge_session(None); self.runs_page.use_session(None)
            self.session.close(); self.session = None; self.ptimer.stop()
            self.wbtn.setText("Connect"); self.statusBar().showMessage("Disconnected")
            self.log.write("SYS", "wireless disconnected"); self._show_presence(None)
            self.sync_recording_state(); return
        if self.session:
            self.session.close(); self.session = None; self.cbtn.setText("Connect")
        url = self.bridge_url.text().strip()
        try:
            self.session = WirelessSession.open(url, self.bridge_token.text().strip(), self.log,
                                                verify_tls=self.bridge_tls.isChecked(),
                                                username=self.bridge_user.text().strip(),
                                                password=self.bridge_password.text())
        except Exception as e:
            QMessageBox.critical(self, "Bridge unreachable", "%s\n%s" % (url, e)); self.session = None; return
        self.bridge_password.clear()
        self.store.settings["bridge_url"] = url
        self.store.settings["bridge_username"] = self.bridge_user.text().strip()
        self.store.save_settings()
        self.wbtn.setText("Disconnect"); self.statusBar().showMessage("Debug (Wireless) via %s" % url)
        self.console("Connected to bridge %s. Registers, Sequences and Test Log now run over the bridge." % url)
        self.ptimer.start(); self.poll_presence()
        self.stream_page.start(url, self.bridge_tls.isChecked(), self.session.open_url)   # shares the in-memory JWT cookie
        self.link_page.use_bridge_session(self.session)
        self.runs_page.use_session(self.session)
        # Live mode on the bridge: the droplet web pages stop showing simulated data while the exe is live.
        if not self.session.set_live_mode(True):
            self.console("Note: bridge live-mode flag not set (needs the command token); web pages still go live once telemetry arrives.")
        self.sync_recording_state()

    def closeEvent(self, e):
        if isinstance(self.session, WirelessSession):
            try:
                self.stream_page.stop(); self.link_page.use_bridge_session(None); self.runs_page.use_session(None)
                self.session.set_live_mode(False); self.session.close()
            except Exception: pass
        super().closeEvent(e)

    def wireless_cmd(self, line):
        if not isinstance(self.session, WirelessSession):
            QMessageBox.warning(self, "Not connected", "Connect the Debug (Wireless) source first."); return
        self.send_raw(line); self.poll_presence()

    def poll_presence(self):
        if not isinstance(self.session, WirelessSession) or self._presence_busy:
            return
        self._presence_busy = True
        sess = self.session

        def work():
            try: res = sess.presence()
            except Exception as e: res = e
            self._presence_busy = False
            self.presence_signal.emit(res)
        threading.Thread(target=work, daemon=True).start()

    def _show_presence(self, res):
        colors = {"present": "#1f7a3a", "absent": "#555", "error": "#a12828", "paused": "#8a6d00", "unknown": "#333"}
        names = {"present": "Present", "absent": "Absent", "error": "Bus error", "paused": "Paused", "unknown": "n/a"}
        if isinstance(res, Exception) or res is None:
            for t, label, addr in self.ptiles.values():
                t.setText("<b>%s</b><br>%s<br><small>addr %s</small>" % (label, "n/a", addr))
                t.setStyleSheet("background:#333;color:#ddd;border-radius:8px;padding:6px")
            self.dbg_status.setText("Not connected" if res is None else "Bridge error: %s" % res)
            return
        h, tiles = res
        for key, label, addr, state, detail in tiles:
            t = self.ptiles[key][0]
            t.setText("<b>%s</b><br><span style='font-size:15pt'>%s</span><br><small>addr %s · %s</small>" % (
                label, names.get(state, state), addr, detail))
            t.setStyleSheet("background:%s;color:white;border-radius:8px;padding:6px" % colors.get(state, "#333"))
        dm = h.get("debug_mode") or {}
        if dm.get("enabled"):
            self.dbg_status.setText("Debug ON (v5) · scan %s ms · probe every %s ms · I²C cycle %s ms · RSSI %s dBm · telemetry %s · commands %s" % (
                dm.get("scan_period_ms"), dm.get("probe_period_ms"), dm.get("i2c_cycle_ms"),
                (dm.get("link") or {}).get("rssi_dbm"), "fresh" if h.get("telemetry_connected") else "STALE",
                "ready" if h.get("command_ready") else "not ready"))
            if not self.period.hasFocus() and dm.get("scan_period_ms"):
                self.period.setValue(int(dm["scan_period_ms"]))
        else:
            self.dbg_status.setText("Debug OFF · firmware sends %s · telemetry %s · commands %s" % (
                h.get("telemetry_packet_format"), "fresh" if h.get("telemetry_connected") else "STALE",
                "ready" if h.get("command_ready") else "not ready"))

    def refresh_ports(self):
        cur = self.port.currentText() or self.store.settings.get("port", "")
        self.port.clear()
        for dev, label in list_ports():
            self.port.addItem(label, dev)
        if self.mock:
            self.port.addItem("MOCK (simulated ESP32)", "MOCK")
        if cur:
            i = self.port.findData(cur)
            if i >= 0: self.port.setCurrentIndex(i)

    def _port_value(self):
        d = self.port.currentData()
        txt = self.port.currentText().split()[0] if self.port.currentText() else ""
        return d if d and self.port.currentText() == self.port.itemText(self.port.currentIndex()) else txt

    def toggle_connect(self):
        if isinstance(self.session, WirelessSession):
            self.toggle_wireless()
        if self.session:
            self.session.close(); self.session = None
            self.cbtn.setText("Connect"); self.statusBar().showMessage("Disconnected")
            self.log.write("SYS", "disconnected"); return
        port = self._port_value(); baud = self.baud.currentText()
        try:
            if port == "MOCK":
                from .mock_serial import MockESP32
                self.session = Session(MockESP32(), self.log, self.store.settings["timeout_s"])
            else:
                self.session = Session.open(port, baud, self.log, self.store.settings["timeout_s"])
        except Exception as e:
            QMessageBox.critical(self, "Connect failed", str(e)); self.session = None; return
        self.store.settings.update(port=port, baud=int(baud)); self.store.save_settings()
        self.log.write("SYS", "connected %s @ %s" % (port, baud))
        self.cbtn.setText("Disconnect"); self.statusBar().showMessage("Connected %s @ %s" % (port, baud))
        if self.cfg_auto.isChecked():
            self.send_raw(self.cfg.text().strip())

    def save_cfg(self):
        self.store.settings["i2cconfig"] = self.cfg.text().strip()
        self.store.settings["send_config_on_connect"] = self.cfg_auto.isChecked()
        self.store.save_settings(); self.statusBar().showMessage("I²C config saved")

    def _raw_send(self):
        c = self.raw.text().strip()
        if c: self.send_raw(c)

    def detect(self):
        if not self.need(): return
        try:
            found = self.session.detect()
            self.console("> i2cdetect\nFound: " + (", ".join("0x%02X" % a for a in found) or "none"))
        except Exception as e:
            self.console("!! %s" % e)

    # ---------------------------------------------------------------- registers
    def _reg_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        top = QGridLayout()
        self.dev = QComboBox(); self.dev.currentIndexChanged.connect(self.on_dev)
        self.addr = QLineEdit(); self.addr.setMaximumWidth(80)
        sa = QPushButton("Save address"); sa.clicked.connect(self.save_addr)
        self.reg = QComboBox(); self.reg.setMinimumWidth(380); self.reg.currentIndexChanged.connect(self.on_reg)
        top.addWidget(QLabel("Device"), 0, 0); top.addWidget(self.dev, 0, 1)
        top.addWidget(QLabel("I²C addr"), 0, 2); top.addWidget(self.addr, 0, 3); top.addWidget(sa, 0, 4)
        top.addWidget(QLabel("Register"), 1, 0); top.addWidget(self.reg, 1, 1, 1, 4)
        v.addLayout(top)
        self.reginfo = QLabel(); self.reginfo.setWordWrap(True); v.addWidget(self.reginfo)
        h = QHBoxLayout()
        rb = QPushButton("Read"); rb.clicked.connect(self.read_one)
        ra = QPushButton("Read all (device)"); ra.clicked.connect(self.read_all)
        self.wval = QLineEdit(); self.wval.setPlaceholderText("Value: 0xA2  or 0x4127  or bytes '0x22 0x00'")
        wb = QPushButton("Write"); wb.clicked.connect(self.write_one)
        db = QPushButton("i2cdump"); db.clicked.connect(self.dump)
        for x in (rb, ra, QLabel("Write"), self.wval, wb, db): h.addWidget(x)
        v.addLayout(h)
        self.result = QLabel("—"); self.result.setFont(QFont("Consolas", 14)); v.addWidget(self.result)
        self.rtable = QTableWidget(0, 6)
        self.rtable.setHorizontalHeaderLabels(["Time", "Device", "Register", "Bytes", "Raw", "Converted"])
        self.rtable.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        v.addWidget(self.rtable)
        self.reload_devices()
        return w

    def reload_devices(self):
        cur = self.dev.currentText()
        self.dev.blockSignals(True); self.dev.clear()
        for d in self.store.devices:
            self.dev.addItem(d["name"])
        self.dev.blockSignals(False)
        i = self.dev.findText(cur); self.dev.setCurrentIndex(max(i, 0)); self.on_dev()
        if hasattr(self, "mdev"):
            c2 = self.mdev.currentText(); self.mdev.blockSignals(True); self.mdev.clear()
            self.mdev.addItems([d["name"] for d in self.store.devices]); self.mdev.blockSignals(False)
            j = self.mdev.findText(c2); self.mdev.setCurrentIndex(max(j, 0)); self.fill_manage()

    def cur_dev(self):
        return self.store.device(self.dev.currentText())

    def cur_reg(self):
        d = self.cur_dev()
        i = self.reg.currentIndex()
        return d["registers"][i] if d and 0 <= i < len(d["registers"]) else None

    def on_dev(self, *_):
        d = self.cur_dev()
        self.reg.blockSignals(True); self.reg.clear()
        if d:
            self.addr.setText(d["addr"])
            for r in d["registers"]:
                self.reg.addItem("%s  %s  [%s, %d B]" % (r["addr"], r["name"], r.get("access", "R"), int(r.get("width", 1))))
        self.reg.blockSignals(False); self.on_reg()

    def on_reg(self, *_):
        r = self.cur_reg()
        if not r: self.reginfo.setText(""); return
        conv = ("raw x %g %+g %s" % (r["scale"], r.get("offset", 0), r.get("unit", ""))) if r.get("scale") is not None else "hex / bitfields"
        self.reginfo.setText("Width %d B, %s-endian, %s; conversion: %s. %s" % (
            int(r.get("width", 1)), r.get("endian", "big"), "signed" if r.get("signed") else "unsigned", conv, r.get("notes", "")))
        if r.get("value"): self.wval.setText(str(r["value"]))

    def save_addr(self):
        d = self.cur_dev()
        try: d["addr"] = "0x%02X" % P.to_int(self.addr.text())
        except ValueError: QMessageBox.warning(self, "Bad address", self.addr.text()); return
        self.store.save_devices(); self.statusBar().showMessage("Saved %s address %s" % (d["name"], d["addr"]))

    def _read(self, d, r):
        try:
            data, raw, val, txt = self.session.read_reg(P.to_int(d["addr"]), r)
        except Exception as e:
            txt, data, raw = "ERROR: %s" % e, [], None
        row = self.rtable.rowCount(); self.rtable.insertRow(row)
        for c, t in enumerate([datetime.datetime.now().strftime("%H:%M:%S"), d["name"], "%s %s" % (r["addr"], r["name"]),
                               " ".join("%02X" % b for b in data[:int(r.get("width", 1))]),
                               "" if raw is None else str(raw), txt]):
            self.rtable.setItem(row, c, QTableWidgetItem(t))
        self.rtable.scrollToBottom()
        return txt

    def read_one(self):
        if not self.need() or not self.cur_reg(): return
        self.result.setText("%s = %s" % (self.cur_reg()["name"], self._read(self.cur_dev(), self.cur_reg())))

    def read_all(self):
        if not self.need(): return
        d = self.cur_dev()
        for r in d["registers"]:
            if "R" in r.get("access", "R"):
                self._read(d, r); QApplication.processEvents()

    def write_one(self):
        if not self.need() or not self.cur_reg(): return
        r, d = self.cur_reg(), self.cur_dev()
        try:
            data = P.parse_value_input(self.wval.text(), int(r.get("width", 1)), r.get("endian", "big"))
        except ValueError as e:
            QMessageBox.warning(self, "Bad value", str(e)); return
        cmd = P.build_set(d["addr"], r["addr"], data)
        if "W" not in r.get("access", "R") and QMessageBox.question(
                self, "Read-only register", "%s is marked read-only. Send anyway?\n%s" % (r["name"], cmd)) != QMessageBox.Yes:
            return
        try:
            self.result.setText("%s -> %s" % (cmd, self.session.write_reg(d["addr"], r["addr"], data)))
        except Exception as e:
            self.result.setText("WRITE ERROR: %s" % e)

    def dump(self):
        if self.need(): self.send_raw(P.build_dump(self.cur_dev()["addr"]))

    # ---------------------------------------------------------------- add/delete
    def _manage_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        h = QHBoxLayout(); self.mdev = QComboBox(); self.mdev.currentIndexChanged.connect(self.fill_manage)
        h.addWidget(QLabel("Device dropdown")); h.addWidget(self.mdev); h.addStretch()
        nd = QPushButton("Add device"); nd.clicked.connect(self.add_device)
        dd = QPushButton("Delete device"); dd.clicked.connect(self.del_device)
        rs = QPushButton("Reset to defaults"); rs.clicked.connect(self.reset_defaults)
        for x in (nd, dd, rs): h.addWidget(x)
        v.addLayout(h)
        self.mtable = QTableWidget(0, 9)
        self.mtable.setHorizontalHeaderLabels(["Register", "Name", "Value", "Access", "Width", "Endian", "Signed", "Scale/Offset/Unit", "Notes"])
        self.mtable.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.mtable.horizontalHeader().setStretchLastSection(True)
        self.mtable.setSelectionBehavior(QTableWidget.SelectRows)
        self.mtable.itemSelectionChanged.connect(self.pick_manage)
        v.addWidget(self.mtable)
        g = QGroupBox("Add / update register"); f = QGridLayout(g)
        self.m_reg = QLineEdit(); self.m_reg.setPlaceholderText("0x0F")
        self.m_val = QLineEdit(); self.m_val.setPlaceholderText("default write value, e.g. 0xA2")
        self.m_name = QLineEdit(); self.m_acc = QComboBox(); self.m_acc.addItems(["R", "RW", "W"])
        self.m_w = QSpinBox(); self.m_w.setRange(1, 4); self.m_end = QComboBox(); self.m_end.addItems(["big", "little"])
        self.m_sig = QCheckBox("signed")
        self.m_scale = QLineEdit(); self.m_scale.setPlaceholderText("blank = hex only")
        self.m_off = QLineEdit("0"); self.m_unit = QLineEdit()
        for i, (lab, wid) in enumerate([("Register", self.m_reg), ("Value", self.m_val), ("Name", self.m_name),
                                        ("Access", self.m_acc), ("Width (bytes)", self.m_w), ("Endian", self.m_end),
                                        ("", self.m_sig), ("Scale", self.m_scale), ("Offset", self.m_off), ("Unit", self.m_unit)]):
            f.addWidget(QLabel(lab), i // 5 * 2, i % 5); f.addWidget(wid, i // 5 * 2 + 1, i % 5)
        ab = QPushButton("Add / Update"); ab.clicked.connect(self.add_reg)
        de = QPushButton("Delete selected"); de.clicked.connect(self.del_reg)
        f.addWidget(ab, 4, 3); f.addWidget(de, 4, 4)
        v.addWidget(g)
        self.mdev.addItems([d["name"] for d in self.store.devices]); self.fill_manage()
        return w

    def fill_manage(self, *_):
        d = self.store.device(self.mdev.currentText())
        self.mtable.setRowCount(0)
        if not d: return
        for r in d["registers"]:
            row = self.mtable.rowCount(); self.mtable.insertRow(row)
            conv = "" if r.get("scale") is None else "%g / %g / %s" % (r["scale"], r.get("offset", 0), r.get("unit", ""))
            for c, t in enumerate([r["addr"], r["name"], str(r.get("value", "")), r.get("access", "R"), str(r.get("width", 1)),
                                   r.get("endian", "big"), "Y" if r.get("signed") else "", conv, r.get("notes", "")]):
                it = QTableWidgetItem(t); it.setFlags(it.flags() & ~Qt.ItemIsEditable); self.mtable.setItem(row, c, it)

    def pick_manage(self):
        d = self.store.device(self.mdev.currentText()); rows = self.mtable.selectionModel().selectedRows()
        if not d or not rows: return
        r = d["registers"][rows[0].row()]
        self.m_reg.setText(r["addr"]); self.m_name.setText(r["name"]); self.m_val.setText(str(r.get("value", "")))
        self.m_acc.setCurrentText(r.get("access", "R")); self.m_w.setValue(int(r.get("width", 1)))
        self.m_end.setCurrentText(r.get("endian", "big")); self.m_sig.setChecked(bool(r.get("signed")))
        self.m_scale.setText("" if r.get("scale") is None else str(r["scale"]))
        self.m_off.setText(str(r.get("offset", 0))); self.m_unit.setText(r.get("unit", ""))

    def add_reg(self):
        name = self.mdev.currentText()
        try:
            a = P.to_int(self.m_reg.text()); assert 0 <= a <= 0xFF
            if self.m_val.text().strip():
                P.parse_value_input(self.m_val.text(), self.m_w.value(), self.m_end.currentText())
            scale = float(self.m_scale.text()) if self.m_scale.text().strip() else None
            off = float(self.m_off.text() or 0)
        except Exception as e:
            QMessageBox.warning(self, "Invalid input", "Check register/value/scale: %s" % e); return
        old = next((r for r in self.store.device(name)["registers"] if int(r["addr"], 16) == a), {})
        reg = dict(old)
        reg.update(addr="0x%02X" % a, name=self.m_name.text().strip() or "Reg 0x%02X" % a, value=self.m_val.text().strip(),
                   access=self.m_acc.currentText(), width=self.m_w.value(), endian=self.m_end.currentText(),
                   signed=self.m_sig.isChecked(), scale=scale, offset=off, unit=self.m_unit.text().strip(),
                   source=old.get("source", "user"))
        reg.setdefault("notes", ""); reg.setdefault("precision", 3)
        self.store.add_register(name, reg); self.reload_devices()

    def del_reg(self):
        rows = self.mtable.selectionModel().selectedRows()
        if not rows: return
        d = self.store.device(self.mdev.currentText()); r = d["registers"][rows[0].row()]
        if QMessageBox.question(self, "Delete", "Delete %s %s from %s?" % (r["addr"], r["name"], d["name"])) == QMessageBox.Yes:
            self.store.delete_register(d["name"], r["addr"]); self.reload_devices()

    def add_device(self):
        n, ok = QInputDialog.getText(self, "Add device", "Device name:")
        if not ok or not n.strip() or self.store.device(n.strip()): return
        a, ok = QInputDialog.getText(self, "Add device", "I²C address (hex):", text="0x")
        try: a = "0x%02X" % P.to_int(a)
        except Exception: return
        self.store.devices.append(dict(name=n.strip(), addr=a, registers=[], notes=""))
        self.store.save_devices(); self.reload_devices()

    def del_device(self):
        n = self.mdev.currentText()
        if n and QMessageBox.question(self, "Delete device", "Delete device '%s' and its registers?" % n) == QMessageBox.Yes:
            self.store.devices = [d for d in self.store.devices if d["name"] != n]
            self.store.save_devices(); self.reload_devices()

    def reset_defaults(self):
        if QMessageBox.question(self, "Reset", "Replace all devices/registers with built-in defaults?") == QMessageBox.Yes:
            self.store.reset_devices(); self.reload_devices()

    # ---------------------------------------------------------------- sequences
    def _seq_tab(self):
        w = QWidget(); h = QHBoxLayout(w)
        left = QVBoxLayout(); self.plist = QListWidget(); self.plist.currentTextChanged.connect(self.load_profile)
        left.addWidget(QLabel("Profiles")); left.addWidget(self.plist)
        for lab, fn in (("New", self.new_profile), ("Save", self.save_profile), ("Save as…", self.save_as_profile),
                        ("Delete", self.del_profile), ("Import .txt", self.import_seq), ("Export .txt", self.export_seq)):
            b = QPushButton(lab); b.clicked.connect(fn); left.addWidget(b)
        h.addLayout(left, 1)
        right = QVBoxLayout()
        right.addWidget(QLabel("One command per line. 'delay 500' (ms) or 'delay 2 s' to wait; '#' starts a comment."))
        self.seq = QPlainTextEdit(); self.seq.setFont(MONO); right.addWidget(self.seq, 3)
        ib = QHBoxLayout()
        ins = QPushButton("Insert read of selected register"); ins.clicked.connect(lambda: self._ins(False))
        insw = QPushButton("Insert write (Registers tab value)"); insw.clicked.connect(lambda: self._ins(True))
        ib.addWidget(ins); ib.addWidget(insw); right.addLayout(ib)
        recording = QGroupBox("Telemetry recording"); rg = QGridLayout(recording)
        self.run_name = QLineEdit(); self.run_name.setPlaceholderText("Run name (defaults to the selected profile)")
        self.record_start = QPushButton("Start recording"); self.record_start.clicked.connect(self.start_recording)
        self.record_stop = QPushButton("Stop recording"); self.record_stop.clicked.connect(self.stop_recording)
        self.record_status = QLabel("Connect to Debug (Wireless) to record and mark sequence steps.")
        rg.addWidget(QLabel("Name"), 0, 0); rg.addWidget(self.run_name, 0, 1)
        rg.addWidget(self.record_start, 0, 2); rg.addWidget(self.record_stop, 0, 3)
        rg.addWidget(self.record_status, 1, 0, 1, 4); rg.setColumnStretch(1, 1)
        self.record_start.setEnabled(False); self.record_stop.setEnabled(False)
        right.addWidget(recording)
        rb = QHBoxLayout(); self.soe = QCheckBox("Stop on error"); self.soe.setChecked(True)
        self.runb = QPushButton("Run sequence"); self.runb.clicked.connect(self.run_seq)
        self.stopb = QPushButton("Stop"); self.stopb.setEnabled(False); self.stopb.clicked.connect(lambda: self._stop.set())
        rb.addWidget(self.soe); rb.addWidget(self.runb); rb.addWidget(self.stopb); right.addLayout(rb)
        self.seqout = QPlainTextEdit(); self.seqout.setReadOnly(True); self.seqout.setFont(MONO); right.addWidget(self.seqout, 2)
        h.addLayout(right, 3)
        self.reload_profiles()
        return w

    def reload_profiles(self, select=None):
        self.plist.blockSignals(True); self.plist.clear(); self.plist.addItems(sorted(self.store.profiles)); self.plist.blockSignals(False)
        items = self.plist.findItems(select, Qt.MatchExactly) if select else []
        if items: self.plist.setCurrentItem(items[0])
        elif self.plist.count(): self.plist.setCurrentRow(0)

    def load_profile(self, name):
        if name in self.store.profiles: self.seq.setPlainText("\n".join(self.store.profiles[name]))

    def _lines(self): return self.seq.toPlainText().splitlines()

    def save_profile(self):
        it = self.plist.currentItem()
        if not it: return self.save_as_profile()
        self.store.profiles[it.text()] = self._lines(); self.store.save_profiles()
        self.statusBar().showMessage("Saved profile '%s'" % it.text())

    def save_as_profile(self):
        n, ok = QInputDialog.getText(self, "Save profile", "Profile name (e.g. Startup, Shutdown):")
        if ok and n.strip():
            self.store.profiles[n.strip()] = self._lines(); self.store.save_profiles(); self.reload_profiles(n.strip())

    def new_profile(self):
        n, ok = QInputDialog.getText(self, "New profile", "Profile name:")
        if ok and n.strip():
            self.store.profiles[n.strip()] = [self.store.settings["i2cconfig"]]; self.store.save_profiles(); self.reload_profiles(n.strip())

    def del_profile(self):
        it = self.plist.currentItem()
        if it and QMessageBox.question(self, "Delete", "Delete profile '%s'?" % it.text()) == QMessageBox.Yes:
            self.store.profiles.pop(it.text(), None); self.store.save_profiles(); self.reload_profiles()

    def import_seq(self):
        p, _ = QFileDialog.getOpenFileName(self, "Import sequence", "", "Text (*.txt);;All (*)")
        if p:
            with open(p, encoding="utf-8") as f: self.seq.setPlainText(f.read())

    def export_seq(self):
        p, _ = QFileDialog.getSaveFileName(self, "Export sequence", "sequence.txt", "Text (*.txt)")
        if p:
            with open(p, "w", encoding="utf-8") as f: f.write(self.seq.toPlainText())

    def _ins(self, write):
        d, r = self.cur_dev(), self.cur_reg()
        if not r: return
        if write:
            try: data = P.parse_value_input(self.wval.text() or str(r.get("value", "")), int(r.get("width", 1)), r.get("endian", "big"))
            except ValueError as e: QMessageBox.warning(self, "Bad value", str(e)); return
            line = P.build_set(d["addr"], r["addr"], data)
        else:
            line = P.build_get(d["addr"], r["addr"], int(r.get("width", 1)))
        self.seq.appendPlainText("%s   # %s %s" % (line, d["name"], r["name"]))

    def run_seq(self):
        if not self.need(): return
        if isinstance(self.session, WirelessSession): self.sync_recording_state()
        self.seqout.clear(); self._stop = threading.Event()
        profile = self.plist.currentItem().text() if self.plist.currentItem() else "Unsaved sequence"
        self.thread = QThread(); self.worker = Worker(self.session, self._lines(), self.soe.isChecked(), self._stop, profile)
        self.worker.moveToThread(self.thread); self.thread.started.connect(self.worker.run)
        self.worker.step.connect(lambda i, l, ok, r: self.seqout.appendPlainText("%s L%d %s\n    %s" % ("OK " if ok else "ERR", i + 1, l, r.replace("\n", "\n    "))))
        self.worker.done.connect(self._seq_done); self.worker.done.connect(self.thread.quit)
        self.runb.setEnabled(False); self.stopb.setEnabled(True); self.thread.start()

    def _seq_done(self, msg):
        self.seqout.appendPlainText(msg); self.runb.setEnabled(True); self.stopb.setEnabled(False)

    def sync_recording_state(self):
        if not isinstance(self.session, WirelessSession):
            self.record_start.setEnabled(False); self.record_stop.setEnabled(False)
            self.record_status.setText("Connect to Debug (Wireless) to record and mark sequence steps.")
            return
        try:
            data = self.session.recording_status()
            active = bool((data.get("recording") or {}).get("active_run_id"))
            active_run = next((r for r in data.get("runs", []) if r.get("status") == "recording"), None)
            operator = not self.session.auth_enabled or (self.session.user or {}).get("role") == "operator"
            self.record_status.setText(("Recording: %s" % active_run.get("name") if active_run else "Recorder ready")
                                       if operator else "Viewer account: recording controls are read-only")
            self.record_start.setEnabled(operator and not active); self.record_stop.setEnabled(operator and active)
        except Exception as e:
            self.record_start.setEnabled(False); self.record_stop.setEnabled(False)
            self.record_status.setText("Recorder unavailable: %s" % e)

    def start_recording(self):
        if not isinstance(self.session, WirelessSession): return self.sync_recording_state()
        profile = self.plist.currentItem().text() if self.plist.currentItem() else "Sequence"
        name = self.run_name.text().strip() or profile
        try:
            run = self.session.start_recording(name)
            self.record_status.setText("Recording: %s" % run.get("name", name))
            self.record_start.setEnabled(False); self.record_stop.setEnabled(True)
            self.runs_page.refresh_runs()
        except Exception as e:
            QMessageBox.warning(self, "Recording not started", str(e)); self.sync_recording_state()

    def stop_recording(self):
        if not isinstance(self.session, WirelessSession): return self.sync_recording_state()
        try:
            run = self.session.stop_recording()
            self.record_status.setText("Stopped: %s" % run.get("name", "run"))
            self.record_start.setEnabled(True); self.record_stop.setEnabled(False)
            self.runs_page.refresh_runs()
        except Exception as e:
            QMessageBox.warning(self, "Recording not stopped", str(e)); self.sync_recording_state()

    # ---------------------------------------------------------------- log
    def _log_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        h = QHBoxLayout(); self.logpath = QLabel(self.log.path); self.logpath.setTextInteractionFlags(Qt.TextSelectableByMouse)
        rf = QPushButton("Refresh"); rf.clicked.connect(self.refresh_log)
        op = QPushButton("Open other log…"); op.clicked.connect(self.open_log)
        of = QPushButton("Open folder"); of.clicked.connect(lambda: os.startfile(os.path.dirname(self.log.path)) if hasattr(os, "startfile") else None)
        nt = QLineEdit(); nt.setPlaceholderText("Add a note to the log (Enter)")
        nt.returnPressed.connect(lambda: (self.log.write("NOTE", nt.text()), nt.clear(), self.refresh_log()))
        for x in (QLabel("File:"), self.logpath, rf, op, of): h.addWidget(x)
        v.addLayout(h); v.addWidget(nt)
        self.logview = QPlainTextEdit(); self.logview.setReadOnly(True); self.logview.setFont(MONO); v.addWidget(self.logview)
        self._viewpath = None
        t = QTimer(self); t.timeout.connect(self.refresh_log); t.start(2000)
        return w

    def refresh_log(self):
        path = self._viewpath or self.log.path
        try:
            with open(path, encoding="utf-8") as f: txt = f.read()
        except OSError: txt = ""
        if txt != self.logview.toPlainText():
            self.logview.setPlainText(txt); self.logview.moveCursor(QTextCursor.End)

    def open_log(self):
        p, _ = QFileDialog.getOpenFileName(self, "Open log", os.path.dirname(self.log.path), "Text (*.txt)")
        if p: self._viewpath = p; self.logpath.setText(p); self.refresh_log()


def main():
    app = QApplication(sys.argv)
    w = MainWindow(mock="--mock" in sys.argv, mock_link="--mock-link" in sys.argv)
    if "--wireless" in sys.argv:  # optional: --wireless [URL]; token only from COMMAND_TOKEN env
        w.source.setCurrentIndex(1)
        i = sys.argv.index("--wireless")
        if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
            w.bridge_url.setText(sys.argv[i + 1])
    if "--stream-tab" in sys.argv:
        w.tabs.setCurrentWidget(w.stream_page)
    if "--link-tab" in sys.argv or "--mock-link" in sys.argv:
        w.tabs.setCurrentWidget(w.link_page)
    w.show()
    sys.exit(app.exec())
