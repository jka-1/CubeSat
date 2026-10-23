import threading, pytest
from cubesat_i2c import protocol as P
from cubesat_i2c.conversions import convert
from cubesat_i2c.registers import default_devices
from cubesat_i2c.session import Session, run_sequence, parse_step
from cubesat_i2c.mock_serial import MockESP32
from cubesat_i2c.storage import Store, TestLog, DEFAULT_CONFIG


def reg(dev, addr):
    d = next(d for d in default_devices() if d["name"].startswith(dev))
    return next(r for r in d["registers"] if int(r["addr"], 16) == addr)


# ---- command builders
def test_builders():
    assert P.build_config() == DEFAULT_CONFIG
    assert P.build_get(0x8, 0x14, 2) == "i2cget -c 0x08 -r 0x14 -l 2"
    assert P.build_get("0x6b", "0x48") == "i2cget -c 0x6b -r 0x48"
    assert P.build_set(0x8, 0x3e, [0x22, 0]) == "i2cset -c 0x08 -r 0x3e 0x22 0x00"
    assert P.build_dump(0x40, 2) == "i2cdump -c 0x40 -s 2"


def test_value_input():
    assert P.parse_value_input("0x22 0x00", 2, "little") == [0x22, 0]
    assert P.parse_value_input("0x0022", 2, "little") == [0x22, 0]
    assert P.parse_value_input("0x4127", 2, "big") == [0x41, 0x27]
    assert P.parse_value_input("0xA2", 1, "big") == [0xA2]
    with pytest.raises(ValueError):
        P.parse_value_input("0x1FF", 1, "big")


# ---- parsers
def test_parse_get():
    assert P.parse_get("i2cget -c 0x08 -r 0x14 -l 2\r\n0xd2 0x0e \r\ni2c-tools> ",
                       "i2cget -c 0x08 -r 0x14 -l 2") == [0xD2, 0x0E]
    with pytest.raises(IOError):
        P.parse_get("i2cget -c 0x09 -r 0x00\r\nRead failed\r\ni2c-tools> ", "i2cget -c 0x09 -r 0x00")


def test_parse_set_and_detect_dump():
    assert P.parse_set("x\r\nWrite OK\r\ni2c-tools> ", "x") == "Write OK"
    with pytest.raises(IOError):
        P.parse_set("Write Failed")
    grid = MockESP32()._handle("i2cdetect")
    assert P.parse_detect(grid) == [0x08, 0x40, 0x6B]
    d = P.parse_dump(MockESP32()._handle("i2cdump -c 0x6b"))
    assert d[0x48] == 0x19


# ---- conversions vs. spreadsheet values
@pytest.mark.parametrize("dev,addr,data,expect", [
    ("BMS", 0x14, [0xD2, 0x0E], 3.794),     # Cell1 0E D2
    ("BMS", 0x16, [0xCC, 0x0E], 3.788),
    ("BMS", 0x18, [0x47, 0x0E], 3.655),
    ("BMS", 0x1A, [0x48, 0x0E], 3.656),
    ("BMS", 0x36, [0xDA, 0x05], 14.98),     # PACK 05 DA
    ("BMS", 0x3A, [0x07, 0x00], 0.007),     # CC2 7 userA
    ("BMS", 0x68, [0xA3, 0x0B], 24.75),     # 0B A3 -> 24.75 C
    ("MPPT", 0x35, [0x13, 0xA0], 5.024),
    ("MPPT", 0x37, [0x13, 0xB0], 5.040),
    ("MPPT", 0x31, [0x00, 0x1F], 0.031),
    ("MPPT", 0x3D, [0x32, 0x06], 12.806),
    ("MPPT", 0x3B, [0x38, 0xD9], 14.553),
    ("MPPT", 0x33, [0xFF, 0x88], -0.120),   # signed IBAT
    ("MPPT", 0x41, [0x00, 0x26], 19.0),
    ("INA226", 0x02, [0x25, 0x80], 12.0),   # 0x2580=9600*1.25mV
    ("INA226", 0x01, [0xFF, 0xFF], -2.5e-6),
])
def test_conversions(dev, addr, data, expect):
    raw, val, txt = convert(reg(dev, addr), data)
    assert val == pytest.approx(expect, abs=1e-6)


def test_bitfields():
    _, val, txt = convert(reg("MPPT", 0x48), [0x19])
    assert val is None and "PN=3" in txt and "DEV_REV=1" in txt
    _, _, txt = convert(reg("MPPT", 0x0F), [0xA2])
    assert "EN_CHG=1" in txt


# ---- session over mock serial
def test_session_read_write(tmp_path):
    log = TestLog(str(tmp_path / "log.txt"))
    s = Session(MockESP32(), log, timeout=0.5)
    data, raw, val, txt = s.read_reg(0x08, reg("BMS", 0x14))
    assert val == pytest.approx(3.794)
    assert s.write_reg(0x6B, 0x0F, [0x82]) == "Write OK"
    assert s.read_reg(0x6B, reg("MPPT", 0x0F))[1] == 0x82
    with pytest.raises(IOError):
        s.read_reg(0x22, reg("BMS", 0x14))
    assert s.detect() == [0x08, 0x40, 0x6B]
    text = log.read()
    assert "TX   i2cget -c 0x08 -r 0x14 -l 2" in text and "VAL" in text


def test_sequence(tmp_path):
    s = Session(MockESP32(), TestLog(str(tmp_path / "l.txt")), timeout=0.5)
    slept = []
    steps = ["# c", DEFAULT_CONFIG, "delay 250", "wait 1 s", "i2cset -c 0x6b -r 0x0f 0x82 # x",
             "i2cget -c 0x22 -r 0x00", "i2cget -c 0x6b -r 0x0f"]
    started = []
    res = run_sequence(s, steps, sleep=slept.append, on_step_start=lambda i, line: started.append((i, line)))
    assert slept == [0.25, 1.0]
    assert [i for i, _ in started] == [1, 2, 3, 4, 5]
    assert [r[1] for r in res] == [True, True, True, True, False]  # stopped at failure
    res = run_sequence(s, steps, sleep=lambda x: None, stop_on_error=False)
    assert res[-1][1] and "0x82" in res[-1][2]
    ev = threading.Event(); ev.set()
    assert run_sequence(s, steps, stop_event=ev) == []
    assert parse_step("  ") is None and parse_step("delay 5") == ("delay", 5)


def test_store(tmp_path):
    st = Store(str(tmp_path))
    assert st.settings["i2cconfig"] == DEFAULT_CONFIG
    assert st.device("BMS (BQ76942)")["addr"] == "0x08"
    st.add_register("INA226", dict(addr="0x10", name="Custom", access="RW", width=1, value="0x5"))
    st.profiles["p"] = ["i2cdetect"]; st.save_profiles()
    st2 = Store(str(tmp_path))
    assert any(r["name"] == "Custom" for r in st2.device("INA226")["registers"])
    assert st2.profiles["p"] == ["i2cdetect"]
    st2.delete_register("INA226", "0x10")
    assert not any(r["name"] == "Custom" for r in Store(str(tmp_path)).device("INA226")["registers"])
