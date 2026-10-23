"""Link Health page: status tiles, 6 live charts and a window stats table (QPainter, no extra deps)."""
import math, time
from PySide6.QtCore import Qt, QTimer, QPointF, QRectF
from PySide6.QtGui import QPainter, QPen, QColor, QFont, QBrush
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel, QLineEdit, QComboBox,
    QPushButton, QSpinBox, QTableWidget, QTableWidgetItem, QHeaderView, QGroupBox, QFrame, QSizePolicy, QFormLayout)

from .link_stats import analyze_window
from .link_source import LinkModel, SseLinkSource, MockLinkSource, DEFAULT_SSE_URL, DEFAULT_HEALTH_URL

GOLD, OK, WARN, BAD, BG, GRID, TXT = "#d4af37", "#2fbf55", "#e0a800", "#e05252", "#111214", "#3a3320", "#ede8d9"
WINDOWS = [("1 min", 60_000), ("5 min", 300_000), ("15 min", 900_000), ("60 min", 3_600_000)]


class ChartWidget(QWidget):
    def __init__(self, title, parent=None):
        super().__init__(parent)
        self.title, self.datasets, self.start, self.end, self.y_min = title, [], 0, 1, None
        self.setMinimumHeight(170)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

    def set_data(self, datasets, start, end, y_min=None):
        self.datasets, self.start, self.end, self.y_min = datasets, start, end, y_min
        self.update()

    def paintEvent(self, _):
        p = QPainter(self); p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        p.fillRect(0, 0, w, h, QColor(BG))
        p.setPen(QColor(GOLD)); p.setFont(QFont("Segoe UI", 9, QFont.Bold)); p.drawText(10, 16, self.title)
        L, R, T, B = 46, 10, 26, 20
        p.setFont(QFont("Segoe UI", 8))
        pts = [v for d in self.datasets for (_, v) in d["points"] if v is not None]
        if not pts or self.end <= self.start:
            p.setPen(QColor(TXT)); p.drawText(L + 8, h // 2, "no data in window"); return
        lo = self.y_min if self.y_min is not None else min(pts)
        hi = max(pts)
        if hi == lo:
            hi += 1
            if self.y_min is None: lo -= 1
        pad = (hi - lo) * 0.08; hi += pad
        if self.y_min is None: lo -= pad
        X = lambda t: L + (t - self.start) / (self.end - self.start) * (w - L - R)
        Y = lambda v: T + (1 - (v - lo) / (hi - lo)) * (h - T - B)
        for i in range(4):
            v = lo + (hi - lo) * i / 3
            p.setPen(QPen(QColor(GRID), 1)); p.drawLine(QPointF(L, Y(v)), QPointF(w - R, Y(v)))
            p.setPen(QColor(TXT)); p.drawText(4, int(Y(v)) + 4, ("%.0f" if abs(v) >= 100 else "%.1f") % v)
        p.drawText(L, h - 5, "-%d min" % round((self.end - self.start) / 60000)); p.drawText(w - R - 24, h - 5, "now")
        n = len(self.datasets)
        for di, d in enumerate(self.datasets):
            col = QColor(d["color"])
            pp = [(t, v) for t, v in d["points"] if v is not None]
            if d.get("bars"):
                bw = max(2.0, (w - L - R) / 60 / n - 1)
                p.setPen(Qt.NoPen); p.setBrush(QBrush(col))
                for t, v in pp:
                    if v: p.drawRect(QRectF(X(t) - bw * (n - di), Y(v), bw, Y(lo) - Y(v)))
            else:
                p.setPen(QPen(col, 1.6))
                for (t1, v1), (t2, v2) in zip(pp, pp[1:]):
                    p.drawLine(QPointF(X(t1), Y(v1)), QPointF(X(t2), Y(v2)))
                if len(pp) < 80:
                    p.setBrush(QBrush(col))
                    for t, v in pp: p.drawEllipse(QPointF(X(t), Y(v)), 2, 2)
            if d.get("label"):
                p.setPen(col); p.drawText(w - R - 60, T + 10 + di * 12, d["label"])


class Tile(QFrame):
    def __init__(self, title):
        super().__init__()
        self.setObjectName("tile")
        self.setStyleSheet("#tile{border:1px solid #6b5520;border-radius:10px;background:#16171a;}"
                           "QLabel{color:%s;background:transparent;}" % TXT)
        v = QVBoxLayout(self); v.setContentsMargins(10, 8, 10, 8)
        self.t = QLabel(title); self.value = QLabel("--"); self.detail = QLabel("")
        self.value.setStyleSheet("color:%s;font-size:16px;font-weight:bold;" % "#f0d77a")
        self.detail.setStyleSheet("font-size:10px;"); self.detail.setWordWrap(True)
        for x in (self.t, self.value, self.detail): v.addWidget(x)

    def set(self, value, detail=""):
        self.value.setText(str(value)); self.detail.setText(detail)


def fmt(v, u=""):
    return "--" if v is None else "%s%s" % (v, u)


class LinkHealthPage(QWidget):
    def __init__(self, store=None, mock_default=False, parent=None):
        super().__init__(parent)
        self.store = store
        self.auth_opener = None
        s = store.settings if store else {}
        self.model, self.source = LinkModel(), None
        root = QVBoxLayout(self)
        box = QGroupBox("Source"); f = QHBoxLayout(box)
        self.kind = QComboBox(); self.kind.addItems(["Bridge SSE", "Mock link"])
        self.sse = QLineEdit(s.get("link_sse_url", DEFAULT_SSE_URL))
        self.health = QLineEdit(s.get("link_health_url", DEFAULT_HEALTH_URL)); self.health.setPlaceholderText("optional /health URL")
        self.period = QSpinBox(); self.period.setRange(20, 60000); self.period.setValue(int(s.get("link_period_ms", 1000))); self.period.setSuffix(" ms")
        self.window = QComboBox(); [self.window.addItem(n, ms) for n, ms in WINDOWS]; self.window.setCurrentIndex(1)
        self.btn = QPushButton("Connect"); self.btn.clicked.connect(self.toggle)
        clr = QPushButton("Clear stats"); clr.clicked.connect(lambda: (self.model.reset(), self.refresh()))
        for lab, wdg in (("Source", self.kind), ("SSE URL", self.sse), ("Health", self.health), ("Period", self.period), ("Window", self.window)):
            f.addWidget(QLabel(lab)); f.addWidget(wdg, 3 if wdg in (self.sse, self.health) else 0)
        f.addWidget(self.btn); f.addWidget(clr)
        root.addWidget(box)
        tiles = QHBoxLayout()
        self.t_state, self.t_age, self.t_ep = Tile("Link state"), Tile("Last packet age"), Tile("ESP32 endpoint")
        self.t_rssi, self.t_pend, self.t_cmd = Tile("Signal (RSSI)"), Tile("Pending commands"), Tile("Command control")
        for t in (self.t_state, self.t_age, self.t_ep, self.t_rssi, self.t_pend, self.t_cmd): tiles.addWidget(t)
        root.addLayout(tiles)
        grid = QGridLayout()
        names = ["Packet inter-arrival (ms)", "Jitter, RFC3550 (ms)", "Loss % per bucket",
                 "Gaps / dups / out-of-order", "Command RTT (ms)", "RSSI (dBm)"]
        self.charts = [ChartWidget(n) for n in names]
        for i, c in enumerate(self.charts): grid.addWidget(c, i // 3, i % 3)
        root.addLayout(grid, 1)
        self.table = QTableWidget(4, 8); self.table.horizontalHeader().setVisible(False); self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch); self.table.verticalHeader().setDefaultSectionSize(26); self.table.setFixedHeight(4 * 26 + 8); self.table.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        root.addWidget(self.table)
        self.timer = QTimer(self); self.timer.timeout.connect(self.refresh); self.timer.start(1000)
        self.window.currentIndexChanged.connect(self.refresh)
        if mock_default:
            self.kind.setCurrentIndex(1); self.period.setValue(200); self.connect_source()
        self.refresh()

    def toggle(self):
        if self.source: self.disconnect_source()
        else: self.connect_source()

    def connect_source(self):
        self.disconnect_source(); self.model.reset()
        if self.kind.currentIndex() == 1:
            self.source = MockLinkSource(self.model, period_ms=self.period.value())
        else:
            self.source = SseLinkSource(self.model, self.sse.text().strip(), self.health.text().strip(), opener=self.auth_opener)
            if self.store:
                self.store.settings.update(link_sse_url=self.sse.text().strip(), link_health_url=self.health.text().strip(),
                                           link_period_ms=self.period.value())
                self.store.save_settings()
        self.source.start(); self.btn.setText("Disconnect")

    def disconnect_source(self):
        if self.source: self.source.stop()
        self.source = None; self.btn.setText("Connect")

    def use_bridge_session(self, session):
        """Share the in-memory JWT cookie with bridge SSE reads; credentials are never copied or persisted."""
        self.disconnect_source()
        self.auth_opener = session.open_url if session else None
        if session:
            self.sse.setText(session.base + "/events"); self.health.setText(session.base + "/health")

    def compute(self, now=None):
        ev, cmds, st = self.model.snapshot()
        now = now if now is not None else self.model.server_now()
        return analyze_window(ev, cmds, period_ms=self.period.value(), window_ms=self.window.currentData(), now=now), st

    def refresh(self):
        r, st = self.compute(); s = r["summary"]; a, b = r["start"], r["end"]
        rows, ser = r["rows"], r["series"]
        self.charts[0].set_data([{"points": [(x["arrival_ms"], x["inter_arrival_ms"]) for x in rows if x["inter_arrival_ms"] != ""], "color": GOLD}], a, b, 0)
        self.charts[1].set_data([{"points": [(x["arrival_ms"], x["jitter_ms"]) for x in rows if x["jitter_ms"] != ""], "color": WARN}], a, b, 0)
        self.charts[2].set_data([{"points": [(x["t"], x["loss_pct"]) for x in ser], "color": BAD, "bars": True}], a, b, 0)
        self.charts[3].set_data([{"points": [(x["t"], x["lost"]) for x in ser], "color": BAD, "bars": True, "label": "lost"},
                                 {"points": [(x["t"], x["duplicate"]) for x in ser], "color": WARN, "bars": True, "label": "dup"},
                                 {"points": [(x["t"], x["out_of_order"]) for x in ser], "color": OK, "bars": True, "label": "ooo"}], a, b, 0)
        _, cmds, _ = self.model.snapshot()
        self.charts[4].set_data([{"points": [(c["t"], c["rtt"]) for c in cmds if c["t"] >= a and c["rtt"] is not None], "color": OK}], a, b, 0)
        self.charts[5].set_data([{"points": [(x["arrival_ms"], x["rssi"]) for x in rows if x["rssi"] is not None], "color": GOLD}], a, b, None)
        ia, rt, c = s["inter_arrival_ms"], s["commands"]["rtt_ms"], s["commands"]
        table = [["Packets", s["packets_received"], "Lost", "%s (%s%%)" % (s["lost"], fmt(s["loss_pct"])), "Duplicates", s["duplicates"], "Out-of-order", s["out_of_order"]],
                 ["Interval p50", fmt(ia["p50"], " ms"), "p95", fmt(ia["p95"], " ms"), "p99", fmt(ia["p99"], " ms"), "max", fmt(ia["max"], " ms")],
                 ["Jitter", fmt(s["rfc3550_jitter_ms"], " ms"), "Outages", "%s (max %s ms)" % (s["outages"], s["longest_outage_ms"]), "Reboots", s["seq_resets"], "Rate", fmt(s["rate_pps"], " pkt/s")],
                 ["Commands", "%s/%s ok" % (c["completed"], c["finished"]), "Timed out", c["timed_out"], "RTT p50/p95", "%s / %s ms" % (fmt(rt["p50"]), fmt(rt["p95"])), "RTT p99/max", "%s / %s ms" % (fmt(rt["p99"]), fmt(rt["max"]))]]
        for i, row in enumerate(table):
            for j, val in enumerate(row):
                it = QTableWidgetItem(str(val))
                if j % 2 == 0: it.setForeground(QColor("#777"))
                else: f = it.font(); f.setBold(True); it.setFont(f)
                self.table.setItem(i, j, it)
        # tiles (same rules as the web page)
        m = self.model
        age = (m.server_now() - m.last_received_at) if m.last_received_at else st.get("telemetry_age_ms")
        stale = st.get("telemetry_stale_after_ms") or 5000
        if not m.sse_open: label = "Bridge unreachable" if self.source else "Offline"
        elif age is not None and age <= stale: label = "Connected"
        elif age is not None and age <= 60000: label = "Stale"
        else: label = "Offline"
        col = {"Connected": OK, "Stale": WARN}.get(label, BAD)
        self.t_state.value.setStyleSheet("color:%s;font-size:16px;font-weight:bold;" % col)
        self.t_state.set(label, ("SSE open" if m.sse_open else ("SSE closed " + (m.error[:60] if m.error else ""))))
        self.t_age.set("--" if age is None else ("%d ms" % age if age < 10000 else "%.1f s" % (age / 1000)), "stale after %s ms" % stale)
        ep = st.get("telemetry_endpoint") or (m.last_endpoint and {"address": m.last_endpoint[0], "port": m.last_endpoint[1]})
        self.t_ep.set("%s:%s" % (ep["address"], ep["port"]) if ep else "--", "port changes %d · reboots %d" % (m.port_changes, s["seq_resets"]))
        self.t_rssi.set("n/a" if m.last_rssi is None else "%s dBm" % m.last_rssi,
                        "min %s · mean %s" % (s["rssi_dbm"]["min"], s["rssi_dbm"]["mean"]) if s["rssi_dbm"] else "needs v5 packets")
        self.t_pend.set(fmt(st.get("pending_commands")), "%d ok · %d failed · %d timeout" % (c["completed"], c["failed"], c["timed_out"]))
        self.t_cmd.set(("Ready" if st.get("command_ready") else "Not ready") if st else "--",
                       ("auth %s · %s" % ("configured" if st.get("command_auth_configured") else "NOT configured",
                                          "token required" if st.get("command_auth_required") else "open")) if st else "")
