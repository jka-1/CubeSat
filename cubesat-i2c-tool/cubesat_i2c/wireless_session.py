""""Debug (Wireless)" source: drives the debug firmware through the telemetry bridge HTTP command API.

WirelessSession has the same interface as session.Session. send() accepts the i2c-tools console syntax used by
the Registers / Sequences pages and returns i2c-tools-like text, so protocol.parse_get/parse_set and
run_sequence work unchanged. Commands go to POST <base>/command?wait=1 with the X-Command-Token header.

Supported lines: i2cget -c A -r R [-l N] | i2cset -c A -r R B... | i2cdetect | i2cconfig (ignored: the bus is
fixed in firmware) | debug on|off | scan_period N (alias: period N) | probe A.
"""
import http.cookiejar, json, re, ssl, threading, urllib.error, urllib.parse, urllib.request
from . import protocol as P
from .session import Session

GROUPS = (("pv", "PV / INA226", "0x40"), ("bms", "BMS / BQ76942", "0x08"), ("mppt", "MPPT / BQ25798", "0x6B"))


def _opts(tokens):
    o = {"rest": []}
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in ("-c", "-r", "-l", "-s") and i + 1 < len(tokens):
            o[t[1:]] = tokens[i + 1]; i += 2; continue
        if not t.startswith("--"):
            o["rest"].append(t)
        i += 1
    return o


def format_detect(addresses):
    """i2cdetect-style grid (parsed back by protocol.parse_detect)."""
    found = {P.to_int(a) for a in addresses}
    lines = ["     " + " ".join("%2x" % i for i in range(16))]
    for base in range(0, 0x80, 16):
        cells = []
        for i in range(16):
            a = base + i
            cells.append("  " if a < 0x08 or a > 0x77 else ("%02x" % a if a in found else "--"))
        lines.append("%02x: %s" % (base, " ".join(cells)))
    return "\n".join(lines)


class WirelessSession(Session):
    def __init__(self, base_url, token="", log=None, timeout=6.0, verify_tls=True, opener=None):
        super().__init__(None, log, timeout)
        self.base = base_url.rstrip("/")
        self.token = token or ""
        self.ctx = None if verify_tls else ssl._create_unverified_context()
        self.cookies = http.cookiejar.CookieJar()
        if opener:
            self._open = opener
        else:
            handlers = [urllib.request.HTTPCookieProcessor(self.cookies)]
            if self.ctx is not None:
                handlers.append(urllib.request.HTTPSHandler(context=self.ctx))
            built = urllib.request.build_opener(*handlers)
            self._open = lambda req, t: built.open(req, timeout=t)
        self._connected = True
        self.last_result = None
        self.csrf = ""
        self.user = None
        self.auth_enabled = False
        self.active_run_id = None
        self._auth_lock = threading.RLock()
        self._username = ""
        self._password = ""
        parsed = urllib.parse.urlsplit(self.base)
        self.origin = "%s://%s" % (parsed.scheme, parsed.netloc)

    @staticmethod
    def open(base_url, token="", log=None, timeout=6.0, verify_tls=True, opener=None, username="", password=""):
        s = WirelessSession(base_url, token, log, timeout, verify_tls, opener)
        s.auth_enabled = s.auth_status()
        if s.auth_enabled:
            if not username or not password:
                raise IOError("This bridge requires a CubeSat username and password")
            s.login(username, password)
        try:
            h = s.health()  # raises if the bridge is unreachable
        except Exception:
            s.close()
            raise
        s._log("SYS", "wireless bridge %s: telemetry %s, command_ready %s, format %s" % (
            s.base, "fresh" if h.get("telemetry_connected") else "stale", h.get("command_ready"),
            h.get("telemetry_packet_format")))
        return s

    @property
    def connected(self):
        return self._connected

    def close(self):
        if self.auth_enabled and self.user:
            try: self.logout()
            except Exception: pass
        self._clear_auth()
        self._connected = False

    def open_url(self, request, timeout):
        """Open an authenticated bridge request for the SSE/health reader threads."""
        csrf = self.csrf
        try: return self._open(request, timeout)
        except urllib.error.HTTPError as e:
            if e.code != 401 or not self._renew_session(csrf): raise
            return self._open(request, timeout)

    # --------------------------------------------------------------- HTTP
    def _headers(self, write=False, command_token=False):
        headers = {"Accept": "application/json"}
        if write:
            headers.update({"Content-Type": "application/json", "Origin": self.origin})
            if self.csrf:
                headers["X-CSRF-Token"] = self.csrf
        if command_token and self.token:
            headers["X-Command-Token"] = self.token
        return headers

    @staticmethod
    def _error(e):
        try: return json.loads(e.read().decode() or "{}").get("error", "")
        except Exception: return ""

    def _json(self, path, body=None, command_token=False, timeout=6.0, allow_reauth=True):
        write = body is not None
        csrf = self.csrf
        req = urllib.request.Request(self.base + path,
            data=json.dumps(body).encode() if write else None,
            headers=self._headers(write, command_token), method="POST" if write else "GET")
        try:
            with self._open(req, timeout) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            if e.code == 401 and allow_reauth and self._renew_session(csrf):
                return self._json(path, body, command_token, timeout, False)
            raise IOError("HTTP %d %s" % (e.code, self._error(e))) from e

    def auth_status(self):
        try: return bool(self._json("/auth/status").get("enabled"))
        except IOError as e:
            if "HTTP 404" in str(e): return False
            raise

    def login(self, username, password, renewal=False):
        data = self._json("/auth/login", {"username": username, "password": password}, allow_reauth=False)
        self.csrf, self.user = data.get("csrf", ""), data.get("user")
        if not self.csrf or not self.user:
            raise IOError("Bridge login did not establish a session")
        self._username, self._password = username, password
        self._log("SYS", "%s as %s (%s)" % ("session renewed" if renewal else "signed in",
                                                self.user.get("username"), self.user.get("role")))
        return self.user

    def logout(self):
        try: self._json("/auth/logout", {}, timeout=5, allow_reauth=False)
        finally: self._clear_auth()

    def _clear_auth(self):
        self.csrf, self.user, self._username, self._password = "", None, "", ""
        try: self.cookies.clear()
        except Exception: pass

    def _renew_session(self, previous_csrf):
        if not self.auth_enabled or not self._username or not self._password:
            return False
        with self._auth_lock:
            if previous_csrf and self.csrf and self.csrf != previous_csrf:
                return True  # another reader already renewed this in-memory session
            self.login(self._username, self._password, renewal=True)
            return True

    def health(self, _allow_reauth=True):
        csrf = self.csrf
        req = urllib.request.Request(self.base + "/health", headers=self._headers())
        try:
            with self._open(req, 5) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:  # 503 = degraded (no token configured) still has a JSON body
            if e.code == 401 and _allow_reauth and self._renew_session(csrf):
                return self.health(False)
            body = json.loads(e.read().decode() or "{}")
            if e.code == 401: raise IOError("HTTP 401 %s" % body.get("error", "sign in required")) from e
            return body

    def recording_status(self):
        data = self._json("/runs", command_token=True)
        self.active_run_id = (data.get("recording") or {}).get("active_run_id")
        return data

    def start_recording(self, name):
        data = self._json("/runs/start", {"name": name}, command_token=True)
        self.active_run_id = (data.get("run") or {}).get("id")
        self._log("SEQ", "recording started: %s" % name)
        return data.get("run") or {}

    def stop_recording(self):
        data = self._json("/runs/stop", {}, command_token=True)
        self.active_run_id = None
        self._log("SEQ", "recording stopped")
        return data.get("run") or {}

    # ------------------------------------------------- recorded runs (read side)
    def list_runs(self, limit=50, offset=0):
        """GET /runs: {runs:[...newest first], recording:{enabled, ready, active_run_id, ...}}."""
        data = self._json("/runs?limit=%d&offset=%d" % (int(limit), int(offset)), command_token=True)
        self.active_run_id = (data.get("recording") or {}).get("active_run_id")
        return data

    @staticmethod
    def _q(params):
        return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})

    def get_run(self, run_id):
        return self._json("/runs/" + urllib.parse.quote(run_id, safe=""), command_token=True).get("run") or {}

    def run_events(self, run_id, after=0, limit=200):
        return self._json("/runs/%s/events?%s" % (urllib.parse.quote(run_id, safe=""),
                          self._q({"after": after, "limit": limit})), command_token=True)

    def run_samples(self, run_id, start=None, end=None, after=0, limit=500):
        return self._json("/runs/%s/samples?%s" % (urllib.parse.quote(run_id, safe=""),
                          self._q({"start": start, "end": end, "after": after, "limit": limit})), command_token=True, timeout=15)

    def run_series(self, run_id, metric, start=None, end=None, points=400):
        return self._json("/runs/%s/series?%s" % (urllib.parse.quote(run_id, safe=""),
                          self._q({"metric": metric, "start": start, "end": end, "points": points})), command_token=True, timeout=15)

    def sequence_marker(self, sequence_name, step_index, step_text, phase, ok=None, result=None):
        if not self.active_run_id:
            return None
        marker = self._json("/runs/events", {"sequence_name": sequence_name, "step_index": step_index,
            "step_text": step_text, "phase": phase, "ok": ok, "result": result}, command_token=True).get("marker")
        if marker:
            self.active_run_id = marker.get("run_id") or self.active_run_id
        return marker

    def command(self, body, timeout=None, _allow_reauth=True):
        """POST a bridge command synchronously; returns the bridge JSON (status completed/failed/timed_out/rejected)."""
        data = json.dumps(body).encode()
        headers = self._headers(True, True)
        csrf = self.csrf
        req = urllib.request.Request(self.base + "/command?wait=1", data=data, headers=headers, method="POST")
        self._log("TX", "bridge " + json.dumps(body))
        try:
            with self._open(req, timeout or self.timeout) as r:
                out = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 401 and _allow_reauth and self._renew_session(csrf):
                return self.command(body, timeout, False)
            try: detail = json.loads(e.read().decode()).get("error", "")
            except Exception: detail = ""
            out = {"status": "rejected", "http_status": e.code, "error": "HTTP %d %s" % (e.code, detail)}
        except Exception as e:
            out = {"status": "error", "error": "bridge unreachable: %s" % e}
        self.last_result = out
        self._log("RX", "bridge %s %s" % (out.get("status"), json.dumps(out.get("result") or out.get("error"))))
        return out

    def set_live_mode(self, on, source="exe", _allow_reauth=True):
        """Tell the bridge the app's live telemetry mode is on/off (POST /live-mode). Web pages read the flag
        from /health and the status stream and never show simulated data while it is on. Returns True on success."""
        headers = self._headers(True, True)
        csrf = self.csrf
        req = urllib.request.Request(self.base + "/live-mode", data=json.dumps({"on": bool(on), "source": source}).encode(),
                                     headers=headers, method="POST")
        try:
            with self._open(req, 5) as r:
                ok = bool(json.loads(r.read().decode()).get("live_mode")) == bool(on)
        except urllib.error.HTTPError as e:
            if e.code == 401 and _allow_reauth and self._renew_session(csrf):
                return self.set_live_mode(on, source, False)
            self._log("SYS", "bridge live-mode %s not set: %s" % ("on" if on else "off", e))
            return False
        except Exception as e:
            self._log("SYS", "bridge live-mode %s not set: %s" % ("on" if on else "off", e))
            return False
        self._log("SYS", "bridge live-mode %s" % ("on" if on else "off"))
        return ok

    # --------------------------------------------------------------- console emulation
    def send(self, cmd, timeout=None):
        if not self.connected:
            raise IOError("not connected")
        text = self._translate(cmd.strip())
        return text + "\n" + P.PROMPT

    @staticmethod
    def _fail(out, what):
        res = out.get("result") or {}
        reason = res.get("error") or out.get("error") or out.get("status")
        return "%s failed: %s" % (what, reason)

    def _translate(self, line):
        if not line:
            return ""
        tok = line.split()
        op = tok[0].lower()
        args = tok[1:]
        if op == "i2cconfig":
            return "Note: I²C pins/speed are fixed in the debug firmware (GPIO4/5, 400 kHz); i2cconfig ignored."
        if op == "i2cget":
            o = _opts(args)
            if "c" not in o or "r" not in o:
                return "error: i2cget needs -c and -r over the wireless bridge"
            out = self.command({"type": "i2c_read", "addr": P.hx(o["c"]), "reg": P.hx(o["r"]),
                                "len": int(o.get("l", 1))})
            if out.get("status") != "completed":
                return self._fail(out, "Read")
            return " ".join(out["result"].get("data") or [])
        if op == "i2cset":
            o = _opts(args)
            if "c" not in o or "r" not in o or not o["rest"]:
                return "error: i2cset needs -c, -r and data over the wireless bridge"
            out = self.command({"type": "i2c_write", "addr": P.hx(o["c"]), "reg": P.hx(o["r"]),
                                "data": [P.hx(b) for b in o["rest"]]})
            return "Write OK" if out.get("status") == "completed" else self._fail(out, "Write")
        if op in ("i2cdetect", "scan"):
            out = self.command({"type": "i2c_scan"})
            if out.get("status") != "completed":
                return self._fail(out, "Scan")
            return format_detect(out["result"].get("addresses") or [])
        if op == "i2cdump":
            return "error: i2cdump is not supported over the wireless bridge (use i2cget per register)"
        if op == "debug":
            v = (args[0].lower() if args else "")
            if v not in ("on", "off", "1", "0", "enable", "disable"):
                return "error: debug needs on|off"
            out = self.command({"type": "debug_control", "enabled": v in ("on", "1", "enable")})
            if out.get("status") != "completed":
                return self._fail(out, "Debug control")
            return "Debug mode %s" % ("ON" if out["result"].get("enabled") else "OFF")
        if op in ("scan_period", "period", "set_scan_period"):
            try:
                ms = int(args[0])
            except (IndexError, ValueError):
                return "error: scan_period needs milliseconds"
            out = self.command({"type": "set_scan_period", "period_ms": ms})
            if out.get("status") != "completed":
                return self._fail(out, "Set scan period")
            return "Scan period %s ms" % out["result"].get("period_ms")
        if op == "probe":
            if not args:
                return "error: probe needs an address"
            out = self.command({"type": "i2c_probe", "addr": P.hx(args[0])})
            if out.get("status") != "completed":
                return self._fail(out, "Probe")
            r = out["result"]
            return "%s %s (%s)" % (r.get("addr"), "present" if r.get("present") else "no ACK", r.get("probe_result"))
        return "error: unrecognized command over the wireless bridge: %s" % tok[0]

    # --------------------------------------------------------------- presence
    def presence(self):
        """Return (debug_mode dict or None, list of (key, label, addr, state, detail))."""
        h = self.health()
        dm = h.get("debug_mode") or None
        tiles = []
        for key, label, addr in GROUPS:
            dev = ((dm or {}).get("devices") or {}).get(key)
            if not dm or not dm.get("enabled") or not dev:
                tiles.append((key, label, addr, "unknown", "enable debug for presence"))
            else:
                tiles.append((key, label, dev.get("addr", addr), dev.get("state", "unknown"),
                              "status %s · errors %s" % (dev.get("last_status"), dev.get("error_count"))))
        return h, tiles
