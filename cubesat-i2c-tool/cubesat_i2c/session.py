"""Serial session with the ESP32 i2c-tools console, plus a sequence runner."""
import re, time, threading
from . import protocol as P
from .conversions import convert


class Session:
    def __init__(self, serial_obj=None, log=None, timeout=2.0):
        self.ser = serial_obj
        self.log = log
        self.timeout = timeout
        self.lock = threading.Lock()

    @staticmethod
    def open(port, baud, log=None, timeout=2.0):
        import serial
        s = serial.Serial(port, int(baud), timeout=0.05)
        # Avoid resetting ESP32-S3 via DTR/RTS on open
        try:
            s.dtr = False; s.rts = False
        except Exception:
            pass
        sess = Session(s, log, timeout)
        sess.send("")  # wake prompt
        return sess

    @property
    def connected(self):
        return self.ser is not None and getattr(self.ser, "is_open", True)

    def close(self):
        if self.ser:
            try: self.ser.close()
            except Exception: pass
        self.ser = None

    def _log(self, kind, text):
        if self.log:
            self.log.write(kind, text)

    def send(self, cmd, timeout=None):
        """Send one line, return raw response text up to the next prompt."""
        if not self.connected:
            raise IOError("not connected")
        timeout = self.timeout if timeout is None else timeout
        with self.lock:
            try: self.ser.reset_input_buffer()
            except Exception: pass
            if cmd:
                self._log("TX", cmd)
            self.ser.write((cmd + "\r\n").encode())
            buf = b""
            end = time.time() + timeout
            while time.time() < end:
                chunk = self.ser.read(256)
                if chunk:
                    buf += chunk
                    text = buf.decode(errors="replace")
                    idx = text.find(cmd) if cmd else 0
                    tail = text[idx:] if idx >= 0 else text
                    if tail.rstrip().endswith(P.PROMPT):
                        if idx >= 0 or tail.replace(P.PROMPT, "").strip():
                            break
            text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", buf.decode(errors="replace"))
            if cmd:
                self._log("RX", text.strip() or "(no response / timeout)")
            return text

    # high-level helpers
    def configure(self, line):
        return P.parse_set(self.send(line), line)

    def detect(self):
        return P.parse_detect(self.send("i2cdetect", timeout=max(self.timeout, 3)))

    def read_reg(self, chip, reg):
        width = int(reg.get("width", 1))
        cmd = P.build_get(chip, reg["addr"], width)
        data = P.parse_get(self.send(cmd), cmd)
        raw, val, txt = convert(reg, data)
        self._log("VAL", "%s %s = %s (raw 0x%X, bytes %s)" % (
            P.hx(chip), reg.get("name", reg["addr"]), txt, raw & 0xFFFFFFFF,
            " ".join("%02X" % b for b in data[:width])))
        return data, raw, val, txt

    def write_reg(self, chip, reg_addr, data):
        cmd = P.build_set(chip, reg_addr, data)
        return P.parse_set(self.send(cmd), cmd)


def parse_step(line):
    """Return ('delay', ms) | ('cmd', text) | None for blank/comment."""
    s = line.split("#", 1)[0].strip()
    if not s:
        return None
    m = re.fullmatch(r"(?:delay|sleep|wait)\s+(\d+)\s*(ms|s)?", s, re.I)
    if m:
        ms = int(m.group(1)) * (1000 if (m.group(2) or "ms").lower() == "s" else 1)
        return ("delay", ms)
    return ("cmd", s)


def run_sequence(session, steps, on_step=None, stop_event=None, stop_on_error=True, sleep=time.sleep):
    """Run steps; returns list of (step, ok, result)."""
    results = []
    session._log("SEQ", "start (%d lines)" % len(steps))
    for i, line in enumerate(steps):
        if stop_event is not None and stop_event.is_set():
            session._log("SEQ", "aborted by user")
            break
        st = parse_step(line)
        if st is None:
            continue
        if st[0] == "delay":
            session._log("SEQ", "delay %d ms" % st[1])
            sleep(st[1] / 1000.0)
            r = (line, True, "delayed %d ms" % st[1])
        else:
            try:
                resp = session.send(st[1])
                body = "\n".join(P.strip_echo(resp, st[1]))
                ok = not P.is_error(body)
                r = (line, ok, body)
            except Exception as e:
                r = (line, False, str(e))
        results.append(r)
        if on_step:
            on_step(i, *r)
        if not r[1] and stop_on_error:
            session._log("SEQ", "stopped on error at line %d" % (i + 1))
            break
    session._log("SEQ", "end")
    return results
