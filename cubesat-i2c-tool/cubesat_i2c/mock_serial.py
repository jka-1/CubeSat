"""Fake ESP32 i2c-tools console for tests and offline demo (--mock)."""
import re
from . import protocol as P


class MockESP32:
    def __init__(self, devices=None):
        # devices: {chip: {reg: byte}}
        self.mem = devices if devices is not None else {
            0x08: {0x14: 0xD2, 0x15: 0x0E, 0x36: 0xDA, 0x37: 0x05, 0x3A: 0x07, 0x3B: 0x00,
                   0x68: 0xA3, 0x69: 0x0B},
            0x6B: {0x48: 0x19, 0x35: 0x13, 0x36: 0xA0, 0x0F: 0xA2, 0x41: 0x00, 0x42: 0x26,
                   0x33: 0xFF, 0x34: 0x88},
            0x40: {0x02: 0x25, 0x03: 0x80, 0xFE: 0x54, 0xFF: 0x49},
        }
        self.out = b""
        self.inbuf = b""
        self.is_open = True
        self.history = []

    def reset_input_buffer(self): self.out = b""
    def close(self): self.is_open = False

    def read(self, n=1):
        c, self.out = self.out[:n], self.out[n:]
        return c

    def write(self, data):
        self.inbuf += data
        while b"\n" in self.inbuf:
            line, self.inbuf = self.inbuf.split(b"\n", 1)
            cmd = line.decode().strip()
            self.history.append(cmd)
            self.out += (cmd + "\r\n" + self._handle(cmd) + "\r\n" + P.PROMPT + " ").encode()
        return len(data)

    def _arg(self, cmd, flag, default=None):
        m = re.search(r"%s\s+(\S+)" % flag, cmd)
        return P.to_int(m.group(1)) if m else default

    def _handle(self, cmd):
        if not cmd:
            return ""
        name = cmd.split()[0]
        if name == "i2cconfig":
            return ""
        if name == "i2cdetect":
            rows = ["     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f"]
            for base in range(0, 0x80, 0x10):
                cells = ["%02x" % a if a in self.mem else "--" for a in range(base, base + 16)]
                rows.append("%02x: %s" % (base, " ".join(cells)))
            return "\r\n".join(rows)
        chip = self._arg(cmd, "-c")
        if chip not in self.mem:
            return "Read failed" if name == "i2cget" else "Write Failed"
        regs = self.mem[chip]
        if name == "i2cget":
            r = self._arg(cmd, "-r", 0); n = self._arg(cmd, "-l", 1)
            return " ".join("0x%02x" % regs.get(r + i, 0) for i in range(n)) + " "
        if name == "i2cset":
            toks = cmd.split()
            r = self._arg(cmd, "-r", 0)
            idx = toks.index("-r") + 2 if "-r" in toks else toks.index("-c") + 2
            for i, t in enumerate(toks[idx:]):
                regs[r + i] = P.to_int(t)
            return "Write OK"
        if name == "i2cdump":
            rows = ["     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f"]
            for base in range(0, 0x100, 0x10):
                rows.append("%02x: %s" % (base, " ".join("%02x" % regs.get(base + i, 0) for i in range(16))))
            return "\r\n".join(rows)
        return "Unrecognized command"
