"""Streaming Telemetry model for the app's Debug (Wireless) "Streaming Telemetry" tab.
Python port of site/assets/js/streaming-telemetry.mjs (StreamingModel / deviceVisibility / decodeDevices) so the
app and the web pages agree on presence (v5 debug device state, v4 polling mask, v2 assumed) and conversions.
It exposes on_event()/sse_open/error/expect_replay so link_source.SseLinkSource can feed it unchanged."""
import math, threading, time

from .link_source import parse_iso_ms

DEFAULT_STALE_MS = 5000
MAX_HISTORY_MS = 3_600_000
WINDOWS = [("1 min", 60_000), ("5 min", 300_000), ("15 min", 900_000), ("60 min", 3_600_000)]
DEVICES = [
    {"key": "pv", "label": "PV / INA226", "addr": "0x40", "mask": 0x01},
    {"key": "bms", "label": "BMS / BQ76942", "addr": "0x08", "mask": 0x02},
    {"key": "mppt", "label": "MPPT / BQ25798", "addr": "0x6B", "mask": 0x04},
]
BMS_CELL_LABELS = ["Cell 1", "Cell 2", "Cell 3", "Cell 4"]   # packet cells = BQ76942 cells 1, 2, 3, 4 (0x14/0x16/0x18/0x1A)
MPPT_FAULT_BITS = ["VAC1_OVP_STAT", "VAC2_OVP_STAT", "CONV_OCP_STAT", "BAT_OCP_STAT",
                   "IBUS_OCP_STAT", "VBAT_OVP_STAT", "VBUS_OVP_STAT", "BAT_REG_STAT"]   # BQ25798 REG20 bits 0..7
INA226_BUS_LSB_V = 0.00125
# Effective PV shunt seen by the INA226 (bridge PV_INA226_SHUNT_OHMS default). With the firmware's
# CAL 0x0A00 this gives Current_LSB = 0.00512/(2560*0.002) = 1 mA, same as the Registers tab.
INA226_SHUNT_OHMS = 0.002


def ina226_current_lsb_a(cal, shunt_ohms=INA226_SHUNT_OHMS):
    return 0.00512 / (cal * shunt_ohms) if cal and cal > 0 and shunt_ohms > 0 else 0.001
# TEMT6000 LIGHT_OUT level bands (calibrated mV), same constants as the firmware, bridge and web.
LIGHT_BRIGHT_MIN_MV = 800
LIGHT_VERY_BRIGHT_MIN_MV = 1800


def light_level_from_mv(mv):
    """< 800 mV Lightly Lit, 800..1800 mV Bright, > 1800 mV Very Bright."""
    if mv is None:
        return None
    if mv < LIGHT_BRIGHT_MIN_MV:
        return "Lightly Lit"
    if mv <= LIGHT_VERY_BRIGHT_MIN_MV:
        return "Bright"
    return "Very Bright"


def mcp9700_temp_c_from_mv(mv):
    """MCP9700: 500 mV at 0 degC, 10 mV/degC."""
    return None if mv is None else (mv - 500) / 10.0


def _num(v):
    if v is None or isinstance(v, bool) or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _int(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def device_visibility(packet):
    packet = packet or {}
    debug = packet.get("debug") if isinstance(packet.get("debug"), dict) else None
    mask = _int((packet.get("sensor_polling") or {}).get("active_sensor_mask"))
    tel = packet.get("telemetry") or {}
    out = {}
    for d in DEVICES:
        t = tel.get(d["key"])
        dev = (debug or {}).get("devices", {}).get(d["key"]) if debug else None
        if dev:
            source, state = "v5", dev.get("state") or "unknown"
            if state == "unknown" and not dev.get("probed"):
                state = "present"
        elif mask is not None:
            source, state = "polling-mask", "present" if mask & d["mask"] else "not_polled"
        else:
            source, state = "assumed", "present"
        if isinstance(t, dict) and t.get("available") is False and state == "present":
            state = "absent"
        if t is None or t is False:   # JS `!t`: missing group ({} still counts as present)
            state = "absent"
        out[d["key"]] = {"state": state, "visible": state == "present", "source": source}
    return out


def normalize_peripheral(t):
    p = t.get("peripheral")
    if not isinstance(p, dict):
        return {"temperatureC": None, "temperatureSaturated": None, "lightVoltageMv": None, "lightLevel": None,
                "relativeLightLevel": None, "lightSaturated": None}
    temp, light = _num(p.get("temperatureC")), _num(p.get("relativeLightLevel"))
    return {"temperatureC": temp, "temperatureSaturated": None if temp is None else p.get("temperatureSaturated") is True,
            "lightVoltageMv": _num(p.get("lightVoltageMv")),
            "lightLevel": light_level_from_mv(_num(p.get("lightVoltageMv"))),
            "relativeLightLevel": None if light is None else min(1.0, max(0.0, light)),
            "lightSaturated": None if light is None else p.get("lightSaturated") is True}


def decode_devices(packet):
    packet = packet or {}
    t, raw = packet.get("telemetry") or {}, packet.get("raw") or {}
    pv = t.get("pv") or {}
    bus_raw = _num((raw.get("pv") or {}).get("bus"))
    cv = (t.get("bms") or {}).get("cellVoltagesV")
    cells = [_num(x) for x in cv[:4]] if isinstance(cv, list) else [None] * 4
    cells += [None] * (4 - len(cells))
    valid = [x for x in cells if x is not None]
    mppt = t.get("mppt") or {}
    fault20 = _int((raw.get("mppt") or {}).get("fault20"))
    names = list(mppt.get("faults") or []) if isinstance(mppt.get("faults"), list) else []
    faults = [{"name": n, "bit": b, "active": ((fault20 >> b) & 1) == 1 if fault20 is not None else n in names}
              for b, n in enumerate(MPPT_FAULT_BITS)]
    faults += [{"name": n, "bit": None, "active": True} for n in names if n not in MPPT_FAULT_BITS]
    bms = t.get("bms") or {}
    per = normalize_peripheral(t)
    adc_gpio = t.get("adc") if isinstance(t.get("adc"), dict) else None
    cur, pwr = _num(pv.get("currentA")), _num(pv.get("powerW"))
    rpv = raw.get("pv") or {}
    r_cur, r_pwr, r_cal = _int(rpv.get("current")), _int(rpv.get("power")), _int(rpv.get("calibration"))
    if pv.get("available") is not False and r_cur is not None and r_cal:
        # Prefer the raw 0x04/0x03 words with the chip's own CAL (0x05), like the Registers tab.
        lsb = ina226_current_lsb_a(r_cal)
        cur = round((r_cur - 0x10000 if r_cur >= 0x8000 else r_cur) * lsb, 6)
        pwr = None if r_pwr is None else round(r_pwr * 25 * lsb, 6)
    bus_v = None if pv.get("available") is False else (
        _num(pv.get("busVoltageV")) if _num(pv.get("busVoltageV")) is not None
        else (None if bus_raw is None else round(bus_raw * INA226_BUS_LSB_V, 5)))
    ibus = _num(mppt.get("ibusA"))
    return {
        # INA226 0x02 bus V (1.25 mV/LSB), 0x03 power (25 x Current_LSB), 0x04 current (Current_LSB)
        "pv": {"busV": bus_v, "currentA": cur, "powerW": pwr, "shuntMv": _num(pv.get("shuntVoltageMv")),
               "currentMa": None if cur is None else round(cur * 1000, 3),
               "powerMw": None if pwr is None else round(pwr * 1000, 3)},
        "bms": {"cells": [{"label": BMS_CELL_LABELS[i], "v": v} for i, v in enumerate(cells)],
                "minV": min(valid) if valid else None, "maxV": max(valid) if valid else None,
                "deltaMv": round((max(valid) - min(valid)) * 1000) if valid else None,
                "packV": _num(bms.get("packVoltageV")),        # BQ76942 0x36 PACK pin (v6 packets)
                "intTempC": _num(bms.get("internalTempC")),    # BQ76942 0x68 Int Temperature (v6 packets)
                "hasExt": "packVoltageV" in bms or "internalTempC" in bms},
        "mppt": {"acdrv": mppt.get("switchState"), "reg13": _int((raw.get("mppt") or {}).get("reg13")),
                 "fault20": fault20, "faults": faults, "activeFaults": sum(1 for f in faults if f["active"]),
                 # BQ25798 power path ADC (v6): REG31 IBUS, REG35 VBUS, REG37 VAC1, REG3B VBAT, REG3D VSYS, REG41 TDIE
                 "ibusMa": None if ibus is None else round(ibus * 1000),
                 "vbusV": _num(mppt.get("vbusV")), "vac1V": _num(mppt.get("vac1V")), "vbatV": _num(mppt.get("vbatV")),
                 "vsysV": _num(mppt.get("vsysV")), "dieTempC": _num(mppt.get("dieTempC")),
                 "adcEnabled": mppt.get("adcEnabled") if isinstance(mppt.get("adcEnabled"), bool) else None,
                 "hasExt": "vbusV" in mppt},
        "mcu": {"tempC": _num((t.get("mcu") or {}).get("temperatureC"))},
        "peripheral": per,
        # The two ADC1 devices: TEMP_OUT (MCP9700) and LIGHT_OUT (TEMT6000)
        "adc": {"temp": {"tempC": per["temperatureC"], "mv": _num((t.get("peripheral") or {}).get("temperatureVoltageMv")),
                         "gpio": ((adc_gpio or {}).get("temp") or {}).get("gpio")},
                "light": {"level": per["lightLevel"], "relative": per["relativeLightLevel"], "mv": per["lightVoltageMv"],
                          "gpio": ((adc_gpio or {}).get("light") or {}).get("gpio")}},
    }


SERIES = {
    "pv.busV": lambda d: d["pv"]["busV"], "pv.currentA": lambda d: d["pv"]["currentA"],
    "pv.powerW": lambda d: d["pv"]["powerW"], "pv.shuntMv": lambda d: d["pv"]["shuntMv"],
    "bms.cell0": lambda d: d["bms"]["cells"][0]["v"], "bms.cell1": lambda d: d["bms"]["cells"][1]["v"],
    "bms.cell2": lambda d: d["bms"]["cells"][2]["v"], "bms.cell3": lambda d: d["bms"]["cells"][3]["v"],
    "bms.deltaMv": lambda d: d["bms"]["deltaMv"], "mppt.faults": lambda d: d["mppt"]["activeFaults"],
    "mcu.tempC": lambda d: d["mcu"]["tempC"], "per.tempC": lambda d: d["peripheral"]["temperatureC"],
    "per.light": lambda d: d["peripheral"]["lightVoltageMv"],
    "pv.currentMa": lambda d: d["pv"]["currentMa"], "pv.powerMw": lambda d: d["pv"]["powerMw"],
    "bms.packV": lambda d: d["bms"]["packV"], "bms.intTempC": lambda d: d["bms"]["intTempC"],
    "mppt.ibusMa": lambda d: d["mppt"]["ibusMa"], "mppt.vbusV": lambda d: d["mppt"]["vbusV"],
    "mppt.vac1V": lambda d: d["mppt"]["vac1V"], "mppt.vbatV": lambda d: d["mppt"]["vbatV"],
    "mppt.vsysV": lambda d: d["mppt"]["vsysV"], "mppt.dieTempC": lambda d: d["mppt"]["dieTempC"],
    "per.tempMv": lambda d: d["adc"]["temp"]["mv"], "per.lightMv": lambda d: d["adc"]["light"]["mv"],
}


class StreamingModel:
    def __init__(self, stale_ms=DEFAULT_STALE_MS, max_history_ms=MAX_HISTORY_MS):
        self.lock = threading.Lock()
        self.stale_ms, self.max_history_ms = stale_ms, max_history_ms
        self.sse_open, self.error, self.expect_replay = False, "", False
        self.reset()

    def reset(self):
        self.latest = self.decoded = self.visibility = self.last_received_at = self.status = self.last_key = None
        self.skew_ms, self.packets = 0, 0
        self.series = {k: [] for k in SERIES}

    @staticmethod
    def _now():
        return int(time.time() * 1000)

    def on_event(self, ev, now=None):   # SseLinkSource interface
        return self.ingest(ev, now)

    def ingest(self, ev, now=None):
        now = self._now() if now is None else now
        if not isinstance(ev, dict):
            return False
        with self.lock:
            if ev.get("type") == "status":
                self.status = ev
                st = parse_iso_ms(ev.get("server_time"))
                if st is not None:
                    self.skew_ms = now - st
                if isinstance(ev.get("telemetry_stale_after_ms"), (int, float)):
                    self.stale_ms = ev["telemetry_stale_after_ms"]
                return True
            if ev.get("type") != "telemetry" or not isinstance(ev.get("packet"), dict):
                return False
            t = parse_iso_ms(ev.get("received_at"))
            if t is None:
                return False
            key = "%s|%s" % (ev.get("received_at"), ev["packet"].get("seq"))
            if key == self.last_key:   # replay of the same envelope after an SSE reconnect
                return False
            self.last_key, self.latest, self.last_received_at = key, ev, t
            self.packets += 1
            self.visibility = device_visibility(ev["packet"])
            self.decoded = decode_devices(ev["packet"])
            for k, f in SERIES.items():
                vis = self.visibility.get(k.split(".")[0])
                v = f(self.decoded) if (vis is None or vis["visible"]) else None
                arr = self.series[k]
                arr.append((t, v))
                while arr and arr[0][0] < t - self.max_history_ms:
                    arr.pop(0)
            return True

    def server_now(self, now=None):
        return (self._now() if now is None else now) - self.skew_ms

    def age_ms(self, now=None):
        return None if self.last_received_at is None else max(0, self.server_now(now) - self.last_received_at)

    def is_stale(self, now=None):
        a = self.age_ms(now)
        return a is None or a > self.stale_ms

    def series_window(self, key, window_ms, now=None):
        with self.lock:
            end = self.server_now(now); start = end - window_ms
            return {"start": start, "end": end, "points": [p for p in self.series.get(key, []) if p[0] >= start]}

    def snapshot(self, now=None):
        with self.lock:
            pkt = (self.latest or {}).get("packet")
            stale = self.is_stale(now)
            vis = self.visibility or {}
            devices, hidden = [], []
            for d in DEVICES:
                v = vis.get(d["key"])
                if not v:
                    continue
                if v["visible"]:
                    devices.append(dict(d, state="stale" if stale else "present", source=v["source"], data=self.decoded[d["key"]]))
                else:
                    hidden.append(dict(d, state=v["state"], source=v["source"]))
            per = (self.decoded or {}).get("peripheral")
            mcu = (self.decoded or {}).get("mcu")
            return {
                "hasData": pkt is not None, "stale": stale, "ageMs": self.age_ms(now), "packets": self.packets,
                "format": (pkt or {}).get("packet_format"), "seq": (pkt or {}).get("seq"),
                "debug": (pkt or {}).get("debug"), "link": (pkt or {}).get("link"),
                "devices": devices, "hidden": hidden,
                "mcu": mcu if mcu and mcu["tempC"] is not None else None,
                "peripheral": per if per and (per["temperatureC"] is not None or per["lightVoltageMv"] is not None) else None,
                "adc": (self.decoded or {}).get("adc") if per and (per["temperatureC"] is not None or per["lightVoltageMv"] is not None) else None,
                "bridgeConnected": None if self.status is None else bool(self.status.get("telemetry_connected")),
                "signed": None if self.latest is None else bool(((self.latest or {}).get("provenance") or {}).get("authenticated")),
                "recording": None if self.status is None else bool(((self.status or {}).get("recording") or {}).get("active_run_id")),
                "sseOpen": self.sse_open, "error": self.error,
            }


def fmt_si(v, unit):
    """Auto-scaled SI formatting (A -> mA -> uA), same as streaming-view.mjs fmtSI."""
    if v is None:
        return "--"
    a = abs(v)
    if a == 0 or a >= 1:
        return "%.3f %s" % (v, unit)
    if a >= 1e-3:
        return "%.2f m%s" % (v * 1e3, unit)
    return "%.1f µ%s" % (v * 1e6, unit)
