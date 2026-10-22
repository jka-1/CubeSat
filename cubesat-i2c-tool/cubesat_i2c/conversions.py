"""Raw register bytes -> engineering values.  value = raw * scale + offset."""


def bytes_to_raw(data, width, endian, signed=False):
    data = list(data)[:width]
    if len(data) < width:
        raise ValueError("expected %d bytes, got %d" % (width, len(data)))
    return int.from_bytes(bytes(data), "little" if endian == "little" else "big", signed=signed)


def convert(reg, data):
    """reg: register dict. Returns (raw_int, eng_value_or_None, text)."""
    width = int(reg.get("width", 1))
    raw = bytes_to_raw(data, width, reg.get("endian", "big"), reg.get("signed", False))
    scale = reg.get("scale")
    unit = reg.get("unit", "")
    if scale is None:
        bits = format(raw & ((1 << 8 * width) - 1), "0%db" % (8 * width))
        return raw, None, "0x%0*X (0b%s)%s" % (2 * width, raw & ((1 << 8 * width) - 1), bits,
                                              decode_bits(reg, raw))
    val = raw * float(scale) + float(reg.get("offset", 0.0))
    prec = int(reg.get("precision", 3))
    return raw, val, "%.*f %s" % (prec, val, unit)


def decode_bits(reg, raw):
    fields = reg.get("bitfields") or []
    if not fields:
        return ""
    parts = []
    for f in fields:
        hi, lo = f["bits"] if isinstance(f["bits"], list) else (f["bits"], f["bits"])
        v = (raw >> lo) & ((1 << (hi - lo + 1)) - 1)
        parts.append("%s=%d" % (f["name"], v))
    return "  [" + ", ".join(parts) + "]"
