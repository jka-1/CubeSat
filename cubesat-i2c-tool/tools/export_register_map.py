"""Export the app register catalog to the web Debug Mode page and generate JS/Python parity fixtures.

usage: python tools/export_register_map.py <CubeSat repo root>
writes site/assets/data/register-map.json and telemetry-bridge/test/fixtures/register-conversions.json
"""
import json, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cubesat_i2c.registers import default_devices  # noqa: E402
from cubesat_i2c.conversions import convert  # noqa: E402


def main(repo):
    devices = default_devices()
    site = os.path.join(repo, "site", "assets", "data", "register-map.json")
    with open(site, "w") as f:
        json.dump({"source": "cubesat-i2c-tool/cubesat_i2c/registers.py", "devices": devices}, f, indent=1)
    rnd = random.Random(20261014)
    cases = []
    for dev in devices:
        for reg in dev["registers"]:
            w = int(reg.get("width", 1))
            samples = [[0] * w, [0xFF] * w, [0x80] + [0] * (w - 1), [0x7F] + [0xFF] * (w - 1)]
            samples += [[rnd.randrange(256) for _ in range(w)] for _ in range(12)]
            for data in samples:
                raw, val, txt = convert(reg, data)
                cases.append(dict(device=dev["addr"], reg=reg["addr"], data=data, raw=raw, value=val, text=txt))
    # Exact binary ties for the formatter (Python %-formatting rounds ties to even).
    tie = dict(addr="0xEE", name="tie", width=1, scale=0.5, precision=0, unit="u")
    for b in range(8):
        raw, val, txt = convert(tie, [b])
        cases.append(dict(device="synthetic", reg="0xEE", register=tie, data=[b], raw=raw, value=val, text=txt))
    fx = os.path.join(repo, "telemetry-bridge", "test", "fixtures", "register-conversions.json")
    with open(fx, "w") as f:
        json.dump(cases, f, indent=0)
    print("wrote", site, "and", fx, "(%d cases)" % len(cases))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
