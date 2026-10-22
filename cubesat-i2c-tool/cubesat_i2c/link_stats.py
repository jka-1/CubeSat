"""Link-health statistics. Line-for-line port of CubeSat-ref-tools/lib/stats.mjs and
site/assets/js/link-stats.mjs (analyzeWindow). Shared JSON fixtures keep them identical."""
import math
from decimal import Decimal, ROUND_HALF_UP

SEQ_MOD = 65535  # firmware seq values 1..65535 (0 skipped), restart at 1 on reboot


def _jsum(vals):
    """Plain left-to-right float sum like Array.reduce (Python 3.12 sum() is compensated)."""
    t = 0
    for v in vals:
        t = t + v
    return t


def seq_delta(a, b):
    return ((b - 1) - (a - 1) + SEQ_MOD) % SEQ_MOD


def percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, max(0, math.ceil((p / 100) * len(sorted_vals)) - 1))
    return sorted_vals[idx]


def _r(v, n=2):
    """JS +v.toFixed(n)."""
    if v is None:
        return None
    # toFixed: exact binary value, ties away from zero
    out = float(Decimal(v).quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP))
    return int(out) if out == int(out) else out


class SeqTracker:
    def __init__(self, expected_period_ms=1000, reset_threshold=1000, outage_factor=3, reorder_window=64):
        self.expected_period_ms = expected_period_ms
        self.reset_threshold = reset_threshold
        self.outage_factor = outage_factor
        self.reorder_window = reorder_window
        self.highest = None
        self.seen = {}  # ordered set
        self.last_arrival = None
        self.first_arrival = None
        self.received = self.unique = self.lost = self.dup = self.reorder = 0
        self.recovered_late = self.resets = self.bytes = self.expected = 0
        self.jitter = 0.0
        self.inter_arrivals = []
        self.outages = []
        self.gap_events = []
        self.missing = set()
        self.link = []

    def add(self, seq, arrival_ms, nbytes=0, link=None):
        row = {"seq": seq, "arrival_ms": arrival_ms, "bytes": nbytes, "delta_seq": "", "gap": 0, "duplicate": 0,
               "out_of_order": 0, "reset": 0, "inter_arrival_ms": "", "jitter_ms": ""}
        self.received += 1
        self.bytes += nbytes
        if self.first_arrival is None:
            self.first_arrival = arrival_ms
        if self.last_arrival is not None:
            ia = arrival_ms - self.last_arrival
            row["inter_arrival_ms"] = ia
            self.inter_arrivals.append(ia)
            d_ = abs(ia - self.expected_period_ms)
            self.jitter += (d_ - self.jitter) / 16
            row["jitter_ms"] = _r(self.jitter, 3)
            if ia > self.outage_factor * self.expected_period_ms:
                self.outages.append({"start_ms": self.last_arrival, "duration_ms": ia})
        self.last_arrival = arrival_ms
        if link:
            self.link.append(link)
        if seq is None:
            return row
        if self.highest is None:
            self.highest = seq
            self.seen[seq] = True
            self.unique += 1
            self.expected = 1
            return row
        d = seq_delta(self.highest, seq)
        row["delta_seq"] = d
        if d == 0:
            self.dup += 1
            row["duplicate"] = 1
            return row
        back = seq_delta(seq, self.highest)
        if back < d:
            if back <= self.reorder_window:
                if seq in self.missing:
                    self.missing.discard(seq)
                    self.lost -= 1; self.recovered_late += 1; self.reorder += 1
                    row["out_of_order"] = 1; self.seen[seq] = True; self.unique += 1
                elif seq in self.seen:
                    self.dup += 1; row["duplicate"] = 1
                else:
                    self.reorder += 1; row["out_of_order"] = 1; self.seen[seq] = True; self.unique += 1
                return row
            self._reset(seq, row)
            return row
        if d >= self.reset_threshold:
            self._reset(seq, row)
            return row
        if d > 1:
            row["gap"] = d - 1
            self.lost += d - 1
            self.gap_events.append({"after_seq": self.highest, "missing": d - 1, "at_ms": arrival_ms})
            for k in range(1, d):
                self.missing.add(((self.highest - 1 + k) % SEQ_MOD) + 1)
        self.expected += d
        self.highest = seq
        self.seen[seq] = True
        self.unique += 1
        if len(self.seen) > 5000:
            self.seen = dict.fromkeys(list(self.seen)[-2000:], True)
        return row

    def _reset(self, seq, row):
        self.resets += 1; row["reset"] = 1; self.highest = seq
        self.seen = {seq: True}; self.missing.clear(); self.unique += 1; self.expected += 1

    def summary(self):
        ia = sorted(self.inter_arrivals)
        mean = _jsum(ia) / len(ia) if ia else None
        sd = math.sqrt(_jsum([(v - mean) ** 2 for v in ia]) / len(ia)) if ia else None
        dur = (self.last_arrival - self.first_arrival) / 1000 if self.last_arrival is not None else 0
        rssi = [l.get("rssi_dbm") for l in self.link if isinstance(l.get("rssi_dbm"), (int, float))]
        return {
            "packets_received": self.received, "unique_seq": self.unique, "expected_seq": self.expected,
            "lost": self.lost, "loss_pct": _r(100 * self.lost / self.expected, 3) if self.expected else None,
            "duplicates": self.dup, "out_of_order": self.reorder, "late_recovered": self.recovered_late,
            "seq_resets": self.resets, "gap_events": len(self.gap_events),
            "max_gap": max([g["missing"] for g in self.gap_events], default=0),
            "duration_s": _r(dur, 3), "rate_pps": _r((self.received - 1) / dur, 3) if dur > 0 else None,
            "throughput_Bps": _r(self.bytes / dur, 1) if dur > 0 else None, "bytes": self.bytes,
            "inter_arrival_ms": {"mean": _r(mean), "stdev": _r(sd), "min": ia[0] if ia else None,
                                 "p50": percentile(ia, 50), "p95": percentile(ia, 95), "p99": percentile(ia, 99),
                                 "max": ia[-1] if ia else None},
            "rfc3550_jitter_ms": _r(self.jitter, 3),
            "outages": len(self.outages), "longest_outage_ms": max([o["duration_ms"] for o in self.outages], default=0),
            "rssi_dbm": {"min": min(rssi), "max": max(rssi), "mean": _r(_jsum(rssi) / len(rssi), 1)} if rssi else None,
            "last_link_counters": self.link[-1] if self.link else None,
        }


def rtt_stats(values):
    v = sorted(x for x in values if isinstance(x, (int, float)) and math.isfinite(x))
    return {"count": len(v), "min": v[0] if v else None, "p50": percentile(v, 50), "p95": percentile(v, 95),
            "p99": percentile(v, 99), "max": v[-1] if v else None,
            "mean": _r(_jsum(v) / len(v), 2) if v else None}


def analyze_window(events, commands, period_ms=1000, window_ms=300000, now=None, buckets=60):
    """events: [{'t','seq','bytes','rssi'}]; commands: [{'t','status','rtt'}]. Mirrors analyzeWindow()."""
    end = now if now is not None else (events[-1]["t"] if events else 0)
    start = end - window_ms
    tr = SeqTracker(expected_period_ms=period_ms)
    rows = []
    for e in events:
        if e["t"] < start or e["t"] > end:
            continue
        rssi = e.get("rssi")
        has = isinstance(rssi, (int, float))
        r = tr.add(e.get("seq"), e["t"], e.get("bytes") or 0, {"rssi_dbm": rssi} if has else None)
        r["rssi"] = rssi if has else None
        rows.append(r)
    bw = window_ms / buckets
    series = [{"t": start + (i + 1) * bw, "received": 0, "lost": 0, "duplicate": 0, "out_of_order": 0, "reset": 0,
               "loss_pct": None, "rtt": None, "rssi": None} for i in range(buckets)]

    def idx(t):
        return min(buckets - 1, max(0, math.floor((t - start) / bw)))
    rssi_acc, rtt_acc = {}, {}
    for r in rows:
        b = series[idx(r["arrival_ms"])]
        b["received"] += 1; b["lost"] += r["gap"]; b["duplicate"] += r["duplicate"]
        b["out_of_order"] += r["out_of_order"]; b["reset"] += r["reset"]
        if r["rssi"] is not None:
            rssi_acc.setdefault(idx(r["arrival_ms"]), []).append(r["rssi"])
    for k, a in rssi_acc.items():
        series[k]["rssi"] = _r(_jsum(a) / len(a), 2)
    cmds = [c for c in commands if start <= c["t"] <= end]
    for c in cmds:
        if isinstance(c.get("rtt"), (int, float)):
            rtt_acc.setdefault(idx(c["t"]), []).append(c["rtt"])
    for k, a in rtt_acc.items():
        series[k]["rtt"] = max(a)
    for b in series:
        exp = b["received"] - b["duplicate"] + b["lost"]
        b["loss_pct"] = _r(100 * b["lost"] / exp, 3) if exp > 0 else None
    summary = tr.summary()
    ok = [c for c in cmds if c["status"] == "completed"]
    summary["commands"] = {"finished": len(cmds), "completed": len(ok),
                           "failed": sum(1 for c in cmds if c["status"] == "failed"),
                           "timed_out": sum(1 for c in cmds if c["status"] == "timed_out"),
                           "rtt_ms": rtt_stats([c["rtt"] for c in ok])}
    return {"summary": summary, "rows": rows, "series": series, "start": start, "end": end}
