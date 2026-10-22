"""i2c-tools console command builders and response parsers (no Qt dependency).

Command syntax per Espressif i2c-tools example:
  i2cconfig [--port=<0|1>] [--freq=<Hz>] --sda=<gpio> --scl=<gpio>
  i2cdetect
  i2cget -c <chip_addr> [-r <register_addr>] [-l <length>]
  i2cset -c <chip_addr> [-r <register_addr>] [<data>]...
  i2cdump -c <chip_addr> [-s <size>]
"""
import re

PROMPT = "i2c-tools>"
HEX_RE = re.compile(r"\b0x([0-9a-fA-F]{1,2})\b")
ERROR_MARKERS = ("read failed", "write failed", "failed", "error", "unrecognized command",
                 "invalid", "timeout")


def to_int(v):
    """Accept int, '0x1f', '31', '1f' (if contains a-f)."""
    if isinstance(v, int):
        return v
    s = str(v).strip().lower()
    if s.startswith("0x"):
        return int(s, 16)
    if s.startswith("0b"):
        return int(s, 2)
    if re.fullmatch(r"[0-9]+", s):
        return int(s)
    return int(s, 16)


def hx(v):
    return "0x%02x" % to_int(v)


def build_config(scl=2, sda=1, freq=400000, port=None):
    cmd = "i2cconfig"
    if port is not None and str(port) != "":
        cmd += " --port=%s" % port
    return cmd + " --scl=%d --sda=%d --freq=%d" % (int(scl), int(sda), int(freq))


def build_get(chip, reg=None, length=1):
    cmd = "i2cget -c %s" % hx(chip)
    if reg is not None:
        cmd += " -r %s" % hx(reg)
    if int(length) != 1:
        cmd += " -l %d" % int(length)
    return cmd


def build_set(chip, reg, data):
    cmd = "i2cset -c %s" % hx(chip)
    if reg is not None:
        cmd += " -r %s" % hx(reg)
    for b in data:
        cmd += " %s" % hx(b)
    return cmd


def build_dump(chip, size=1):
    cmd = "i2cdump -c %s" % hx(chip)
    if int(size) != 1:
        cmd += " -s %d" % int(size)
    return cmd


def value_to_bytes(value, width, endian):
    """Integer -> list of bytes in bus order."""
    v = to_int(value)
    if v < 0:
        v &= (1 << (8 * width)) - 1
    if v >= (1 << (8 * width)):
        raise ValueError("value 0x%x does not fit in %d byte(s)" % (v, width))
    return list(v.to_bytes(width, "little" if endian == "little" else "big"))


def parse_value_input(text, width, endian):
    """'0x22 0x00' -> explicit bytes; single number -> split by width/endian."""
    parts = text.replace(",", " ").split()
    if not parts:
        raise ValueError("empty value")
    if len(parts) > 1:
        out = [to_int(p) for p in parts]
        if any(not 0 <= b <= 0xFF for b in out):
            raise ValueError("each byte must be 0x00-0xff")
        return out
    return value_to_bytes(parts[0], width, endian)


def strip_echo(response, command=None):
    lines = [l.rstrip() for l in response.replace("\r", "\n").split("\n")]
    out = []
    for l in lines:
        s = l.strip()
        if not s:
            continue
        if command and command.strip() in s:
            continue  # echoed command line (possibly prefixed with prompt)
        if s.startswith(PROMPT):
            s = s[len(PROMPT):].strip()
            if not s:
                continue
        out.append(s)
    return out


def is_error(response):
    low = response.lower()
    return any(m in low for m in ERROR_MARKERS)


def parse_get(response, command=None):
    """Return list of byte ints read by i2cget, or raise IOError."""
    lines = strip_echo(response, command)
    body = "\n".join(lines)
    if is_error(body):
        raise IOError(body.strip() or "read failed")
    vals = [int(m, 16) for m in HEX_RE.findall(body)]
    if not vals:
        raise IOError("no data in response: %r" % body)
    return vals


def parse_set(response, command=None):
    body = "\n".join(strip_echo(response, command))
    if is_error(body):
        raise IOError(body.strip() or "write failed")
    return body.strip() or "Write OK"


def parse_detect(response):
    """Parse i2cdetect grid -> sorted list of addresses found."""
    found = []
    for line in response.replace("\r", "\n").split("\n"):
        m = re.match(r"^\s*([0-7]0):\s*(.*)$", line)
        if not m:
            continue
        base = int(m.group(1), 16)
        cells = m.group(2).split()
        for i, c in enumerate(cells[:16]):
            if re.fullmatch(r"[0-9a-fA-F]{2}", c) and c not in ("UU",):
                found.append(int(c, 16))
            elif c == "UU":
                found.append(base + i)
    return sorted(set(found))


def parse_dump(response):
    """Parse i2cdump table -> {reg: byte}."""
    out = {}
    for line in response.replace("\r", "\n").split("\n"):
        m = re.match(r"^\s*([0-9a-fA-F]{2}):\s+((?:[0-9a-fA-FX]{2}\s*){1,16})", line)
        if not m:
            continue
        base = int(m.group(1), 16)
        for i, c in enumerate(m.group(2).split()[:16]):
            if c.upper() != "XX":
                out[base + i] = int(c, 16)
    return out
