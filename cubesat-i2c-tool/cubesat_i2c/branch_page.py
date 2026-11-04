"""Branch Definition tab: build, save, simulate and run bridge sequences, concurrently with the web
Branch Definition page. Definitions are the bridge's version 1 sequence JSON (same schema as the web), saved
through /sequences with the revision check, so an edit in either client shows up in the other. The bridge
sequence engine is the only executor; this tab never sends block commands itself."""
import copy, json, threading, uuid

from PySide6.QtCore import Qt, QObject, QTimer, Signal
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QLineEdit, QComboBox,
                               QPushButton, QTreeWidget, QTreeWidgetItem, QSplitter, QGroupBox, QPlainTextEdit,
                               QListWidget, QSpinBox, QMessageBox, QDialog, QDialogButtonBox, QCheckBox, QScrollArea)

from . import sequence_model as M
from .wireless_session import SequenceConflict

GOLD, OK, WARN, BAD, DIM = "#d4af37", "#2fbf55", "#e0a800", "#e05252", "#6d6a60"
LIBRARY_KEY = "sequence_registers"
OPERAND_KINDS = (("metric", "Telemetry"), ("register", "Register"), ("step", "Block result"), ("fault", "Fault flag"), ("constant", "Constant"))


class _Relay(QObject):
    done = Signal(object, object, object)


class AddRegisterDialog(QDialog):
    """Device address / register / width / byte order / name, validated like the web editor."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Add register")
        f = QFormLayout(self)
        self.addr = QLineEdit(); self.addr.setPlaceholderText("0x48")
        self.reg = QLineEdit(); self.reg.setPlaceholderText("0x00")
        self.width = QComboBox(); self.width.addItem("1 byte", 1); self.width.addItem("2 bytes", 2)
        self.endian = QComboBox(); self.endian.addItem("Big endian", "big"); self.endian.addItem("Little endian", "little")
        self.name = QLineEdit(); self.name.setMaxLength(60); self.name.setPlaceholderText("optional")
        self.err = QLabel(""); self.err.setStyleSheet("color:%s" % BAD); self.err.setWordWrap(True)
        for label, w in (("Device address (hex)", self.addr), ("Register (hex)", self.reg), ("Width", self.width),
                         ("Byte order", self.endian), ("Name", self.name)):
            f.addRow(label, w)
        f.addRow(self.err)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self._accept); bb.rejected.connect(self.reject); f.addRow(bb)
        self.entry = None

    def _accept(self):
        entry, errors = M.parse_user_register(self.addr.text(), self.reg.text(), self.width.currentData(),
                                              self.endian.currentData(), self.name.text())
        if errors:
            self.err.setText("\n".join(errors)); return
        self.entry = entry; self.accept()


class OperandEditor(QWidget):
    changed = Signal()

    def __init__(self, page, parent=None):
        super().__init__(parent)
        self.page = page
        h = QHBoxLayout(self); h.setContentsMargins(0, 0, 0, 0)
        self.kind = QComboBox()
        for k, label in OPERAND_KINDS: self.kind.addItem(label, k)
        self.value = QComboBox(); self.value.setMinimumWidth(240)
        self.const = QLineEdit(); self.const.setMaximumWidth(110)
        self.unit = QComboBox()
        for u in sorted(set(M.METRIC_UNITS.values())) + ["hex", "boolean"]: self.unit.addItem(u, u)
        self.add_reg = QPushButton("Add register…")
        for w in (self.kind, self.value, self.const, self.unit, self.add_reg): h.addWidget(w)
        h.addStretch(1)
        self.kind.currentIndexChanged.connect(self._kind_changed)
        self.value.currentIndexChanged.connect(lambda _: self._emit())
        self.const.editingFinished.connect(self._emit)
        self.unit.currentIndexChanged.connect(lambda _: self._emit())
        self.add_reg.clicked.connect(self._add_register)
        self._loading = False
        self.block_id = None

    def _fill_values(self, kind, selected=None):
        self.value.blockSignals(True); self.value.clear()
        if kind == "metric":
            for mid, label, unit in M.METRICS: self.value.addItem("%s (%s)" % (label, unit), mid)
        elif kind == "register":
            for r in self.page.draft.get("registers") or []: self.value.addItem("Added · " + M.user_register_label(r), r["id"])
            for r in M.CONDITION_REGISTERS: self.value.addItem(r["label"], r["id"])
        elif kind == "step":
            for s in M.earlier_reads(self.page.draft["steps"], self.block_id): self.value.addItem(M.describe_read(s), s["id"])
            if self.value.count() == 0: self.value.addItem("(add a Register read block earlier on this path)", "")
        elif kind == "fault":
            for f in M.CONDITION_FAULTS: self.value.addItem(f, f)
        if selected is not None:
            i = self.value.findData(selected)
            if i >= 0: self.value.setCurrentIndex(i)
        self.value.blockSignals(False)
        const = kind == "constant"
        self.value.setVisible(not const); self.const.setVisible(const); self.unit.setVisible(const)
        self.add_reg.setVisible(kind == "register")

    def set_operand(self, operand, block_id):
        self._loading = True; self.block_id = block_id
        operand = operand or {}
        kind = next((k for k, _ in OPERAND_KINDS if k in operand), "constant")
        self.kind.blockSignals(True); self.kind.setCurrentIndex(self.kind.findData(kind)); self.kind.blockSignals(False)
        self._fill_values(kind, operand.get(kind))
        if kind == "constant":
            c, u = operand.get("constant", 0), operand.get("unit", "V")
            self.const.setText(("0x%X" % c) if u == "hex" and isinstance(c, int) else ("true" if c is True else "false" if c is False else str(c)))
            self.unit.setCurrentIndex(max(0, self.unit.findData(u)))
        self._loading = False

    def operand(self):
        kind = self.kind.currentData()
        if kind != "constant":
            return {kind: self.value.currentData() or ""}
        unit, text = self.unit.currentData(), self.const.text().strip()
        if unit == "boolean": return {"constant": text.lower() in ("1", "true", "yes", "on"), "unit": unit}
        try:
            value = int(text, 16) if unit == "hex" else float(text)
            if unit != "hex" and value == int(value): value = int(value)
        except ValueError:
            value = 0
        return {"constant": value, "unit": unit}

    def _kind_changed(self, _):
        self._fill_values(self.kind.currentData()); self._emit()

    def _emit(self):
        if not self._loading: self.changed.emit()

    def _add_register(self):
        dlg = AddRegisterDialog(self)
        if dlg.exec() != QDialog.Accepted: return
        rid, err = M.add_user_register(self.page.draft, dlg.entry)
        if err:
            QMessageBox.warning(self, "Add register", err); return
        self.page.remember_register(dlg.entry)
        self._fill_values("register", rid); self._emit()


class ConditionEditor(QGroupBox):
    """Comparison editor (left operand, operator, right operand) plus JSON for AND / OR / NOT conditions."""
    changed = Signal()

    def __init__(self, page, parent=None):
        super().__init__("Condition", parent)
        self.page = page
        v = QVBoxLayout(self)
        self.mode = QComboBox(); self.mode.addItem("Comparison", "cmp")
        for op in M.LOGICAL: self.mode.addItem(op + " (JSON)", op)
        self.left, self.right = OperandEditor(page), OperandEditor(page)
        self.op = QComboBox()
        for op in M.OPERATORS: self.op.addItem("& (bit mask set)" if op == "&" else op, op)
        self.json = QPlainTextEdit(); self.json.setFixedHeight(90)
        self.apply_json = QPushButton("Apply JSON")
        v.addWidget(self.mode)
        self.cmp_box = QWidget(); cv = QFormLayout(self.cmp_box); cv.setContentsMargins(0, 0, 0, 0)
        cv.addRow("Left", self.left); cv.addRow("Operator", self.op); cv.addRow("Right", self.right)
        v.addWidget(self.cmp_box); v.addWidget(self.json); v.addWidget(self.apply_json)
        self.left.changed.connect(self._cmp_changed); self.right.changed.connect(self._cmp_changed)
        self.op.currentIndexChanged.connect(lambda _: self._cmp_changed())
        self.mode.currentIndexChanged.connect(self._mode_changed)
        self.apply_json.clicked.connect(self._apply_json)
        self.step, self._loading = None, False

    def load(self, step):
        self._loading = True; self.step = step
        c = step.get("condition") or M.comparison()
        logical = c.get("op") in M.LOGICAL
        self.mode.setCurrentIndex(self.mode.findData(c["op"] if logical else "cmp"))
        if not logical:
            self.left.set_operand(c.get("left"), step["id"]); self.right.set_operand(c.get("right"), step["id"])
            self.op.setCurrentIndex(max(0, self.op.findData(c.get("op"))))
        self.json.setPlainText(json.dumps(c, indent=1))
        self._show(logical); self._loading = False

    def _show(self, logical):
        self.cmp_box.setVisible(not logical)
        self.json.setReadOnly(not logical); self.apply_json.setVisible(logical)

    def _cmp_changed(self):
        if self._loading or not self.step: return
        self.step["condition"] = {"op": self.op.currentData(), "left": self.left.operand(), "right": self.right.operand()}
        self.json.setPlainText(json.dumps(self.step["condition"], indent=1)); self.changed.emit()

    def _mode_changed(self, _):
        if self._loading or not self.step: return
        mode = self.mode.currentData()
        cur = self.step.get("condition") or M.comparison()
        if mode == "cmp":
            self.step["condition"] = cur if cur.get("op") in M.OPERATORS else M.comparison()
        elif mode == "NOT":
            self.step["condition"] = {"op": "NOT", "condition": cur if cur.get("op") != "NOT" else cur["condition"]}
        else:
            base = cur["conditions"] if cur.get("op") in ("AND", "OR") else [cur if cur.get("op") in M.OPERATORS else M.comparison(), M.comparison()]
            self.step["condition"] = {"op": mode, "conditions": base}
        self.load(self.step); self.changed.emit()

    def _apply_json(self):
        try:
            c = json.loads(self.json.toPlainText())
            if not isinstance(c, dict): raise ValueError("condition must be a JSON object")
        except ValueError as e:
            QMessageBox.warning(self, "Condition JSON", str(e)); return
        self.step["condition"] = c; self.load(self.step); self.changed.emit()


class BlockEditor(QWidget):
    changed = Signal()

    def __init__(self, page, parent=None):
        super().__init__(parent)
        self.page = page
        self.v = QVBoxLayout(self); self.v.setContentsMargins(0, 0, 0, 0)
        self.title = QLabel("Select a block"); self.v.addWidget(self.title)
        self.form_host = QWidget(); self.form = QFormLayout(self.form_host); self.v.addWidget(self.form_host)
        self.cond = ConditionEditor(page); self.cond.changed.connect(self.changed); self.v.addWidget(self.cond)
        self.v.addStretch(1)
        self.step = None
        self.cond.hide()

    def _clear(self):
        while self.form.rowCount(): self.form.removeRow(0)

    def load(self, step):
        self.step = step; self._clear()
        if not step:
            self.title.setText("Select a block, or a TRUE / FALSE path to add blocks into it."); self.cond.hide(); return
        self.title.setText("<b>%s</b> · %s" % (M.BLOCK_LABELS.get(step["type"], step["type"]), step["id"][:8]))
        t = step["type"]
        if t in ("command", "registerRead", "registerWrite"): self._command_rows(step)
        if t == "delay": self._spin("Delay (ms)", step, "durationMs", 1, 600000)
        if t == "waitUntil": self._spin("Timeout (ms)", step, "timeoutMs", 1, 600000)
        if t in ("waitUntil", "if"):
            self.cond.show(); self.cond.load(step)
        else:
            self.cond.hide()

    def _spin(self, label, obj, key, lo, hi):
        sp = QSpinBox(); sp.setRange(lo, hi); sp.setValue(int(obj.get(key) or lo))
        sp.valueChanged.connect(lambda val: (obj.__setitem__(key, int(val)), self.changed.emit()))
        self.form.addRow(label, sp)

    def _combo(self, label, items, current, on_change):
        cb = QComboBox()
        for data, text in items: cb.addItem(text, data)
        i = cb.findData(current); cb.setCurrentIndex(max(0, i))
        cb.currentIndexChanged.connect(lambda _: on_change(cb.currentData()))
        self.form.addRow(label, cb); return cb

    def _command_rows(self, step):
        cmd = step["command"]
        if step["type"] == "command":
            def set_type(kind):
                step["command"] = M.default_command(kind); self.load(step); self.changed.emit()
            self._combo("Command", M.COMMAND_TYPES, cmd.get("type"), set_type)
        kind = cmd.get("type")
        def setf(key, val, reload=False):
            cmd[key] = val; self.changed.emit()
            if reload: self.load(step)
        if kind in ("led_control", "debug_control", "sensor_control"):
            self._combo("State", ((True, "On"), (False, "Off")), cmd.get("enabled"), lambda val: setf("enabled", val))
        if kind == "sensor_control":
            self._combo("Sensor", (("pv", M.DEVICE_LABELS["0x40"]), ("bms", M.DEVICE_LABELS["0x08"]), ("mppt", M.DEVICE_LABELS["0x6B"])),
                        cmd.get("sensor"), lambda val: setf("sensor", val))
        if kind == "mppt_acdrv_control":
            self._combo("Path", (("acdrv1", "ACDRV1"), ("acdrv2", "ACDRV2"), ("disabled", "Disable both")), cmd.get("state"), lambda val: setf("state", val))
        if kind == "set_scan_period": self._spin("Period (ms)", cmd, "period_ms", 200, 5000)
        if kind == "i2c_probe":
            e = QLineEdit(cmd.get("addr", "")); e.editingFinished.connect(lambda: setf("addr", e.text().strip())); self.form.addRow("Address (hex)", e)
        if kind in ("i2c_read", "i2c_write"):
            writing = kind == "i2c_write"
            def set_addr(addr):
                cmd["addr"] = addr
                regs = sorted(M.WRITABLE.get(addr, {})) if writing else [r["reg"] for r in M.READABLE_REGISTERS if r["addr"] == addr]
                cmd["reg"] = regs[0] if regs else "0x00"; self._fix_width(cmd, writing); self.changed.emit(); self.load(step)
            self._combo("Device", [(a, l) for a, l in M.DEVICE_LABELS.items()], cmd.get("addr"), set_addr)
            regs = [(r, r) for r in sorted(M.WRITABLE.get(cmd.get("addr"), {}))] if writing else \
                [(r["reg"], "%s (%d B)" % (r["reg"], r["len"])) for r in M.READABLE_REGISTERS if r["addr"] == cmd.get("addr")]
            def set_reg(reg):
                cmd["reg"] = reg; self._fix_width(cmd, writing); self.changed.emit(); self.load(step)
            self._combo("Register", regs, cmd.get("reg"), set_reg)
            if writing:
                e = QLineEdit(" ".join(cmd.get("data") or [])); e.setPlaceholderText("0x00 0x00")
                e.editingFinished.connect(lambda: setf("data", e.text().split()))
                self.form.addRow("Bytes (hex)", e)
            else:
                self.form.addRow("Width", QLabel("%s byte(s)" % cmd.get("len")))

    @staticmethod
    def _fix_width(cmd, writing):
        if writing:
            cmd.pop("len", None); cmd["data"] = ["0x00"] * (M.WRITABLE.get(cmd["addr"], {}).get(cmd["reg"]) or 1)
        else:
            cmd["len"] = next((r["len"] for r in M.READABLE_REGISTERS if r["addr"] == cmd["addr"] and r["reg"] == cmd["reg"]), 2)


class BranchDefinitionPage(QWidget):
    POLL_MS = 5000

    def __init__(self, store=None, token_provider=None, parent=None):
        super().__init__(parent)
        self.store, self.session, self.token_provider = store, None, token_provider
        self.draft, self.saved_snapshot, self.saved = M.fresh(), None, []
        self.execution, self.events, self.last_event = None, [], 0
        self.pending_exec = None
        self._relay = _Relay(); self._relay.done.connect(lambda cb, r, e: cb(r, e))
        self._busy = set()
        root = QVBoxLayout(self); root.setContentsMargins(6, 6, 6, 6)

        bar = QHBoxLayout()
        self.indicator = QLabel("BRANCH DEFINITION · NOT CONNECTED")
        self.saved_combo = QComboBox(); self.saved_combo.setMinimumWidth(260)
        self.load_btn, self.new_btn, self.dup_btn = QPushButton("Load"), QPushButton("New"), QPushButton("Duplicate")
        self.refresh_btn = QPushButton("Refresh")
        self.name = QLineEdit(); self.name.setMaxLength(120); self.name.setPlaceholderText("Bench startup check")
        self.save_btn = QPushButton("Save")
        for w in (self.indicator, QLabel("Saved"), self.saved_combo, self.load_btn, self.refresh_btn, self.new_btn, self.dup_btn,
                  QLabel("Name"), self.name, self.save_btn): bar.addWidget(w)
        root.addLayout(bar)
        self.remote = QLabel(""); self.remote.setStyleSheet("color:%s" % WARN); self.remote.setWordWrap(True); self.remote.hide()
        root.addWidget(self.remote)
        self.state = QLabel("Connect to Debug (Wireless) with an operator login to edit Branch Definitions."); root.addWidget(self.state)

        split = QSplitter(Qt.Horizontal)
        left = QWidget(); lv = QVBoxLayout(left); lv.setContentsMargins(0, 0, 0, 0)
        self.tree = QTreeWidget(); self.tree.setHeaderLabels(["Block", "Type"]); self.tree.setColumnWidth(0, 360)
        lv.addWidget(self.tree, 1)
        ab = QHBoxLayout()
        self.block_type = QComboBox()
        for k, label in M.BLOCKS: self.block_type.addItem(label, k)
        self.add_btn, self.up_btn, self.down_btn, self.del_btn = QPushButton("Add"), QPushButton("Up"), QPushButton("Down"), QPushButton("Delete")
        for w in (self.block_type, self.add_btn, self.up_btn, self.down_btn, self.del_btn): ab.addWidget(w)
        lv.addLayout(ab)
        self.validation = QListWidget(); self.validation.setMaximumHeight(110); lv.addWidget(self.validation)
        split.addWidget(left)

        right = QWidget(); rv = QVBoxLayout(right); rv.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea(); scroll.setWidgetResizable(True)
        self.editor = BlockEditor(self); scroll.setWidget(self.editor); rv.addWidget(scroll, 1)
        ex = QGroupBox("Execution"); ev = QVBoxLayout(ex)
        self.sim = QPlainTextEdit(); self.sim.setFixedHeight(60)
        self.sim.setPlaceholderText('Simulation values JSON, e.g. {"pv":{"available":true,"busVoltageV":5.2},"registers":{"0x40:0x00":16679}}')
        ev.addWidget(self.sim)
        eb = QHBoxLayout()
        self.token = QLineEdit(); self.token.setEchoMode(QLineEdit.Password); self.token.setPlaceholderText("command token (live)")
        self.sim_btn, self.live_btn = QPushButton("Simulate"), QPushButton("Review live execution")
        self.pause_btn, self.resume_btn, self.stop_btn = QPushButton("Pause"), QPushButton("Resume"), QPushButton("Stop")
        for w in (self.token, self.sim_btn, self.live_btn, self.pause_btn, self.resume_btn, self.stop_btn): eb.addWidget(w)
        ev.addLayout(eb)
        rb = QHBoxLayout(); self.reviewed = QCheckBox("I reviewed the device state"); self.recover_btn = QPushButton("Acknowledge review")
        rb.addWidget(self.reviewed); rb.addWidget(self.recover_btn); rb.addStretch(1); ev.addLayout(rb)
        self.progress = QLabel("No execution selected"); ev.addWidget(self.progress)
        self.event_list = QListWidget(); self.event_list.setMaximumHeight(150); ev.addWidget(self.event_list)
        rv.addWidget(ex)
        split.addWidget(right); split.setSizes([480, 620])
        root.addWidget(split, 1)

        self.tree.itemSelectionChanged.connect(self._selected)
        self.editor.changed.connect(self._edited)
        self.name.textEdited.connect(self._name_edited)
        self.add_btn.clicked.connect(self.add_block); self.del_btn.clicked.connect(self.delete_block)
        self.up_btn.clicked.connect(lambda: self.move_block(-1)); self.down_btn.clicked.connect(lambda: self.move_block(1))
        self.new_btn.clicked.connect(self.new_definition); self.dup_btn.clicked.connect(self.duplicate)
        self.load_btn.clicked.connect(self.load_selected); self.refresh_btn.clicked.connect(self.refresh_list)
        self.save_btn.clicked.connect(self.save)
        self.sim_btn.clicked.connect(lambda: self.start("simulation")); self.live_btn.clicked.connect(lambda: self.start("live"))
        for name, btn in (("pause", self.pause_btn), ("resume", self.resume_btn), ("stop", self.stop_btn)):
            btn.clicked.connect(lambda _=False, a=name: self.control(a))
        self.recover_btn.clicked.connect(lambda: self.control("recover"))
        self.reviewed.toggled.connect(lambda _: self._sync())

        self.list_timer = QTimer(self); self.list_timer.setInterval(self.POLL_MS); self.list_timer.timeout.connect(self.refresh_list)
        self.exec_timer = QTimer(self); self.exec_timer.setInterval(750); self.exec_timer.timeout.connect(self.poll_execution)
        self.hb_timer = QTimer(self); self.hb_timer.setInterval(15000); self.hb_timer.timeout.connect(self._heartbeat)
        self.render()

    # ---------------------------------------------------------------- plumbing
    def _run_async(self, key, fn, cb):
        if key in self._busy: return
        self._busy.add(key)
        def work():
            try: r, e = fn(), None
            except Exception as ex: r, e = None, ex
            self._busy.discard(key)
            self._relay.done.emit(cb, r, e)
        threading.Thread(target=work, daemon=True).start()

    def notice(self, text, error=False):
        self.state.setText(text); self.state.setStyleSheet("color:%s" % (BAD if error else "")); 

    def use_session(self, session):
        self.session = session
        self.execution, self.events, self.last_event = None, [], 0
        self.event_list.clear()
        if session:
            self.list_timer.start(); self.hb_timer.start(); self.refresh_list(); self._recent_execution()
            if getattr(session, "edit_only", False):
                self.notice("Signed in for editing only: another operator (e.g. the web dashboard) has control. You can edit and save; running needs control.")
        else:
            self.list_timer.stop(); self.hb_timer.stop(); self.exec_timer.stop()
        self.render()

    def can_edit(self):
        s = self.session
        return bool(s) and (not getattr(s, "auth_enabled", False) or (getattr(s, "user", None) or {}).get("role") == "operator")

    def can_operate(self):
        s = self.session
        return self.can_edit() and (not getattr(s, "auth_enabled", False) or bool(getattr(s, "control_active", False)))

    def _heartbeat(self):
        if not self.can_edit() or not getattr(self.session, "auth_enabled", False): return
        self._run_async("hb", self.session.heartbeat, lambda r, e: self._sync())

    def remember_register(self, entry):
        if not self.store: return
        lib = [r for r in self.store.settings.get(LIBRARY_KEY, []) if r.get("id") != entry["id"]]
        lib.insert(0, dict(entry)); self.store.settings[LIBRARY_KEY] = lib[:M.USER_REGISTER_LIMIT]
        try: self.store.save_settings()
        except Exception: pass

    def library(self):
        return list(self.store.settings.get(LIBRARY_KEY, [])) if self.store else []

    # ---------------------------------------------------------------- tree
    def render(self):
        sel = self._selected_ref()
        self.tree.blockSignals(True); self.tree.clear()
        custom = self.draft.get("registers") or []
        def add(parent, steps, path):
            for s in steps:
                it = QTreeWidgetItem([M.block_text(s, custom), M.BLOCK_LABELS.get(s["type"], s["type"])])
                it.setData(0, Qt.UserRole, ("block", s["id"], path))
                (parent.addChild(it) if parent else self.tree.addTopLevelItem(it))
                if s["type"] == "if":
                    for br, label in (("then", "TRUE path"), ("else", "FALSE path")):
                        b = QTreeWidgetItem(["%s (%d)" % (label, len(s.get(br, []))), ""])
                        b.setData(0, Qt.UserRole, ("path", s["id"], path + ((s["id"], br),)))
                        b.setForeground(0, Qt.darkGreen if br == "then" else Qt.darkRed)
                        it.addChild(b); add(b, s.get(br, []), path + ((s["id"], br),))
        add(None, self.draft["steps"], ())
        self.tree.expandAll(); self.tree.blockSignals(False)
        if sel: self._select_ref(sel)
        self._validate(); self._sync()

    def _selected_ref(self):
        items = self.tree.selectedItems()
        if not items: return None
        kind, ident, path = items[0].data(0, Qt.UserRole)
        return (kind, ident, path)

    def _select_ref(self, ref):
        def go(item):
            for i in range(item.childCount()):
                c = item.child(i)
                if c.data(0, Qt.UserRole) == ref:
                    self.tree.setCurrentItem(c); return True
                if go(c): return True
            return False
        go(self.tree.invisibleRootItem())

    def _selected(self):
        ref = self._selected_ref()
        self.editor.load(M.find_step(self.draft["steps"], ref[1]) if ref and ref[0] == "block" else None)
        self._sync()

    def _target_list(self):
        """Where Add inserts: into a selected TRUE/FALSE path, after a selected block, else at the end."""
        ref = self._selected_ref()
        if not ref: return self.draft["steps"], len(self.draft["steps"])
        if ref[0] == "path":
            lst = M.find_list(self.draft["steps"], ref[2]); return lst, len(lst)
        hit = M.locate(self.draft["steps"], ref[1])
        return (hit[0], hit[1] + 1) if hit else (self.draft["steps"], len(self.draft["steps"]))

    def add_block(self):
        if M.count_blocks(self.draft["steps"]) >= M.MAX_BLOCKS:
            self.notice("Branch Definition is limited to 200 blocks.", True); return
        block = M.make_block(self.block_type.currentData())
        lst, index = self._target_list(); lst.insert(index, block)
        self.render(); self._select_ref(("block", block["id"], self._path_of(block["id"])))

    def _path_of(self, block_id):
        hit = M.locate(self.draft["steps"], block_id)
        return hit[2] if hit else ()

    def delete_block(self):
        ref = self._selected_ref()
        if not ref or ref[0] != "block": return
        hit = M.locate(self.draft["steps"], ref[1])
        if hit: del hit[0][hit[1]]
        self.render()

    def move_block(self, delta):
        ref = self._selected_ref()
        if not ref or ref[0] != "block": return
        lst, i, _ = M.locate(self.draft["steps"], ref[1])
        j = i + delta
        if 0 <= j < len(lst):
            lst[i], lst[j] = lst[j], lst[i]; self.render()

    def _edited(self):
        # Update labels and validation without rebuilding the editor that is being typed in.
        custom = self.draft.get("registers") or []
        def go(item):
            for i in range(item.childCount()):
                c = item.child(i); kind, ident, _ = c.data(0, Qt.UserRole)
                if kind == "block":
                    s = M.find_step(self.draft["steps"], ident)
                    if s: c.setText(0, M.block_text(s, custom))
                go(c)
        go(self.tree.invisibleRootItem()); self._validate(); self._sync()

    def _name_edited(self, text):
        self.draft["name"] = text; self._validate(); self._sync()

    def _validate(self):
        self.errors = M.validate_draft(self.draft)
        self.validation.clear()
        if self.errors:
            for e in self.errors: self.validation.addItem(e)
        else:
            self.validation.addItem("Branch Definition is ready to save.")

    def dirty(self):
        return not self.draft.get("id") or json.dumps(self.draft, sort_keys=True) != self.saved_snapshot

    def _sync(self):
        edit, op = self.can_edit(), self.can_operate()
        running = bool(self.execution and self.execution.get("state") in ("running", "paused"))
        errors = getattr(self, "errors", [])
        self.save_btn.setEnabled(edit and not errors)
        self.dup_btn.setEnabled(bool(self.draft.get("id")) and edit)
        for b in (self.load_btn, self.refresh_btn): b.setEnabled(bool(self.session))
        can_run = op and not errors and not self.dirty() and not running
        self.sim_btn.setEnabled(can_run); self.live_btn.setEnabled(can_run)
        state = (self.execution or {}).get("state")
        self.pause_btn.setEnabled(op and state == "running"); self.resume_btn.setEnabled(op and state == "paused")
        self.stop_btn.setEnabled(op and running)
        ex = self.execution or {}
        needs = ex.get("mode") == "live" and ex.get("reason") in ("command_outcome_unknown", "bridge_restart") and not ex.get("recovery_ms")
        self.reviewed.setVisible(needs); self.recover_btn.setVisible(needs)
        self.recover_btn.setEnabled(needs and op and self.reviewed.isChecked())
        if not self.session: text, col = "BRANCH DEFINITION · NOT CONNECTED", DIM
        elif op: text, col = "BRANCH DEFINITION · CONTROL", OK
        elif edit: text, col = "BRANCH DEFINITION · EDITING ONLY", WARN
        else: text, col = "BRANCH DEFINITION · VIEWER", DIM
        self.indicator.setText(text)
        self.indicator.setStyleSheet("color:%s;border:1px solid %s;border-radius:10px;padding:3px 10px;font-weight:bold" % (col, col))

    # ---------------------------------------------------------------- library / concurrency
    def set_draft(self, definition, saved=True):
        self.draft = copy.deepcopy(definition)
        self.draft.setdefault("steps", [])
        self.saved_snapshot = json.dumps(self.draft, sort_keys=True) if saved and self.draft.get("id") else None
        self.name.setText(self.draft.get("name", ""))
        self.editor.load(None); self.render(); self._update_remote()

    def new_definition(self):
        self.set_draft(M.fresh(), saved=False); self._fill_saved(); self.notice("New Branch Definition.")

    def duplicate(self):
        self.set_draft(M.clone_sequence(self.draft), saved=False); self._fill_saved(); self.notice("Copy created. Save to keep it.")

    def _fill_saved(self):
        cur = self.saved_combo.currentData()
        self.saved_combo.blockSignals(True); self.saved_combo.clear()
        self.saved_combo.addItem("New Branch Definition", "")
        for item in self.saved: self.saved_combo.addItem("%s · r%s" % (item.get("name"), item.get("revision")), item.get("id"))
        i = self.saved_combo.findData(self.draft.get("id") or cur or "")
        self.saved_combo.setCurrentIndex(max(0, i)); self.saved_combo.blockSignals(False)

    def refresh_list(self):
        if not self.session: return
        self._run_async("list", self.session.list_sequences, self._list_loaded)

    def _list_loaded(self, data, err):
        if err:
            self.notice("Branch Definition service unavailable: %s" % err, True); return
        if data != self.saved:
            self.saved = data; self._fill_saved()
        self._update_remote()

    def _update_remote(self):
        info = M.remote_change(self.draft, self.saved)
        if info:
            self.remote.setText('"%s" was saved elsewhere as revision %s (you have r%s). %s' % (
                info["name"], info["revision"], self.draft.get("revision"),
                "Click Load to get it." if not self.dirty() else "Saving will ask how to resolve the conflict."))
        self.remote.setVisible(bool(info))

    def load_selected(self):
        sid = self.saved_combo.currentData()
        if not sid or not self.session: return
        self._run_async("load", lambda: self.session.get_sequence(sid), self._loaded)

    def _loaded(self, seq, err):
        if err: self.notice("Load failed: %s" % err, True); return
        self.set_draft(seq); self.notice("Loaded revision %s." % seq.get("revision"))

    def save(self):
        if not self.can_edit():
            self.notice("An operator account is required to save.", True); return
        self.draft["name"] = self.name.text()
        if M.validate_draft(self.draft):
            self.notice("Fix validation issues before saving.", True); return
        body = copy.deepcopy(self.draft)
        self._run_async("save", lambda: self.session.save_sequence(body), self._saved)

    def _saved(self, seq, err):
        if isinstance(err, SequenceConflict):
            self._conflict(err); return
        if err: self.notice("Save failed: %s" % err, True); return
        self.set_draft(seq); self.notice("Saved revision %s." % seq.get("revision")); self.refresh_list()

    def _conflict(self, err):
        cur = err.current or {}
        box = QMessageBox(self); box.setIcon(QMessageBox.Warning); box.setWindowTitle("Saved elsewhere")
        box.setText("This Branch Definition was saved elsewhere (now revision %s; yours is based on r%s)." % (
            cur.get("revision", "?"), self.draft.get("revision")))
        overwrite = box.addButton("Overwrite with mine", QMessageBox.DestructiveRole)
        reload_btn = box.addButton("Discard mine and load latest", QMessageBox.AcceptRole)
        box.addButton(QMessageBox.Cancel)
        box.exec()
        if box.clickedButton() is overwrite and cur.get("revision"):
            self.draft["revision"] = cur["revision"]; self.save()
        elif box.clickedButton() is reload_btn:
            self._run_async("load", lambda: self.session.get_sequence(self.draft["id"]), self._loaded)
        else:
            self.notice("Save canceled: resolve the conflict before saving.", True)

    # ---------------------------------------------------------------- execution (bridge engine)
    def _token(self):
        t = self.token.text().strip()
        if not t and self.token_provider: t = (self.token_provider() or "").strip()
        return t

    def _execution_id(self, mode):
        key = (mode, self.draft.get("id"), self.draft.get("revision"))
        if not self.pending_exec or self.pending_exec[0] != key:
            self.pending_exec = (key, str(uuid.uuid4()))
        return self.pending_exec[1]

    def start(self, mode):
        if not self.draft.get("id") or self.dirty():
            self.notice("Save the current Branch Definition before execution.", True); return
        sid = self.draft["id"]
        if mode == "simulation":
            text = self.sim.toPlainText().strip()
            try:
                telemetry = json.loads(text) if text else None
                if telemetry is not None and not isinstance(telemetry, dict): raise ValueError("Simulation values must be a JSON object")
            except ValueError as e:
                self.notice("Simulation failed: %s" % e, True); return
            eid = self._execution_id("simulation")
            self._run_async("exec", lambda: self.session.execute_sequence(sid, "simulation", eid, telemetry=telemetry), self._started)
            return
        if not self._token():
            self.notice("Enter the command token to review live execution.", True); return
        self.session.token = self._token()
        self._run_async("preflight", lambda: self.session.preflight_sequence(sid), self._preflighted)

    def _preflighted(self, data, err):
        if err: self.notice("Preflight failed: %s" % err, True); return
        target = data.get("target") or {}
        ok = QMessageBox.question(self, "Confirm live execution",
            "Confirm %s revision %s on device %s at %s:%s?\nThe confirmation expires in 30 seconds." % (
                data.get("name"), data.get("revision"), data.get("device_id"), target.get("address"), target.get("port")))
        if ok != QMessageBox.Yes: self.notice("Live execution canceled."); return
        sid, eid, tok = self.draft["id"], self._execution_id("live"), data.get("confirmation_token")
        self._run_async("exec", lambda: self.session.execute_sequence(sid, "live", eid, confirmation_token=tok), self._started)

    def _started(self, execution, err):
        if err: self.notice("Execution failed: %s" % err, True); return
        self.pending_exec = None
        self.execution, self.events, self.last_event = execution, [], 0
        self.event_list.clear(); self.notice("%s started." % execution.get("mode", "").capitalize())
        self.exec_timer.start(); self.poll_execution()

    def _recent_execution(self):
        def find():
            return next((e for e in self.session.list_executions() if e.get("state") in ("running", "paused")), None)
        def done(ex, err):
            if ex and not err:
                self.execution = ex; self.exec_timer.start(); self.poll_execution()
        self._run_async("recent", find, done)

    def poll_execution(self):
        if not self.session or not self.execution: return
        eid, after = self.execution["id"], self.last_event
        def work():
            ex = self.session.get_execution(eid); events, cursor = [], after
            while True:
                batch = self.session.execution_events(eid, cursor)
                events += batch
                if batch: cursor = max(e.get("event_order", 0) for e in batch)
                if len(batch) < 100: break
            return ex, events
        self._run_async("poll", work, self._polled)

    def _polled(self, result, err):
        if err: self.notice("Execution status unavailable: %s" % err, True); return
        ex, events = result
        self.execution = ex
        for e in events:
            if e.get("event_order", 0) <= self.last_event: continue
            self.last_event = e["event_order"]; self.events.append(e)
            d = e.get("details") or {}
            extra = (" · " + ("TRUE" if d["selected"] == "then" else "FALSE")) if d.get("selected") else ""
            extra += (" · value 0x%X" % d["value"]) if isinstance(d.get("value"), int) and e.get("type") == "register_value" else ""
            extra += (" · " + str(d["error"])) if d.get("error") else ""
            self.event_list.addItem("%s%s" % (e.get("type", "").replace("_", " "), extra))
        self.event_list.scrollToBottom()
        done = sum(1 for e in self.events if e.get("type") == "block_completed")
        self.progress.setText("%s · %s · %d blocks completed%s" % (ex.get("mode"), ex.get("state"), done,
                              (" · " + ex["reason"]) if ex.get("reason") else ""))
        if ex.get("state") in ("completed", "failed", "canceled"): self.exec_timer.stop()
        self._sync()

    def control(self, action):
        if not self.execution: return
        if action in ("resume", "recover"):
            if not self._token(): self.notice("Enter the command token.", True); return
            self.session.token = self._token()
        eid = self.execution["id"]
        def done(r, err):
            if err: self.notice("%s failed: %s" % (action, err), True); return
            if action == "recover": self.reviewed.setChecked(False); self.notice("Device review acknowledged; live lock cleared.")
            self.exec_timer.start(); self.poll_execution()
        self._run_async("ctl", lambda: self.session.control_execution(eid, action), done)
