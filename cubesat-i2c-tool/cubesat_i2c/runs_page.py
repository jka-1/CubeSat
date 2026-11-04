"""Recordings tab: browse telemetry runs recorded by the bridge (/runs API), graph a metric, read the
event markers, export CSV, and start/stop a recording. Everything shown comes from the bridge; nothing is
simulated. Notes appear only when data is missing."""
import threading, time

from PySide6.QtCore import Qt, QObject, QTimer, Signal, QPointF, QRectF
from PySide6.QtGui import QPainter, QPen, QColor, QBrush
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel, QLineEdit, QComboBox,
                               QPushButton, QTableWidget, QTableWidgetItem, QHeaderView, QAbstractItemView,
                               QFileDialog, QMessageBox, QSplitter, QGroupBox)

from . import runs_model as M

GOLD, OK, WARN, BAD, TXT, DIM = "#d4af37", "#2fbf55", "#e0a800", "#e05252", "#ede8d9", "#6d6a60"


class _Relay(QObject):
    done = Signal(object, object, object)   # callback, result, error


class SeriesChart(QWidget):
    """min/max band + mean line per bucket; gaps stay gaps (no interpolation)."""
    def __init__(self):
        super().__init__()
        self.data, self.unit, self.digits, self.markers = None, "", 3, []
        self.setMinimumHeight(150)

    def set_data(self, data, unit="", digits=3, markers=()):
        self.data, self.unit, self.digits, self.markers = data, unit, digits, list(markers)
        self.update()

    def paintEvent(self, _):
        p = QPainter(self); p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        p.setPen(QPen(QColor(DIM), 1)); p.drawRect(0, 0, w - 1, h - 1)
        d = self.data
        pts = (d or {}).get("points") or []
        vals = [v for q in pts for v in (q.get("min"), q.get("max")) if isinstance(v, (int, float))]
        if not d or not vals:
            p.setPen(QColor(DIM)); p.drawText(self.rect(), Qt.AlignCenter, "No data in this window" if d else "Select a run")
            return
        lo, hi = min(vals), max(vals)
        pad = (hi - lo) * 0.08 if hi > lo else max(abs(lo) * 0.05, 0.5)
        lo, hi = lo - pad, hi + pad
        L, R, T, B = 62, 8, 8, 18
        span = max(1, d["end"] - d["start"])
        X = lambda t: L + (t - d["start"]) / span * (w - L - R)
        Y = lambda v: T + (1 - (v - lo) / (hi - lo)) * (h - T - B)
        p.setPen(QColor(DIM))
        for v in (lo + pad, hi - pad):
            p.drawText(QRectF(0, Y(v) - 8, L - 6, 16), Qt.AlignRight | Qt.AlignVCenter, "%.*f %s" % (self.digits, v, self.unit))
        p.drawText(QRectF(L, h - B, w - L - R, B), Qt.AlignLeft | Qt.AlignVCenter, M.fmt_time(d["start"])[11:])
        p.drawText(QRectF(L, h - B, w - L - R, B), Qt.AlignRight | Qt.AlignVCenter, M.fmt_time(d["end"])[11:])
        band = QColor(GOLD); band.setAlpha(55)
        p.setPen(Qt.NoPen); p.setBrush(QBrush(band))
        for q in pts:
            if isinstance(q.get("min"), (int, float)) and isinstance(q.get("max"), (int, float)):
                x0, x1 = X(q["start_ms"]), max(X(q["end_ms"]), X(q["start_ms"]) + 1)
                p.drawRect(QRectF(x0, Y(q["max"]), x1 - x0, max(1, Y(q["min"]) - Y(q["max"]))))
        p.setPen(QPen(QColor(GOLD), 1.5))
        for seg in M.series_segments(pts):
            prev = None
            for q in seg:
                cur = QPointF(X((q["start_ms"] + q["end_ms"]) / 2), Y(q["mean"]))
                if prev is not None: p.drawLine(prev, cur)
                else: p.drawEllipse(cur, 1.5, 1.5)
                prev = cur
        p.setPen(QPen(QColor(WARN), 1, Qt.DashLine))
        for at in self.markers:
            if d["start"] <= at <= d["end"]:
                p.drawLine(QPointF(X(at), T), QPointF(X(at), h - B))


def _table(headers):
    t = QTableWidget(0, len(headers)); t.setHorizontalHeaderLabels(headers)
    t.verticalHeader().setVisible(False); t.setEditTriggers(QAbstractItemView.NoEditTriggers)
    t.setSelectionBehavior(QAbstractItemView.SelectRows); t.setSelectionMode(QAbstractItemView.SingleSelection)
    t.verticalHeader().setDefaultSectionSize(20)
    return t


class RecordingsPage(QWidget):
    RUN_HEADERS = ("Name", "Type", "Status", "Started", "Duration", "Packets", "End / source")

    def __init__(self, store=None, on_recording_changed=None, parent=None):
        super().__init__(parent)
        self.store, self.session, self.on_recording_changed = store, None, on_recording_changed
        self.runs, self.selected, self.events, self.status = [], None, [], {}
        self._relay = _Relay(); self._relay.done.connect(lambda cb, r, e: cb(r, e))
        self._busy = set()
        root = QVBoxLayout(self); root.setContentsMargins(6, 6, 6, 6); root.setSpacing(4)

        bar = QHBoxLayout()
        self.indicator = QLabel("RECORDINGS · NOT CONNECTED")
        self.run_name = QLineEdit(); self.run_name.setPlaceholderText("Run name"); self.run_name.setMaximumWidth(220)
        self.start_btn = QPushButton("Start recording"); self.start_btn.clicked.connect(self.start_recording)
        self.stop_btn = QPushButton("Stop recording"); self.stop_btn.clicked.connect(self.stop_recording)
        self.refresh_btn = QPushButton("Refresh"); self.refresh_btn.clicked.connect(self.refresh_runs)
        for x in (self.indicator,): bar.addWidget(x)
        bar.addStretch(1)
        for x in (self.run_name, self.start_btn, self.stop_btn, self.refresh_btn): bar.addWidget(x)
        root.addLayout(bar)
        self.note = QLabel(""); self.note.setStyleSheet("color:%s" % WARN); self.note.setVisible(False)
        root.addWidget(self.note)

        split = QSplitter(Qt.Horizontal)
        self.run_table = _table(self.RUN_HEADERS)
        hh = self.run_table.horizontalHeader(); hh.setSectionResizeMode(QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(0, QHeaderView.Stretch)
        self.run_table.itemSelectionChanged.connect(self._run_selected)
        split.addWidget(self.run_table)

        right = QWidget(); rv = QVBoxLayout(right); rv.setContentsMargins(0, 0, 0, 0); rv.setSpacing(4)
        info = QGroupBox("Run"); ig = QGridLayout(info); ig.setVerticalSpacing(2)
        self.info = {}
        for i, (k, lbl) in enumerate((("id", "Run ID"), ("device", "Device"), ("format", "Packet format"),
                                       ("provenance", "Provenance"), ("links", "Linked runs"), ("decoder", "Decoder"))):
            ig.addWidget(QLabel(lbl), i // 2, (i % 2) * 2)
            v = QLabel("—"); v.setTextInteractionFlags(Qt.TextSelectableByMouse); self.info[k] = v
            ig.addWidget(v, i // 2, (i % 2) * 2 + 1)
        ig.setColumnStretch(1, 1); ig.setColumnStretch(3, 1)
        rv.addWidget(info)
        gb = QHBoxLayout()
        self.metric = QComboBox()
        for mid, label, unit, _ in M.RUN_METRICS: self.metric.addItem("%s (%s)" % (label, unit), mid)
        self.window = QComboBox()
        for k, label in M.WINDOW_PRESETS: self.window.addItem(label, k)
        self.metric.currentIndexChanged.connect(self.load_series); self.window.currentIndexChanged.connect(self.load_series)
        self.export_btn = QPushButton("Export CSV…"); self.export_btn.clicked.connect(self.export_csv)
        for x in (QLabel("Metric"), self.metric, QLabel("Window"), self.window): gb.addWidget(x)
        gb.addStretch(1); gb.addWidget(self.export_btn)
        rv.addLayout(gb)
        self.chart = SeriesChart(); rv.addWidget(self.chart, 3)
        self.summary = QLabel(""); rv.addWidget(self.summary)
        self.event_table = _table(("Time", "Event", "Detail"))
        eh = self.event_table.horizontalHeader(); eh.setSectionResizeMode(QHeaderView.ResizeToContents)
        eh.setSectionResizeMode(2, QHeaderView.Stretch)
        rv.addWidget(self.event_table, 2)
        split.addWidget(right); split.setStretchFactor(0, 5); split.setStretchFactor(1, 6)
        root.addWidget(split, 1)

        self.timer = QTimer(self); self.timer.setInterval(5000); self.timer.timeout.connect(self._tick)
        self._sync_controls()

    # ---------------------------------------------------------------- plumbing
    def _run_async(self, key, fn, cb):
        """Run a bridge call off the GUI thread; drop overlapping calls of the same kind."""
        if key in self._busy:
            return
        self._busy.add(key)
        def work():
            try: r, e = fn(), None
            except Exception as ex: r, e = None, ex
            self._busy.discard(key)
            self._relay.done.emit(cb, r, e)
        threading.Thread(target=work, daemon=True).start()

    def use_session(self, session):
        self.session = session
        self.runs, self.selected, self.events, self.status = [], None, [], {}
        self.run_table.setRowCount(0); self.event_table.setRowCount(0); self.chart.set_data(None)
        for v in self.info.values(): v.setText("—")
        self.summary.setText("")
        if session:
            self.timer.start(); self.refresh_runs()
        else:
            self.timer.stop()
        self._sync_controls()

    def _tick(self):
        if self.isVisible():
            self.refresh_runs()

    def _can_operate(self):
        s = self.session
        return bool(s) and (not getattr(s, "auth_enabled", False) or (getattr(s, "user", None) or {}).get("role") == "operator")

    def _sync_controls(self):
        rec = (self.status.get("recording") or {}) if self.session else {}
        active = bool(rec.get("active_run_id"))
        usable = bool(self.session) and rec.get("enabled") and rec.get("ready") and not rec.get("error")
        op = self._can_operate()
        self.start_btn.setEnabled(bool(usable and op and not active))
        self.stop_btn.setEnabled(bool(self.session and op and active))
        self.refresh_btn.setEnabled(bool(self.session))
        self.export_btn.setEnabled(bool(self.selected))
        if not self.session:
            text, col = "RECORDINGS · NOT CONNECTED", DIM
        elif active:
            name = next((r.get("name") for r in self.runs if r.get("id") == rec.get("active_run_id")), "")
            text, col = "● RECORDING%s" % (" · " + name if name else ""), BAD
        elif usable:
            text, col = "RECORDINGS · READY" if op else "RECORDINGS · VIEWER (read-only)", OK
        else:
            text, col = "RECORDINGS · UNAVAILABLE", WARN
        self.indicator.setText(text)
        self.indicator.setStyleSheet("color:%s;border:1px solid %s;border-radius:10px;padding:3px 10px;font-weight:bold" % (col, col))

    def _show_note(self, text):
        self.note.setText(text); self.note.setVisible(bool(text))

    # ---------------------------------------------------------------- runs list
    def refresh_runs(self):
        if not self.session: return
        s = self.session
        self._run_async("runs", lambda: s.list_runs(50, 0), self._runs_loaded)

    def _runs_loaded(self, data, err):
        if not self.session: return
        if err:
            self.status = {}
            self._show_note("Recordings unavailable: %s" % err); self._sync_controls(); return
        self.status = data or {}
        self.runs = data.get("runs") or []
        note = M.recording_note(self.status)
        self._show_note(note or ("" if self.runs else "No recorded runs yet."))
        keep = self.selected.get("id") if self.selected else None
        now = time.time() * 1000
        t = self.run_table; t.blockSignals(True); t.setRowCount(len(self.runs))
        sel_row = None
        for i, run in enumerate(self.runs):
            for j, v in enumerate(M.run_row(run, now)):
                it = QTableWidgetItem(v)
                if j == 2: it.setForeground(QColor({"recording": BAD, "completed": OK}.get(run.get("status"), WARN)))
                t.setItem(i, j, it)
            if run.get("id") == keep: sel_row = i
        if sel_row is not None: t.selectRow(sel_row)
        t.blockSignals(False)
        if keep and sel_row is not None:
            self.selected = self.runs[sel_row]
            if self.selected.get("status") == "recording": self.load_series(); self.load_events()
        self._sync_controls()

    def _run_selected(self):
        rows = self.run_table.selectionModel().selectedRows()
        if not rows: return
        self.selected = self.runs[rows[0].row()]
        r = self.selected; md = r.get("metadata") or {}
        prov = md.get("telemetry_provenance") or {}
        self.info["id"].setText(r.get("id", "—"))
        self.info["device"].setText("%s @ %s" % (r.get("device_id", "—"), r.get("remote_address", "—")))
        self.info["format"].setText(str(md.get("packet_format") or "—"))
        self.info["provenance"].setText("signed (%s)" % prov.get("scheme") if prov.get("authenticated") else "unsigned")
        links = []
        if r.get("previous_run_id"): links.append("prev " + r["previous_run_id"][:8])
        if r.get("next_run_id"): links.append("next " + r["next_run_id"][:8])
        self.info["links"].setText(", ".join(links) or "—")
        self.info["decoder"].setText(str(md.get("decoder_revision") or "—"))
        self._sync_controls(); self.load_series(); self.load_events()

    # ---------------------------------------------------------------- series/events
    def _window(self):
        return M.window_for_preset(self.selected, self.window.currentData(), time.time() * 1000)

    def _metric(self):
        mid = self.metric.currentData()
        return next(m for m in M.RUN_METRICS if m[0] == mid)

    def load_series(self):
        if not (self.session and self.selected): return
        s, rid, (mid, _, unit, digits), w = self.session, self.selected["id"], self._metric(), self._window()
        def done(data, err):
            if err:
                self.chart.set_data(None); self.summary.setText("Series unavailable: %s" % err); return
            if not self.selected or self.selected.get("id") != rid: return
            marks = [e.get("at_ms") for e in self.events if e.get("type") in ("sequence_step", "source_switch", "mode_changed", "device_reboot")]
            self.chart.set_data(data, unit, digits, marks)
            sm = M.series_summary(data.get("points") or [])
            if sm["valid"]:
                self.summary.setText("min <b>%.*f</b> · max <b>%.*f</b> · mean <b>%.*f</b> %s · %d valid of %d packets" % (
                    digits, sm["min"], digits, sm["max"], digits, sm["mean"], unit, sm["valid"], sm["samples"]))
            else:
                self.summary.setText("No %s values in this window (%d packets)." % (mid, sm["samples"]))
        self._run_async("series", lambda: s.run_series(rid, mid, w["start"], w["end"], 400), done)

    def load_events(self):
        if not (self.session and self.selected): return
        s, rid = self.session, self.selected["id"]
        def done(data, err):
            if err or not self.selected or self.selected.get("id") != rid: return
            self.events = (data or {}).get("items") or []
            t = self.event_table; t.setRowCount(len(self.events))
            for i, ev in enumerate(self.events):
                for j, v in enumerate(M.event_row(ev)): t.setItem(i, j, QTableWidgetItem(v))
            if self.chart.data:
                self.chart.markers = [e.get("at_ms") for e in self.events if e.get("type") in ("sequence_step", "source_switch", "mode_changed", "device_reboot")]
                self.chart.update()
        self._run_async("events", lambda: s.run_events(rid, 0, 500), done)

    # ---------------------------------------------------------------- actions
    def start_recording(self):
        if not self.session: return
        name = self.run_name.text().strip() or "Windows recording %s" % time.strftime("%H:%M:%S")
        try:
            self.session.start_recording(name)
        except Exception as e:
            QMessageBox.warning(self, "Recording not started", str(e))
        self._after_change()

    def stop_recording(self):
        if not self.session: return
        try:
            self.session.stop_recording()
        except Exception as e:
            QMessageBox.warning(self, "Recording not stopped", str(e))
        self._after_change()

    def _after_change(self):
        self.refresh_runs()
        if self.on_recording_changed: self.on_recording_changed()

    def export_csv(self):
        if not (self.session and self.selected): return
        r, (mid, *_), w = self.selected, self._metric(), self._window()
        default = "%s-%s.csv" % ("".join(c if c.isalnum() or c in "-_" else "_" for c in (r.get("name") or "run")), r["id"][:8])
        path, _ = QFileDialog.getSaveFileName(self, "Export run CSV", default, "CSV (*.csv)")
        if not path: return
        s = self.session
        def done(n, err):
            if err: QMessageBox.warning(self, "Export failed", str(err))
            else: self.summary.setText("Exported %d packets to %s" % (n, path))
        def work():
            with open(path, "w", newline="", encoding="utf-8") as fh:
                return M.export_csv(lambda a, b, after, lim: s.run_samples(r["id"], a, b, after, lim), mid, w["start"], w["end"], fh)
        self.summary.setText("Preparing CSV export…")
        self._run_async("export", work, done)
