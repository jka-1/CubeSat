"""Pure helpers for the Recordings tab (bridge /runs API, see telemetry-bridge/RECORDING.md).

Mirrors site/assets/js/runs-model.mjs so the app and the browser Run Explorer agree on metric ids,
gap handling and CSV safety. No Qt imports: everything here is unit-testable.
"""
import csv, datetime, io, json

# Same allowlist as telemetry-bridge/recording/store.mjs METRICS.
RUN_METRICS = (
    ("pv.busVoltageV", "PV bus voltage (INA226)", "V", 3),
    ("pv.currentA", "PV current (INA226)", "A", 3),
    ("pv.powerW", "PV power (INA226)", "W", 3),
    ("bms.cell1V", "BMS cell 1", "V", 3),
    ("bms.cell2V", "BMS cell 2", "V", 3),
    ("bms.cell3V", "BMS cell 3", "V", 3),
    ("bms.cellSlot4V", "BMS cell slot 4", "V", 3),   # v6 = physical cell 4, older formats = cell 10
    ("bms.packVoltageV", "BMS pack voltage", "V", 3),
    ("mppt.vbusV", "MPPT VBUS", "V", 3),
    ("mppt.vbatV", "MPPT VBAT", "V", 3),
    ("mppt.ibusA", "MPPT IBUS", "A", 3),
    ("peripheral.temperatureC", "MCP9700 temperature", "°C", 1),
    ("peripheral.lightVoltageMv", "TEMT6000 light voltage", "mV", 0),
)
METRIC_IDS = tuple(m[0] for m in RUN_METRICS)
WINDOW_PRESETS = (("full", "Full run"), ("30s", "Last 30 s"), ("1m", "Last 1 min"), ("5m", "Last 5 min"), ("15m", "Last 15 min"))
PRESET_MS = {"30s": 30_000, "1m": 60_000, "5m": 300_000, "15m": 900_000}
MAX_SERIES_WINDOW_MS = 24 * 60 * 60 * 1000
MAX_CSV_ROWS = 100_000
CSV_HEADER = ("received_at", "relative_ms", "seq", "mode", "power_source", "packet_order",
              "metric_id", "metric_value", "raw_base64", "envelope_json")

SOURCE_LABELS = {"pv": "PV", "bat_secondary": "BAT/secondary"}
TYPE_LABELS = {"debug": "Debug", "live_telemetry": "Live telemetry"}
END_REASONS = {"operator_stop": "Stopped by operator", "source_switch": "Power source switched",
               "debug_exit": "Left debug mode", "device_reboot": "Device restarted",
               "bridge_restart": "Interrupted (bridge restart)", "bridge_shutdown": "Interrupted (bridge shutdown)",
               "storage_error": "Interrupted (storage error)", "queue_overflow": "Recording queue overflow"}


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def source_label(src):
    return "unknown" if not src else SOURCE_LABELS.get(src, str(src))


def run_end(run, now_ms):
    """Same as runs-model.mjs runEnd: end of the run, or now (+1 ms) for an open run."""
    ended = run.get("ended_ms")
    last = run.get("last_received_ms") if run.get("last_received_ms") is not None else run.get("started_ms", 0)
    return max(ended if ended is not None else now_ms + 1, last + 1)


def window_for_preset(run, preset, now_ms):
    end = run_end(run, now_ms)
    start0 = run.get("started_ms", 0)
    length = min(MAX_SERIES_WINDOW_MS, end - start0) if preset == "full" else PRESET_MS.get(preset, PRESET_MS["1m"])
    return {"start": max(start0, end - max(1, length)), "end": end}


def format_duration(ms):
    if not _finite(ms) or ms < 0:
        return "—"
    s = int(ms // 1000); h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return "%dh %dm %ds" % (h, m, sec) if h else ("%dm %ds" % (m, sec) if m else "%ds" % sec)


def fmt_time(ms):
    if not _finite(ms):
        return "—"
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


def run_row(run, now_ms):
    """Table row for the run list: (name, type, status, started, duration, packets, end/source)."""
    status = run.get("status") or "—"
    end = run.get("ended_ms")
    dur = (end if end is not None else now_ms) - run.get("started_ms", now_ms)
    reason = END_REASONS.get(run.get("end_reason"), run.get("end_reason") or "")
    mode = TYPE_LABELS.get(run.get("run_type"), run.get("run_type") or "—")
    if run.get("contains_debug") and run.get("run_type") != "debug":
        mode += " + debug"
    return (run.get("name") or "(unnamed)", mode, status, fmt_time(run.get("started_ms")), format_duration(dur),
            str(run.get("sample_count", 0)), reason if status != "recording" else "Source " + source_label(run.get("current_source")))


def event_row(ev):
    """(time, type, detail) for one /runs/:id/events item."""
    d = ev.get("details") or {}
    t = ev.get("type", "")
    if t == "sequence_step":
        detail = "%s L%s %s · %s%s" % (d.get("sequence_name", ""), d.get("step_number", "?"), d.get("step_text", ""),
                                       d.get("phase", ""), "" if d.get("ok") is None else (" OK" if d["ok"] else " FAILED"))
    elif t == "source_switch":
        detail = d.get("label") or "%s → %s" % (source_label(d.get("from_source")), source_label(d.get("to_source")))
    elif t in ("run_started", "run_ended"):
        detail = END_REASONS.get(d.get("reason"), d.get("reason") or "")
        if t == "run_started" and "source" in d:
            detail = ("%s · " % detail if detail else "") + "source " + source_label(d.get("source"))
    elif t == "command_status":
        detail = "%s %s" % (d.get("command") or d.get("type") or "command", d.get("status", ""))
    else:
        detail = d.get("label") or d.get("reason") or ", ".join("%s=%s" % (k, v) for k, v in list(d.items())[:3]
                                                               if not isinstance(v, (dict, list)))
    return (fmt_time(ev.get("at_ms")), t.replace("_", " "), detail)


def metric_value(sample, metric_id):
    tel = (((sample or {}).get("envelope") or {}).get("packet") or {}).get("telemetry") or {}
    group, key = metric_id.split(".", 1)
    g = tel.get(group) or {}
    if key.startswith("cell") and key.endswith("V") and group == "bms":
        idx = {"cell1V": 0, "cell2V": 1, "cell3V": 2, "cellSlot4V": 3}.get(key)
        arr = g.get("cellVoltagesV") or []
        v = arr[idx] if idx is not None and idx < len(arr) else None
    else:
        v = g.get(key)
    return v if _finite(v) else None


def series_segments(points, gap_factor=3):
    """Split bucket means into connected segments; empty/invalid buckets become gaps (never interpolated)."""
    valid = [p for p in points if _finite(p.get("mean"))]
    if len(valid) < 2:
        return [valid] if valid else []
    mid = lambda p: (p["start_ms"] + p["end_ms"]) / 2
    gaps = sorted(g for g in (mid(b) - mid(a) for a, b in zip(valid, valid[1:])) if g > 0)
    cadence = gaps[len(gaps) // 2] if gaps else 1
    segs = [[valid[0]]]
    for p in valid[1:]:
        if mid(p) - mid(segs[-1][-1]) > cadence * gap_factor:
            segs.append([p])
        else:
            segs[-1].append(p)
    return segs


def series_summary(points):
    """min/max/mean over valid buckets plus sample counts; None values when the window has no data."""
    valid = [p for p in points if _finite(p.get("mean")) and (p.get("valid_count") or 0) > 0]
    samples = sum(p.get("sample_count") or 0 for p in points)
    if not valid:
        return {"min": None, "max": None, "mean": None, "samples": samples, "valid": 0}
    n = sum(p["valid_count"] for p in valid)
    return {"min": min(p["min"] for p in valid), "max": max(p["max"] for p in valid),
            "mean": sum(p["mean"] * p["valid_count"] for p in valid) / n, "samples": samples, "valid": n}


def csv_cell(v):
    """Spreadsheet-safe text (same rule as runs-model.mjs csvCell): neutralise formula prefixes."""
    if v is None:
        return ""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def export_csv(fetch_samples, metric_id, start, end, fh, trigger_ms=None, max_rows=MAX_CSV_ROWS, cancelled=None):
    """Write the bounded samples API to CSV. fetch_samples(start, end, after, limit) -> {items, next_after}.
    Returns the row count; raises ValueError above max_rows (choose a narrower window)."""
    w = csv.writer(fh, lineterminator="\r\n")
    w.writerow(CSV_HEADER)
    after, count = 0, 0
    while True:
        body = fetch_samples(start, end, after, 500)
        for s in body.get("items") or []:
            if count >= max_rows:
                raise ValueError("This export exceeds %d packets. Choose a narrower window." % max_rows)
            w.writerow([csv_cell(x) for x in (
                iso(s["received_ms"]), None if trigger_ms is None else s["received_ms"] - trigger_ms, s.get("seq"),
                s.get("mode"), s.get("power_source"), s.get("packet_order"), metric_id, metric_value(s, metric_id),
                s.get("raw_base64"), json.dumps(s.get("envelope"), separators=(",", ":")))])
            count += 1
        after = body.get("next_after")
        if not after or (cancelled and cancelled()):
            return count


def recording_note(status):
    """One-line recorder state, or a note only when recording is unavailable."""
    rec = (status or {}).get("recording") or {}
    if not rec.get("enabled"):
        return "Recording is not enabled on this bridge (RECORDING_DB_PATH not set)."
    if rec.get("error"):
        return "Recorder error: %s" % rec["error"]
    if not rec.get("ready"):
        return "Recorder starting…"
    return ""
