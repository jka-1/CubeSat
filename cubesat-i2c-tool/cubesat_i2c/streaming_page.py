"""Streaming Telemetry tab (Debug (Wireless)): live present-only device cards with sparklines, fed by the bridge
SSE stream through link_source.SseLinkSource and the shared StreamingModel (port of streaming-telemetry.mjs)."""
from PySide6.QtCore import Qt, QTimer, QPointF
from PySide6.QtGui import QPainter, QPen, QColor, QFont, QBrush
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel, QLineEdit, QComboBox,
    QPushButton, QCheckBox, QFrame, QSizePolicy, QScrollArea)

from .link_source import SseLinkSource
from .streaming_model import StreamingModel, WINDOWS, MPPT_FAULT_BITS, fmt_si

# Per-card visibility toggles (by IC / ADC device), saved in the app settings. Default: all on.
CARD_TOGGLES = (("pv", "INA226"), ("bms", "BQ76942"), ("mppt", "BQ25798"), ("mcu", "ESP32-S3"),
                ("mcp9700", "MCP9700"), ("temt6000", "TEMT6000"))
CELL_REGS = ("0x14", "0x16", "0x18", "0x1A")


def card_toggles(settings):
    saved = (settings or {}).get("stream_cards") or {}
    return {k: saved.get(k, True) is not False for k, _ in CARD_TOGGLES}


GOLD, OK, WARN, BAD, TXT, DIM = "#d4af37", "#2fbf55", "#e0a800", "#e05252", "#ede8d9", "#6d6a60"
CELL_MIN, CELL_MAX = 3.0, 4.3


def fmt(v, digits, unit=""):
    return "--" if v is None else ("%.*f%s" % (digits, v, unit))


def cell_color(v):
    if v is None: return DIM
    if v < 3.3 or v > 4.2: return BAD
    if v < 3.5 or v > 4.15: return WARN
    return OK


class Sparkline(QWidget):
    def __init__(self):
        super().__init__()
        self.series, self.color = None, QColor(GOLD)
        self.setFixedSize(84, 18)

    def set_series(self, s, enabled=True):
        self.series = s; self.color = QColor(GOLD if enabled else DIM); self.update()

    def paintEvent(self, _):
        s = self.series
        if not s or not s["points"]:
            return
        pts = s["points"]; vals = [v for _, v in pts if v is not None]
        if not vals:
            return
        p = QPainter(self); p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        start = max(s["start"], pts[0][0]); span = max(1, s["end"] - start)   # fit x while history < window
        lo, hi = min(vals), max(vals)
        if hi == lo: lo, hi = lo - 1, hi + 1
        X = lambda t: 2 + (t - start) / span * (w - 6)
        Y = lambda v: 3 + (1 - (v - lo) / (hi - lo)) * (h - 6)
        p.setPen(QPen(self.color, 1.4))
        prev = None
        for t, v in pts:
            if v is None:
                prev = None; continue          # gap while the device was absent
            cur = QPointF(X(t), Y(v))
            if prev is not None: p.drawLine(prev, cur)
            prev = cur
        last = next(((t, v) for t, v in reversed(pts) if v is not None), None)
        if last:
            p.setBrush(QBrush(self.color)); p.setPen(Qt.NoPen); p.drawEllipse(QPointF(X(last[0]), Y(last[1])), 2.2, 2.2)


class Gauge(QWidget):
    def __init__(self):
        super().__init__(); self.v, self.stale = None, False; self.setFixedSize(44, 7)

    def set_value(self, v, stale=False):
        self.v, self.stale = v, stale; self.update()

    def paintEvent(self, _):
        p = QPainter(self); p.setRenderHint(QPainter.Antialiasing); p.setPen(Qt.NoPen)
        p.setBrush(QColor("#2a2a2a")); p.drawRoundedRect(0, 0, self.width(), self.height(), 4, 4)
        if self.v is None: return
        f = max(0.0, min(1.0, (self.v - CELL_MIN) / (CELL_MAX - CELL_MIN)))
        p.setBrush(QColor(DIM if self.stale else cell_color(self.v))); p.drawRoundedRect(0, 0, int(self.width() * f), self.height(), 4, 4)


class Card(QFrame):
    def __init__(self, key, title, sub):
        super().__init__()
        self.key = key; self.setObjectName("stcard"); self.rows = {}; self.row_labels = {}
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Maximum)
        v = QVBoxLayout(self); v.setContentsMargins(8, 5, 8, 6); v.setSpacing(2)
        head = QHBoxLayout()
        self.title = QLabel("<b>%s</b> <span style='color:%s;font-size:9px'>%s</span>" % (title, DIM, sub))
        self.age = QLabel(""); self.age.setAlignment(Qt.AlignRight)
        head.addWidget(self.title); head.addStretch(); head.addWidget(self.age); v.addLayout(head)
        self.grid = QGridLayout(); self.grid.setHorizontalSpacing(6); self.grid.setVerticalSpacing(1); v.addLayout(self.grid)
        self.extra = QVBoxLayout(); v.addLayout(self.extra)
        self.set_stale(False)

    def add_row(self, rk, label, series=None, gauge=False):
        r = self.grid.rowCount()
        name = QLabel(label); val = QLabel("--"); val.setMinimumWidth(78); val.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        val.setStyleSheet("font-weight:bold;font-size:12px")
        self.grid.addWidget(name, r, 0); self.row_labels[rk] = name
        g = None
        if gauge:
            g = Gauge(); self.grid.addWidget(g, r, 1)
        self.grid.addWidget(val, r, 2)
        sp = Sparkline() if series else None
        if sp: self.grid.addWidget(sp, r, 3)
        self.rows[rk] = (val, sp, series, g)

    def set_stale(self, stale):
        self.stale = stale
        border, fg = ("#3a3a3a", DIM) if stale else ("#6b5520", TXT)
        self.setStyleSheet("#stcard{border:1px solid %s;border-radius:10px;background:#16171a;}"
                           "QLabel{color:%s;background:transparent;font-size:11px;}" % (border, fg))


class StreamingPage(QWidget):
    def __init__(self, store=None):
        super().__init__()
        self.store = store; self.model = StreamingModel(); self.source = None
        root = QVBoxLayout(self)
        bar = QHBoxLayout()
        base = (store.settings.get("bridge_url") if store else None) or "http://127.0.0.1:8080"
        self.url = QLineEdit(base); self.url.setMinimumWidth(260)
        self.url.setToolTip("Bridge base URL (same as Debug (Wireless)); the tab reads <base>/events and <base>/health")
        self.tls = QCheckBox("Verify TLS"); self.tls.setChecked(True)
        self.btn = QPushButton("Start streaming"); self.btn.clicked.connect(self.toggle)
        self.window = QComboBox()
        for label, ms in WINDOWS: self.window.addItem(label, ms)
        self.window.setCurrentIndex(1)
        root.setContentsMargins(4, 4, 4, 4); root.setSpacing(3)
        self.indicator = QLabel(); self.indicator.setMinimumWidth(230); self.indicator.setAlignment(Qt.AlignCenter); self.meta = QLabel("")
        self.meta.setStyleSheet("font-size:11px")
        for x in (self.indicator, QLabel("Bridge"), self.url, self.tls, self.btn): bar.addWidget(x)
        bar.addStretch(); bar.addWidget(QLabel("Window")); bar.addWidget(self.window)
        root.addLayout(bar)
        self.toggles = card_toggles(store.settings if store else None); self.toggle_boxes = {}
        tg = QHBoxLayout(); tg.setSpacing(10); tg.addWidget(QLabel("Show"))
        for k, label in CARD_TOGGLES:
            cb = QCheckBox(label); cb.setChecked(self.toggles[k]); cb.toggled.connect(lambda on, k=k: self.set_toggle(k, on))
            tg.addWidget(cb); self.toggle_boxes[k] = cb
        tg.addStretch(); root.addLayout(tg)
        st = QHBoxLayout(); st.setSpacing(8)
        # absent chips collapse into this one row next to the status meta
        self.hidden_lbl = QLabel(""); self.hidden_lbl.setTextFormat(Qt.RichText); self.hidden_lbl.setStyleSheet("font-size:10px")
        st.addWidget(self.meta); st.addStretch(); st.addWidget(self.hidden_lbl)
        root.addLayout(st)
        self.empty = QLabel("No data")
        self.empty.setStyleSheet("color:%s" % DIM); root.addWidget(self.empty)
        holder = QWidget(); holder.setObjectName("stholder"); holder.setStyleSheet("#stholder{background:#0d0d0f;border-radius:10px}")
        self.cards_grid = QGridLayout(holder); self.cards_grid.setSpacing(6)
        self.cards_grid.setAlignment(Qt.AlignTop); self.cards_grid.setContentsMargins(6, 6, 6, 6)
        for col in range(3): self.cards_grid.setColumnStretch(col, 1)
        root.addWidget(holder, 1)   # no scroll area: compact cards fit one screen
        self.cards = self._build_cards(); self._layout_key = None
        self.timer = QTimer(self); self.timer.setInterval(500); self.timer.timeout.connect(self.refresh)
        self.timer.start(); self.refresh()

    # ------------------------------------------------------------ cards
    def _build_cards(self):
        pv = Card("pv", "PV · INA226", "0x40")
        for rk, label, s in (("busV", "Bus voltage · 0x02", "pv.busV"), ("powerMw", "Power · 0x03", "pv.powerMw"),
                             ("currentMa", "Current · 0x04", "pv.currentMa"), ("shuntMv", "Shunt · 0x01", "pv.shuntMv")):
            pv.add_row(rk, label, s)
        bms = Card("bms", "BMS · BQ76942", "0x08")
        for i, label in enumerate(("Cell 1", "Cell 2", "Cell 3", "Cell 4")):
            bms.add_row("cell%d" % i, "%s · %s" % (label, CELL_REGS[i]), "bms.cell%d" % i, gauge=True)
        bms.add_row("deltaMv", "Cell spread", "bms.deltaMv")
        bms.add_row("packV", "Pack voltage · 0x36", "bms.packV")
        bms.add_row("intTempC", "Internal temp · 0x68", "bms.intTempC")
        bms.summary = QLabel(""); bms.extra.addWidget(bms.summary)
        mppt = Card("mppt", "MPPT · BQ25798", "0x6B")
        ac = QHBoxLayout(); ac.addWidget(QLabel("ACDRV path · 0x13")); mppt.acdrv = QLabel("--"); mppt.reg13 = QLabel("")
        ac.addWidget(mppt.acdrv); ac.addWidget(mppt.reg13); ac.addStretch(); mppt.extra.addLayout(ac)
        badges = QGridLayout(); mppt.badges = []
        for i, n in enumerate(MPPT_FAULT_BITS):
            b = QLabel(n.replace("_STAT", "")); b.setAlignment(Qt.AlignCenter); badges.addWidget(b, i // 6, i % 6); mppt.badges.append(b)
        mppt.extra.addLayout(badges)
        mppt.add_row("faults", "Active faults · 0x20", "mppt.faults")
        mppt.vb = QLabel(""); mppt.vb.setTextFormat(Qt.RichText); mppt.extra.addWidget(mppt.vb)   # power-path flow line
        for rk, label, s in (("vbusV", "VBUS · 0x35", "mppt.vbusV"), ("vac1V", "VAC1 · 0x37", "mppt.vac1V"),
                             ("vbatV", "VBAT · 0x3B", "mppt.vbatV"), ("vsysV", "VSYS · 0x3D", "mppt.vsysV"),
                             ("ibusMa", "IBUS · 0x31", "mppt.ibusMa"), ("dieTempC", "Die temp · 0x41", "mppt.dieTempC")):
            mppt.add_row(rk, label, s)
        mcu = Card("mcu", "ESP32-S3", "on-die"); mcu.add_row("tempC", "MCU temperature", "mcu.tempC")
        per = Card("peripheral", "ADC devices", "ESP32-S3 ADC1")
        per.add_row("tempC", "MCP9700 temp · GPIO1", "per.tempC"); per.add_row("tempMv", "MCP9700 output · GPIO1", "per.tempMv")
        per.add_row("light", "TEMT6000 light · GPIO2", "per.light")
        per.rows["light"][0].setMinimumWidth(150)   # "Lightly Lit · 732 mV" must not be clipped
        return {c.key: c for c in (pv, bms, mppt, mcu, per)}

    def _relayout(self, keys):
        if keys == self._layout_key:
            return                                  # visible set unchanged: no re-flow, no layout jump
        self._layout_key = keys
        for c in self.cards.values():
            self.cards_grid.removeWidget(c); c.setVisible(False)
        # Fixed columns so everything fits one screen: col0 = PV + MCU + ADC stacked, col1 = BMS, col2 = MPPT.
        cols = {0: [], 1: [], 2: []}
        home = {"pv": 0, "mcu": 0, "peripheral": 0, "bms": 1, "mppt": 2}
        for k in keys:
            cols[home.get(k, 0)].append(k)
        free = [c for c in (1, 2) if not cols[c]]
        while free and len(cols[0]) > 1:                     # spread col0 into empty columns
            cols[free.pop(0)].append(cols[0].pop())
        for col, ks in cols.items():
            for row, k in enumerate(ks):
                span = 4 if len(ks) == 1 else 1         # a lone card spans the column so col0 stacks tightly
                self.cards_grid.addWidget(self.cards[k], row, col, span, 1, Qt.AlignTop); self.cards[k].setVisible(True)
        for r in range(4): self.cards_grid.setRowStretch(r, 0)
        self.cards_grid.setRowStretch(3, 1)

    # ------------------------------------------------------------ source
    def running(self):
        return self.source is not None

    def start(self, base=None, verify_tls=None, opener=None):
        if base: self.url.setText(base)
        if verify_tls is not None: self.tls.setChecked(verify_tls)
        self.stop()
        b = self.url.text().strip().rstrip("/")
        self.model = StreamingModel()   # fresh model: a lingering old reader thread cannot write into it
        self.source = SseLinkSource(self.model, b + "/events", b + "/health",
                                    verify_tls=self.tls.isChecked(), opener=opener)
        self.source.start(); self.btn.setText("Stop streaming"); self.refresh()

    def stop(self):
        if self.source:
            self.source.stop(); self.source = None
        self.btn.setText("Start streaming")

    def toggle(self):
        self.stop() if self.running() else self.start()

    # ------------------------------------------------------------ render
    def refresh(self):
        s = self.model.snapshot()
        win = self.window.currentData()
        live = self.running() and s["hasData"] and not s["stale"]
        if not self.running():
            text, col = "STREAMING TELEMETRY · OFF", DIM
        elif not s["hasData"]:
            text, col = "STREAMING TELEMETRY · WAITING", WARN
        else:
            text, col = "STREAMING TELEMETRY · %s" % ("LIVE" if live else "STALE"), OK if live else WARN
        self.indicator.setText(text)
        self.indicator.setStyleSheet("color:%s;border:1px solid %s;border-radius:10px;padding:3px 10px;font-weight:bold" % (col, col))
        age = s["ageMs"]
        self.meta.setText("" if not s["hasData"] else "%s · seq %s · last update %s · %d packets%s" % (
            s["format"], s["seq"], fmt_age(age), s["packets"],
            ("" if s["sseOpen"] or not self.running() else " · SSE reconnecting")
            + (" · signed" if s.get("signed") else "") + (" · ● REC" if s.get("recording") else "")))
        self.hidden_lbl.setText(" ".join(
            "<span style='color:%s;border:1px dashed %s'>&nbsp;%s · %s&nbsp;</span>" % (DIM, DIM, h["label"], h["state"].replace("_", " ").replace("error", "bus error"))
            for h in s["hidden"]))
        self.hidden_lbl.setVisible(bool(s["hidden"]))
        t = self.toggles
        keys = tuple([d["key"] for d in s["devices"] if t.get(d["key"], True)] + (["mcu"] if s["mcu"] and t["mcu"] else [])
                     + (["peripheral"] if s["peripheral"] and (t["mcp9700"] or t["temt6000"]) else []))
        self.empty.setVisible(not keys)
        self._relayout(keys)
        stale = s["stale"]
        for d in s["devices"]:
            if d["key"] in keys: self._fill(d["key"], d["data"], stale, win, age)
        if "mcu" in keys: self._fill("mcu", s["mcu"], stale, win, age)
        if "peripheral" in keys: self._fill("peripheral", s["peripheral"], stale, win, age)

    def set_toggle(self, key, on):
        self.toggles[key] = bool(on)
        if self.store:
            self.store.settings["stream_cards"] = dict(self.toggles); self.store.save_settings()
        self.refresh()

    def _fill(self, key, data, stale, win, age):
        c = self.cards[key]
        if c.stale != stale: c.set_stale(stale)
        c.age.setText(fmt_age(age))
        vals = {}
        if key == "pv":
            vals = {"busV": fmt(data["busV"], 3, " V"), "currentMa": fmt(data["currentMa"], 2, " mA"),
                    "powerMw": fmt(data["powerMw"], 2, " mW"), "shuntMv": fmt(data["shuntMv"], 3, " mV")}
        elif key == "bms":
            for i, cell in enumerate(data["cells"]):
                vals["cell%d" % i] = fmt(cell["v"], 3, " V"); c.rows["cell%d" % i][3].set_value(cell["v"], stale)
            vals["deltaMv"] = fmt(data["deltaMv"], 0, " mV")
            c.summary.setText("min <b>%s</b> &nbsp; max <b>%s</b> &nbsp; Δ <b>%s</b>" % (
                fmt(data["minV"], 3, " V"), fmt(data["maxV"], 3, " V"), fmt(data["deltaMv"], 0, " mV")))
            vals["packV"] = fmt(data["packV"], 2, " V"); vals["intTempC"] = fmt(data["intTempC"], 1, " °C")
        elif key == "mppt":
            ac = data["acdrv"] or "--"; on = ac not in ("off", "--", "unknown")
            c.acdrv.setText(" %s " % {"acdrv1": "ACDRV1 · VIN1", "acdrv2": "ACDRV2 · VIN2", "both": "ACDRV1+2"}.get(ac, ac.upper()))
            c.acdrv.setStyleSheet("background:%s;color:%s;border-radius:9px;padding:2px 8px;font-weight:bold" % (
                (OK, "#08130b") if on and not stale else ("#2a2a2a", TXT)))
            c.reg13.setText("" if data["reg13"] is None else "REG13 0x%02X" % data["reg13"])
            for b, f in zip(c.badges, data["faults"]):
                lit = f["active"] and not stale
                b.setStyleSheet("border:1px solid %s;border-radius:6px;padding:2px 4px;font-size:10px;%s" % (
                    BAD if f["active"] else "#3a3a3a", "background:%s;color:white;font-weight:bold" % BAD if lit else "color:%s" % DIM))
            vals["faults"] = str(data["activeFaults"])
            c.vb.setText("<b>Power path</b> &nbsp; VAC1 <b>%s</b> → VBUS <b>%s</b> → VSYS <b>%s</b> → VBAT <b>%s</b>" % (
                fmt(data["vac1V"], 2, " V"), fmt(data["vbusV"], 2, " V"), fmt(data["vsysV"], 2, " V"), fmt(data["vbatV"], 2, " V")))
            vals.update({"vbusV": fmt(data["vbusV"], 3, " V"), "vac1V": fmt(data["vac1V"], 3, " V"),
                         "vbatV": fmt(data["vbatV"], 3, " V"), "vsysV": fmt(data["vsysV"], 3, " V"),
                         "ibusMa": fmt(data["ibusMa"], 0, " mA"), "dieTempC": fmt(data["dieTempC"], 1, " °C")})
        elif key == "mcu":
            vals = {"tempC": fmt(data["tempC"], 1, " °C")}
        elif key == "peripheral":
            adc = self.model.snapshot().get("adc") or {"temp": {}, "light": {}}
            vals = {"tempC": fmt(data["temperatureC"], 1, " °C"),
                    "light": "--" if data["lightVoltageMv"] is None else "%s · %.0f mV" % (
                        data["lightLevel"], data["lightVoltageMv"]),
                    "tempMv": fmt(adc["temp"].get("mv"), 0, " mV")}
            show = {"tempC": self.toggles["mcp9700"], "tempMv": self.toggles["mcp9700"], "light": self.toggles["temt6000"]}
            for rk, on in show.items():
                val, sp, _s, _g = c.rows[rk]
                for w in (val, sp, c.row_labels[rk]):
                    if w is not None: w.setVisible(on)
        for rk, (val, sp, series, _g) in c.rows.items():
            if rk in vals: val.setText(vals[rk])
            if sp: sp.set_series(self.model.series_window(series, win), enabled=not stale)

    def closeEvent(self, e):
        self.stop(); super().closeEvent(e)


def fmt_age(ms):
    if ms is None: return "--"
    if ms < 1000: return "%d ms ago" % ms
    if ms < 60_000: return "%.1f s ago" % (ms / 1000)
    return "%d min ago" % (ms // 60_000)
