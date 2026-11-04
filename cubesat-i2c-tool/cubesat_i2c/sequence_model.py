"""Branch Definition model shared with the web editor (site/assets/js/sequence-editor-model.mjs).

Pure Python (no Qt) so it can be unit tested. Definitions use the bridge's version 1 sequence JSON schema
(telemetry-bridge/SEQUENCES.md); the bridge validates again on save and is the only executor.
"""
import copy, re, uuid

METRICS = (
    ("pv.busVoltageV", "PV bus voltage", "V"), ("pv.currentA", "PV current", "A"), ("pv.powerW", "PV power", "W"),
    ("bms.cell1V", "BMS cell 1", "V"), ("bms.cell2V", "BMS cell 2", "V"), ("bms.cell3V", "BMS cell 3", "V"),
    ("bms.cellSlot4V", "BMS cell slot 4", "V"), ("bms.packVoltageV", "BMS pack voltage", "V"),
    ("mppt.vbusV", "MPPT bus voltage", "V"), ("mppt.vbatV", "MPPT battery voltage", "V"), ("mppt.ibusA", "MPPT bus current", "A"),
    ("peripheral.temperatureC", "Peripheral temperature", "C"), ("peripheral.lightVoltageMv", "Light sensor voltage", "mV"),
)
METRIC_UNITS = {m[0]: m[2] for m in METRICS}
OPERATORS = (">", ">=", "<", "<=", "==", "!=", "&")
LOGICAL = ("AND", "OR", "NOT")
BLOCKS = (("command", "Command"), ("registerRead", "Register read"), ("registerWrite", "Register write"),
          ("delay", "Delay"), ("waitUntil", "Wait for value"), ("if", "IF / ELSE"))
BLOCK_LABELS = dict(BLOCKS)
COMMAND_TYPES = (("led_control", "LED"), ("debug_control", "Debug mode"), ("sensor_control", "Sensor polling"),
                 ("mppt_acdrv_control", "MPPT ACDRV"), ("i2c_read", "I²C read"), ("i2c_write", "I²C write"),
                 ("set_scan_period", "Scan period"), ("i2c_scan", "I²C scan"), ("i2c_probe", "I²C probe"))
DEVICE_LABELS = {"0x08": "BMS / BQ76942 (0x08)", "0x40": "PV / INA226 (0x40)", "0x6B": "MPPT / BQ25798 (0x6B)"}
CONDITION_FAULTS = ("VAC1_OVP_STAT", "VAC2_OVP_STAT", "CONV_OCP_STAT", "BAT_OCP_STAT",
                    "IBUS_OCP_STAT", "VBAT_OVP_STAT", "VBUS_OVP_STAT", "BAT_REG_STAT")
USER_REGISTER_LIMIT = 32
MAX_BLOCKS = 200
_len = len

_GROUPS = (("0x08", "bms", "BMS / BQ76942", "", "14 16 18 1A 36 3A 68 3E", "little"),
           ("0x6B", "mppt", "MPPT / BQ25798", "0F 10 12 13 14 1B 1C 1E 2E 30 48", "31 33 35 37 39 3B 3D 41", "big"),
           ("0x40", "pv", "PV / INA226", "", "00 01 02 03 04 05 06 07 FE FF", "big"))
READABLE_REGISTERS = tuple(
    {"id": "%s:0x%s" % (addr, r), "addr": addr, "group": group, "device": dev, "reg": "0x" + r, "len": n,
     "endian": endian, "label": "%s · 0x%s" % (dev, r)}
    for addr, group, dev, one, two, endian in _GROUPS for n, regs in ((1, one), (2, two)) for r in regs.split())
CONDITION_REGISTERS = (
    {"id": "pv.shunt", "label": "PV / INA226 · 0x01 shunt"}, {"id": "pv.bus", "label": "PV / INA226 · 0x02 bus"},
    {"id": "pv.power", "label": "PV / INA226 · 0x03 power"}, {"id": "pv.current", "label": "PV / INA226 · 0x04 current"},
    {"id": "pv.calibration", "label": "PV / INA226 · 0x05 calibration"},
    {"id": "mppt.reg13", "label": "MPPT / BQ25798 · 0x13 ACDRV"}, {"id": "mppt.fault20", "label": "MPPT / BQ25798 · 0x20 faults"},
) + READABLE_REGISTERS
WRITABLE = {"0x08": {"0x3E": 2}, "0x6B": {"0x%s" % r: 1 for r in "0F 10 12 13 14 2E 30".split()},
            "0x40": {"0x%s" % r: 2 for r in "00 05 06 07".split()}}


def uid():
    return str(uuid.uuid4())


def hex2(value):
    return "0x%02X" % int(value)


def fresh(name=""):
    return {"schemaVersion": 1, "name": name, "steps": []}


def comparison():
    return {"op": ">", "left": {"metric": METRICS[0][0]}, "right": {"constant": 0, "unit": METRICS[0][2]}}


def default_command(kind):
    return {"led_control": {"type": kind, "enabled": True}, "debug_control": {"type": kind, "enabled": True},
            "sensor_control": {"type": kind, "sensor": "pv", "enabled": True},
            "mppt_acdrv_control": {"type": kind, "state": "acdrv1"}, "set_scan_period": {"type": kind, "period_ms": 1000},
            "i2c_scan": {"type": kind}, "i2c_probe": {"type": kind, "addr": "0x40"},
            "i2c_read": {"type": kind, "addr": "0x40", "reg": "0x00", "len": 2},
            "i2c_write": {"type": kind, "addr": "0x40", "reg": "0x05", "data": ["0x00", "0x00"]}}[kind]


def make_block(kind):
    i = uid()
    if kind == "command": return {"id": i, "type": kind, "command": default_command("led_control")}
    if kind == "registerRead": return {"id": i, "type": kind, "command": default_command("i2c_read")}
    if kind == "registerWrite": return {"id": i, "type": kind, "command": default_command("i2c_write")}
    if kind == "delay": return {"id": i, "type": kind, "durationMs": 1000}
    if kind == "waitUntil": return {"id": i, "type": kind, "condition": comparison(), "timeoutMs": 30000}
    if kind == "if": return {"id": i, "type": kind, "condition": comparison(), "then": [], "else": []}
    raise ValueError("Unsupported block")


def count_blocks(steps):
    return sum(1 + (count_blocks(s.get("then", [])) + count_blocks(s.get("else", [])) if s.get("type") == "if" else 0) for s in steps)


def walk(steps, path=()):
    """Yield (step, path, index) depth first; path is a tuple of (if_id, 'then'|'else')."""
    for i, s in enumerate(steps):
        yield s, path, i
        if s.get("type") == "if":
            yield from walk(s.get("then", []), path + ((s["id"], "then"),))
            yield from walk(s.get("else", []), path + ((s["id"], "else"),))


def find_step(steps, block_id):
    for s, path, i in walk(steps):
        if s.get("id") == block_id:
            return s
    return None


def find_list(steps, path):
    lst = steps
    for block_id, branch in path:
        block = next((s for s in lst if s.get("id") == block_id), None)
        if not block or block.get("type") != "if" or branch not in ("then", "else"):
            return None
        lst = block.setdefault(branch, [])
    return lst


def locate(steps, block_id, path=()):
    """Return (list, index, path) holding block_id."""
    for i, s in enumerate(steps):
        if s.get("id") == block_id:
            return steps, i, path
        if s.get("type") == "if":
            for br in ("then", "else"):
                hit = locate(s.get(br, []), block_id, path + ((s["id"], br),))
                if hit: return hit
    return None


def earlier_reads(steps, block_id):
    """Register-read blocks visible to block_id's condition (earlier on the same path), like the web picker."""
    def go(lst, reads):
        for s in lst:
            if s.get("id") == block_id:
                return list(reads)
            if s.get("type") == "if":
                for br in ("then", "else"):
                    hit = go(s.get(br, []), list(reads))
                    if hit is not None: return hit
            if s.get("type") == "registerRead" or (s.get("command") or {}).get("type") == "i2c_read":
                reads.append(s)
        return None
    return go(steps, []) or []


def describe_read(step):
    c = step.get("command") or {}
    return "%s %s (%s B) · %s" % (DEVICE_LABELS.get(c.get("addr"), c.get("addr")), c.get("reg"), c.get("len"), step["id"][:8])


# ------------------------------------------------------------------ user-added condition registers
_HEX = re.compile(r"^(0x)?[0-9a-f]{1,2}$", re.I)


def parse_user_register(addr="", reg="", width=1, endian="big", label=""):
    errors = []
    a, r, name = str(addr or "").strip(), str(reg or "").strip(), str(label or "").strip()
    av = int(a[2:] if a.lower().startswith("0x") else a, 16) if _HEX.match(a) else -1
    rv = int(r[2:] if r.lower().startswith("0x") else r, 16) if _HEX.match(r) else -1
    if not 0x08 <= av <= 0x77: errors.append("Device address must be a 7-bit hex address 0x08–0x77.")
    if not 0 <= rv <= 0xFF: errors.append("Register must be hex 0x00–0xFF.")
    try: n = int(width)
    except (TypeError, ValueError): n = 0
    if n not in (1, 2): errors.append("Width must be 1 or 2 bytes.")
    if endian not in ("big", "little"): errors.append("Byte order must be big or little endian.")
    if _len(name) > 60:
        errors.append("Label must be 60 characters or fewer.")
    if errors:
        return None, errors
    entry = {"id": "user-%s-%s-%d" % (hex2(av)[2:], hex2(rv)[2:], n), "addr": hex2(av), "reg": hex2(rv), "len": n, "endian": endian}
    if name: entry["label"] = name
    return entry, []




def user_register_label(item):
    return "%s%s %s (%d B%s)" % (item["label"] + " · " if item.get("label") else "", item["addr"], item["reg"], item["len"],
                                 ", " + item["endian"] if item["len"] == 2 else "")


def add_user_register(definition, entry):
    """Add entry to definition['registers']; returns (id, error)."""
    regs = definition.setdefault("registers", [])
    for r in regs:
        if r["id"] == entry["id"]:
            return r["id"], None
    if _len(regs) >= USER_REGISTER_LIMIT:
        return None, "At most %d added registers per Branch Definition." % USER_REGISTER_LIMIT
    regs.append(dict(entry))
    return entry["id"], None


def validate_user_registers(lst, errors):
    if lst is None: return errors
    if not isinstance(lst, list) or _len(lst) > USER_REGISTER_LIMIT:
        errors.append("Added registers: at most %d." % USER_REGISTER_LIMIT); return errors
    ids = set()
    for i, item in enumerate(lst):
        item = item or {}
        entry, problems = parse_user_register(item.get("addr"), item.get("reg"), item.get("len", 1), item.get("endian", "big"), item.get("label", ""))
        for p in problems: errors.append("Added register %d: %s" % (i + 1, p))
        if entry and (item.get("id") != entry["id"] or item.get("id") in ids):
            errors.append("Added register %d: invalid or duplicate id" % (i + 1))
        ids.add(item.get("id"))
    return errors


# ------------------------------------------------------------------ validation (mirrors validateDraft)
def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def operand_type(o, custom):
    if not isinstance(o, dict): return None
    if _len(o) == 1 and "metric" in o: return METRIC_UNITS.get(o["metric"])
    if _len(o) == 1 and "step" in o: return "hex" if isinstance(o["step"], str) else None
    if _len(o) == 1 and "register" in o:
        return "hex" if any(r["id"] == o["register"] for r in CONDITION_REGISTERS) or any(r.get("id") == o["register"] for r in custom) else None
    if _len(o) == 1 and "fault" in o: return "boolean" if o["fault"] in CONDITION_FAULTS else None
    if _len(o) == 2 and "constant" in o:
        if o.get("unit") == "boolean": return "boolean" if isinstance(o["constant"], bool) else None
        if _is_num(o["constant"]) and o.get("unit") in set(METRIC_UNITS.values()) | {"hex"}:
            if o["unit"] == "hex" and not (isinstance(o["constant"], int) and 0 <= o["constant"] <= 0xFFFF): return None
            return o["unit"]
    return None


def validate_condition(c, path, errors, depth=0, custom=()):
    if depth > 8: errors.append("%s: logical nesting exceeds 8" % path); return
    if not isinstance(c, dict): errors.append("%s: condition is missing" % path); return
    op = c.get("op")
    if op in ("AND", "OR"):
        parts = c.get("conditions")
        if not isinstance(parts, list) or not 2 <= _len(parts) <= 8: errors.append("%s: %s needs 2–8 conditions" % (path, op))
        else:
            for i, p in enumerate(parts): validate_condition(p, "%s condition %d" % (path, i + 1), errors, depth + 1, custom)
    elif op == "NOT":
        validate_condition(c.get("condition"), path + " NOT", errors, depth + 1, custom)
    elif op in OPERATORS:
        t = [operand_type(c.get("left"), custom), operand_type(c.get("right"), custom)]
        if not t[0] or not t[1]: errors.append("%s: enter a valid telemetry, register, fault flag, or constant value" % path)
        elif t[0] != t[1]: errors.append("%s: comparison types or formats must match (%s versus %s)" % (path, t[0], t[1]))
        if t[0] == "boolean" and op not in ("==", "!="): errors.append("%s: fault flags support == and != only" % path)
        if op == "&" and t[0] and t[0] != "hex": errors.append("%s: bit-mask AND (&) needs register or hex values" % path)
        if "constant" in (c.get("left") or {}) and "constant" in (c.get("right") or {}):
            errors.append("%s: comparison needs telemetry, register, or fault flag" % path)
    else:
        errors.append("%s: choose a comparison or logical operator" % path)


def step_refs(c, out=None):
    out = [] if out is None else out
    if not isinstance(c, dict): return out
    if c.get("op") == "NOT": return step_refs(c.get("condition"), out)
    if c.get("op") in ("AND", "OR"):
        for p in c.get("conditions") or []: step_refs(p, out)
        return out
    for side in ("left", "right"):
        if isinstance(c.get(side), dict) and c[side].get("step"): out.append(c[side]["step"])
    return out


def validate_draft(d):
    errors = []
    name = d.get("name") or ""
    if not name.strip(): errors.append("Enter a Branch Definition name.")
    if _len(name) > 120: errors.append("Name must be 120 characters or fewer.")
    steps = d.get("steps") or []
    if not steps: errors.append("Connect at least one block to the Branch Definition.")
    if count_blocks(steps) > MAX_BLOCKS: errors.append("Branch Definition exceeds 200 blocks.")
    validate_user_registers(d.get("registers"), errors)
    custom = d.get("registers") if isinstance(d.get("registers"), list) else []
    seen = set()

    def go(lst, path, depth, reads):
        if depth > 8: errors.append("%s: branch nesting exceeds 8" % path)
        for index, s in enumerate(lst):
            label = "%s block %d" % (path, index + 1)
            if s.get("type") in ("waitUntil", "if"):
                for ref in step_refs(s.get("condition")):
                    if ref not in reads:
                        errors.append("%s: the selected block result must come from a Register read earlier on the same path" % label)
            if not s.get("id") or s["id"] in seen: errors.append("%s: missing or duplicate block ID" % label)
            seen.add(s.get("id"))
            t, cmd = s.get("type"), s.get("command") or {}
            if t == "delay" and not (isinstance(s.get("durationMs"), int) and 1 <= s["durationMs"] <= 600000):
                errors.append("%s: delay must be 1–600000 ms" % label)
            if t == "waitUntil":
                if not (isinstance(s.get("timeoutMs"), int) and 1 <= s["timeoutMs"] <= 600000): errors.append("%s: timeout must be 1–600000 ms" % label)
                validate_condition(s.get("condition"), label, errors, 0, custom)
            if t == "if":
                validate_condition(s.get("condition"), label, errors, 0, custom)
                if not s.get("then"): errors.append("%s: TRUE path is disconnected" % label)
                if not s.get("else"): errors.append("%s: FALSE path is disconnected" % label)
                go(s.get("then") or [], label + " TRUE", depth + 1, set(reads)); go(s.get("else") or [], label + " FALSE", depth + 1, set(reads))
            if t in ("command", "registerRead", "registerWrite") and not cmd.get("type"): errors.append("%s: choose a command" % label)
            if t == "registerRead" or cmd.get("type") == "i2c_read":
                reads.add(s.get("id"))
                if not any(r["addr"] == cmd.get("addr") and r["reg"] == cmd.get("reg") and r["len"] == cmd.get("len") for r in READABLE_REGISTERS):
                    errors.append("%s: select a supported register and width" % label)
            if t == "registerWrite" or cmd.get("type") == "i2c_write":
                width = WRITABLE.get(cmd.get("addr"), {}).get(cmd.get("reg"))
                if not width: errors.append("%s: select an approved writable register" % label)
                data = cmd.get("data")
                if not isinstance(data, list) or _len(data) != width or any(not re.match(r"^0x[0-9a-f]{1,2}$", str(b), re.I) for b in data):
                    errors.append("%s: enter %s hex byte(s)" % (label, width or "valid"))
                elif cmd.get("addr") == "0x6B" and cmd.get("reg") == "0x14" and int(data[0], 16) & 0x40:
                    errors.append("%s: reserved bit 6 must be zero" % label)
            if t == "command":
                if cmd.get("type") == "set_scan_period" and not (isinstance(cmd.get("period_ms"), int) and 200 <= cmd["period_ms"] <= 5000):
                    errors.append("%s: scan period must be 200–5000 ms" % label)
                if cmd.get("type") == "i2c_probe" and not (re.match(r"^0x[0-9a-f]{1,2}$", str(cmd.get("addr", "")), re.I) and 8 <= int(cmd["addr"], 16) <= 119):
                    errors.append("%s: probe address must be 0x08–0x77" % label)
    go(steps, "Branch Definition", 0, set())
    return errors


def clone_sequence(d):
    c = copy.deepcopy(d)
    c.pop("id", None); c.pop("revision", None)
    c["name"] = "%s copy" % c.get("name", "")
    for s, _, _ in list(walk(c["steps"])): s["id"] = uid()
    return c


def remote_change(definition, saved_list):
    """Newer saved revision of the loaded definition (edited in another client), else None."""
    if not definition or not definition.get("id"): return None
    for item in saved_list or []:
        if item.get("id") == definition["id"] and int(item.get("revision") or 0) > int(definition.get("revision") or 0):
            return {"id": item["id"], "name": item.get("name"), "revision": item["revision"]}
    return None


def condition_text(c, custom=()):
    if not isinstance(c, dict): return "?"
    if c.get("op") == "NOT": return "NOT (%s)" % condition_text(c.get("condition"), custom)
    if c.get("op") in ("AND", "OR"): return (" %s " % c["op"]).join("(%s)" % condition_text(p, custom) for p in c.get("conditions") or [])
    return "%s %s %s" % (operand_text(c.get("left"), custom), c.get("op"), operand_text(c.get("right"), custom))


def operand_text(o, custom=()):
    o = o or {}
    if "metric" in o: return o["metric"]
    if "step" in o: return "result of %s" % str(o["step"])[:8]
    if "register" in o:
        u = next((r for r in custom if r.get("id") == o["register"]), None)
        return user_register_label(u) if u else o["register"]
    if "fault" in o: return o["fault"]
    if "constant" in o:
        if o.get("unit") == "hex" and isinstance(o["constant"], int): return "0x%X" % o["constant"]
        return "%s %s" % (o["constant"], o.get("unit", ""))
    return "?"


def block_text(s, custom=()):
    t, cmd = s.get("type"), s.get("command") or {}
    if t == "delay": return "Delay %d ms" % s.get("durationMs", 0)
    if t == "waitUntil": return "Wait until %s (timeout %d ms)" % (condition_text(s.get("condition"), custom), s.get("timeoutMs", 0))
    if t == "if": return "IF %s" % condition_text(s.get("condition"), custom)
    if t == "registerRead": return "Read %s %s (%s B)" % (DEVICE_LABELS.get(cmd.get("addr"), cmd.get("addr")), cmd.get("reg"), cmd.get("len"))
    if t == "registerWrite": return "Write %s %s ← %s" % (DEVICE_LABELS.get(cmd.get("addr"), cmd.get("addr")), cmd.get("reg"), " ".join(cmd.get("data") or []))
    if t == "command":
        detail = {k: v for k, v in cmd.items() if k != "type"}
        return "Command %s %s" % (dict(COMMAND_TYPES).get(cmd.get("type"), cmd.get("type")), " ".join("%s=%s" % kv for kv in detail.items()))
    return t or "?"
