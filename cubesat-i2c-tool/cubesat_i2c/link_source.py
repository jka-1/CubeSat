"""Link-health data sources for the Link Health page: bridge SSE (+ optional /health poll) or a mock.
LinkModel.on_event mirrors site/assets/js/link-health.js onEvent()."""
import json, random, threading, time, datetime, urllib.request, ssl

DEFAULT_SSE_URL = "http://45.55.77.215/telemetry/events"   # DEMO_SERVER_HOST in main/app_config.h
DEFAULT_HEALTH_URL = "http://45.55.77.215/telemetry/health"
MAX_AGE_MS = 3_600_000
REPLAY_AGE_MS = 2_000


def parse_iso_ms(text):
    if not text:
        return None
    try:
        return int(datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


class LinkModel:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()
        self.status = None
        self.sse_open = False
        self.clock_skew = 0  # local - server ms
        self.error = ""

    def reset(self):
        self.events, self.commands = [], []
        self.last_endpoint, self.port_changes, self.last_rssi, self.last_received_at = None, 0, None, None
        self.last_key = None
        self.expect_replay = False

    def server_now(self):
        return int(time.time() * 1000) - self.clock_skew

    def on_event(self, ev):
        with self.lock:
            t = ev.get("type")
            if t == "status":
                self.status = {**(self.status or {}), **ev}
                st = parse_iso_ms(ev.get("server_time"))
                if st:
                    self.clock_skew = int(time.time() * 1000) - st
                return
            if t == "command_status" and ev.get("status") in ("completed", "failed", "timed_out"):
                rtt = ev.get("round_trip_ms")
                ct = parse_iso_ms(ev.get("updated_at")) or self.server_now()
                if self.server_now() - ct > REPLAY_AGE_MS:
                    return  # latest command envelope replayed on connect
                self.commands.append({"t": ct, "status": ev["status"],
                                      "rtt": rtt if isinstance(rtt, (int, float)) else None})
                return
            if t != "telemetry" or ev.get("source") != "udp":
                return
            ts = parse_iso_ms(ev.get("received_at"))
            pkt, net = ev.get("packet") or {}, ev.get("network") or {}
            key = (ev.get("received_at"), pkt.get("seq"), net.get("remote_port"))
            replay_check, self.expect_replay = self.expect_replay, False
            if ts is None or (replay_check and key == self.last_key):
                return  # bridge replays its latest envelope on every SSE (re)connect
            self.last_key = key
            if self.server_now() - ts > REPLAY_AGE_MS:
                return  # stale envelope replayed on connect (bridge sends status first, so skew is known)
            self.last_received_at = ts
            link = pkt.get("link") or {}
            rssi = link.get("rssi_dbm") if isinstance(link.get("rssi_dbm"), (int, float)) else None
            self.last_rssi = rssi
            e = {"t": ts, "seq": pkt.get("seq") if isinstance(pkt.get("seq"), int) else None, "bytes": net.get("bytes") or 0}
            if rssi is not None:
                e["rssi"] = rssi
            self.events.append(e)
            ep = (net.get("remote_address"), net.get("remote_port"))
            if self.last_endpoint and ep != self.last_endpoint:
                self.port_changes += 1
            self.last_endpoint = ep
            cutoff = ts - MAX_AGE_MS
            while self.events and self.events[0]["t"] < cutoff:
                self.events.pop(0)
            while self.commands and self.commands[0]["t"] < cutoff:
                self.commands.pop(0)

    def snapshot(self):
        with self.lock:
            return list(self.events), list(self.commands), dict(self.status or {})


class SseLinkSource:
    def __init__(self, model, sse_url, health_url="", verify_tls=True):
        self.model, self.sse_url, self.health_url = model, sse_url, health_url
        self.ctx = None if verify_tls else ssl._create_unverified_context()
        self.stop_event = threading.Event()
        self.threads = []

    def start(self):
        for fn in (self._sse_loop, self._health_loop):
            th = threading.Thread(target=fn, daemon=True); th.start(); self.threads.append(th)

    def stop(self):
        self.stop_event.set()
        self.model.sse_open = False

    def _sse_loop(self):
        while not self.stop_event.is_set():
            try:
                req = urllib.request.Request(self.sse_url, headers={"Accept": "text/event-stream", "Cache-Control": "no-cache"})
                with urllib.request.urlopen(req, timeout=30, context=self.ctx) as resp:
                    self.model.sse_open, self.model.error = True, ""
                    self.model.expect_replay = True
                    data = []
                    for raw in resp:
                        if self.stop_event.is_set():
                            break
                        line = raw.decode("utf-8", "replace").rstrip("\r\n")
                        if line.startswith("data:"):
                            data.append(line[5:].strip())
                        elif line == "" and data:
                            try:
                                self.model.on_event(json.loads("".join(data)))
                            except ValueError:
                                pass
                            data = []
            except Exception as e:  # network errors -> retry
                self.model.error = str(e)
            self.model.sse_open = False
            self.stop_event.wait(3)

    def _health_loop(self):
        while self.health_url and not self.stop_event.is_set():
            try:
                with urllib.request.urlopen(self.health_url, timeout=5, context=self.ctx) as resp:
                    j = json.loads(resp.read().decode("utf-8"))
                j["type"] = "status"
                self.model.on_event(j)
            except Exception:
                pass
            self.stop_event.wait(5)


class MockLinkSource:
    """Synthetic bridge: v5-style telemetry with loss/dup/reorder/jitter/RSSI, a reboot + port change, and commands."""

    def __init__(self, model, period_ms=200, seed=1):
        self.model, self.period_ms = model, period_ms
        self.rng = random.Random(seed)
        self.stop_event = threading.Event()

    def start(self):
        self.model.sse_open = True
        threading.Thread(target=self._loop, daemon=True).start()

    def stop(self):
        self.stop_event.set(); self.model.sse_open = False

    def _iso(self, ms):
        return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    def _status(self, port):
        now = int(time.time() * 1000)
        self.model.on_event({"type": "status", "server_time": self._iso(now), "telemetry_connected": True, "telemetry_age_ms": 0,
                             "telemetry_stale_after_ms": 5000, "telemetry_endpoint": {"address": "192.0.2.10", "port": port},
                             "pending_commands": 0, "command_auth_required": True, "command_auth_configured": True,
                             "command_ready": True, "web_clients": 1})

    def _loop(self):
        seq, port, i, held = 1000, 50123, 0, None
        self._status(port)
        while not self.stop_event.is_set():
            i += 1
            cur = seq
            seq = 1 if seq >= 65535 else seq + 1
            if i % 900 == 0:  # simulated reboot -> new source port, seq restarts
                seq, port = 1, port + 1
                self._status(port)
            now = int(time.time() * 1000)
            rssi = -55 + int(8 * self.rng.random()) - (12 if (i // 150) % 2 else 0)
            mk = lambda s: {"type": "telemetry", "source": "udp", "received_at": self._iso(int(time.time() * 1000)),
                            "network": {"remote_address": "192.0.2.10", "remote_port": port, "bytes": 104},
                            "packet": {"seq": s, "packet_format": "hex-v5-link-stats", "link": {"rssi_dbm": rssi}}}
            r = self.rng.random()
            if r < 0.02:
                pass  # lost
            elif r < 0.025:
                held = cur
            else:
                self.model.on_event(mk(cur))
                if held is not None:
                    time.sleep(0.002); self.model.on_event(mk(held)); held = None
                if r > 0.997:
                    time.sleep(0.002); self.model.on_event(mk(cur))
            if i % 10 == 0:
                c = self.rng.random()
                st = "timed_out" if c < 0.05 else "completed"
                self.model.on_event({"type": "command_status", "status": st, "updated_at": self._iso(now),
                                     "round_trip_ms": None if st == "timed_out" else 15 + int(self.rng.random() * 60)})
            jitter = self.rng.uniform(-0.15, 0.15) * self.period_ms
            self.stop_event.wait(max(0.0, (self.period_ms + jitter) / 1000))
