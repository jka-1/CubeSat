"""JSON persistence for settings, devices and sequence profiles; .txt test log."""
import json, os, datetime, threading
from .registers import default_devices

DEFAULT_CONFIG = "i2cconfig --scl=2 --sda=1 --freq=400000"


def app_dir():
    base = os.environ.get("CUBESAT_I2C_HOME") or os.path.join(
        os.environ.get("APPDATA") or os.path.expanduser("~"), "CubeSatI2CTool")
    os.makedirs(base, exist_ok=True)
    return base


def _load(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


class Store:
    def __init__(self, root=None):
        self.root = root or app_dir()
        os.makedirs(self.root, exist_ok=True)
        self.settings_path = os.path.join(self.root, "settings.json")
        self.devices_path = os.path.join(self.root, "devices.json")
        self.profiles_path = os.path.join(self.root, "profiles.json")
        self.settings = _load(self.settings_path, {})
        self.settings.setdefault("i2cconfig", DEFAULT_CONFIG)
        self.settings.setdefault("baud", 115200)
        self.settings.setdefault("port", "")
        self.settings.setdefault("send_config_on_connect", True)
        self.settings.setdefault("timeout_s", 2.0)
        self.devices = _load(self.devices_path, None) or default_devices()
        self.profiles = _load(self.profiles_path, None) or default_profiles()

    def save_settings(self): _save(self.settings_path, self.settings)
    def save_devices(self): _save(self.devices_path, self.devices)
    def save_profiles(self): _save(self.profiles_path, self.profiles)

    def reset_devices(self):
        self.devices = default_devices()
        self.save_devices()

    def device(self, name):
        return next((d for d in self.devices if d["name"] == name), None)

    def add_register(self, dev_name, reg):
        dev = self.device(dev_name)
        a = int(str(reg["addr"]), 16) if str(reg["addr"]).lower().startswith("0x") else int(reg["addr"])
        reg["addr"] = "0x%02X" % a
        dev["registers"] = [r for r in dev["registers"] if int(r["addr"], 16) != a] + [reg]
        dev["registers"].sort(key=lambda r: int(r["addr"], 16))
        self.save_devices()

    def delete_register(self, dev_name, addr):
        dev = self.device(dev_name)
        a = int(str(addr), 16)
        dev["registers"] = [r for r in dev["registers"] if int(r["addr"], 16) != a]
        self.save_devices()


def default_profiles():
    return {
        "Startup (example)": [
            "# Edit before use - bench-note based, not flight validated",
            DEFAULT_CONFIG,
            "i2cdetect",
            "i2cset -c 0x6b -r 0x10 0x00   # BQ25798 watchdog off",
            "i2cset -c 0x6b -r 0x2e 0xb0   # BQ25798 ADC_EN",
            "delay 500",
            "i2cget -c 0x6b -r 0x35 -l 2   # VBUS",
            "i2cget -c 0x08 -r 0x14 -l 2   # Cell 1",
        ],
        "Shutdown (example)": [
            "# Edit before use",
            "i2cset -c 0x6b -r 0x0f 0x82   # EN_CHG off (from 0xA2)",
            "delay 200",
            "i2cget -c 0x6b -r 0x0f",
        ],
    }


class TestLog:
    __test__ = False
    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    def write(self, kind, text):
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        lines = str(text).replace("\r", "").split("\n")
        entry = "[%s] %-4s %s\n" % (ts, kind, lines[0]) + "".join(
            " " * 30 + l + "\n" for l in lines[1:] if l.strip())
        with self._lock, open(self.path, "a", encoding="utf-8") as f:
            f.write(entry)
        return entry

    def read(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""
