"""Parity: Python link_stats must match the JS site module / link_monitor on shared fixtures."""
import json, math, os, pytest
from cubesat_i2c.link_stats import analyze_window, SeqTracker, seq_delta

FIX = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "link_fixtures.json")))


def same(a, b, path="$"):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), "%s keys %s vs %s" % (path, sorted(a), sorted(b))
        for k in a:
            same(a[k], b[k], "%s.%s" % (path, k))
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, "%s[%d]" % (path, i))
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        assert math.isclose(a, b, rel_tol=0, abs_tol=1e-9), "%s %r != %r" % (path, a, b)
    else:
        assert a == b, "%s %r != %r" % (path, a, b)


CASES = [(c["name"], w) for c in FIX["cases"] for w in c["expected"]]


@pytest.mark.parametrize("name,window", CASES)
def test_parity(name, window):
    c = next(x for x in FIX["cases"] if x["name"] == name)
    r = analyze_window(c["events"], c["commands"], period_ms=c["period"], window_ms=int(window), now=c["events"][-1]["t"])
    same(r["summary"], c["expected"][window]["summary"])
    same(r["series"], c["expected"][window]["series"])


def test_basic_semantics():
    assert seq_delta(65535, 1) == 1
    t = SeqTracker()
    for i, s in enumerate([1, 2, 4, 3, 3, 9]):
        t.add(s, i * 1000)
    s = t.summary()
    assert (s["lost"], s["out_of_order"], s["duplicates"]) == (4, 1, 1)
