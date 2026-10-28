"""Default device/register catalog. Seeded from Register Map.xlsx (BMS + SWITCH sheets),
the CubeSat repo (telemetry-fixes-addons), and TI datasheets (INA226, BQ25798)."""
import copy


def R(addr, name, access="R", width=1, endian="big", signed=False, scale=None, offset=0.0,
      unit="", precision=3, notes="", bitfields=None, source="sheet"):
    d = dict(addr="0x%02X" % addr, name=name, access=access, width=width, endian=endian,
             signed=signed, scale=scale, offset=offset, unit=unit, precision=precision,
             notes=notes, source=source)
    if bitfields:
        d["bitfields"] = bitfields
    return d


# BQ76942 direct commands: 16-bit little-endian (LSB at reg, MSB at reg+1).
BMS_REGS = [
    R(0x14, "Cell 1 Voltage", width=2, endian="little", scale=0.001, unit="V", notes="mV/LSB. Sheet: 0E D2 -> 3.794 V"),
    R(0x16, "Cell 2 Voltage", width=2, endian="little", scale=0.001, unit="V", notes="mV/LSB"),
    R(0x18, "Cell 3 Voltage", width=2, endian="little", scale=0.001, unit="V", notes="mV/LSB"),
    R(0x1A, "Cell 4 Voltage", width=2, endian="little", scale=0.001, unit="V", notes="mV/LSB"),
    R(0x36, "PACK Pin Voltage", width=2, endian="little", scale=0.01, unit="V", precision=2,
      notes="userV=10 mV/LSB. Sheet: 05 DA (1498) -> 14.98 V"),
    R(0x3A, "CC2 Current", width=2, endian="little", signed=True, scale=0.001, unit="A",
      notes="userA = 1 mA/LSB (default units), signed. Sheet: 00 07 -> 0.007 A"),
    R(0x68, "Internal Temperature", width=2, endian="little", scale=0.1, offset=-273.15, unit="degC",
      precision=2, notes="0.1 K/LSB. Sheet: 0B A3 (2979) -> 24.75 degC"),
    R(0x3E, "FET_ENABLE (subcommand 0x0022)", access="W", width=2, endian="little",
      notes="Write '0x22 0x00' to 0x3E (subcommand address, LSB first) to toggle FET_ENABLE. "
            "Sheet readback 0x0007."),
]

# BQ25798: 8-bit control/status, 16-bit ADC big-endian (MSB at reg).
SW_REGS = [
    R(0x0F, "REG0F Charger Control 0", access="RW",
      notes="EN_CHG = bit5. Sheet: 0xA2 enabled, 0x82 disabled",
      bitfields=[dict(name="EN_AUTO_IBATDIS", bits=7), dict(name="FORCE_IBATDIS", bits=6),
                 dict(name="EN_CHG", bits=5), dict(name="EN_ICO", bits=4),
                 dict(name="FORCE_ICO", bits=3), dict(name="EN_HIZ", bits=2), dict(name="EN_TERM", bits=1)]),
    R(0x10, "REG10 Charger Control 1 (Watchdog)", access="RW",
      notes="WATCHDOG = bits[2:0]; sheet: disable watchdog before bench tests",
      bitfields=[dict(name="WATCHDOG", bits=[2, 0])]),
    R(0x12, "REG12 Charger Control 3", access="RW",
      notes="Sheet note '0x00 disable charge controller' is unverified; review bitfields"),
    R(0x13, "REG13 Charger Control 4", access="RW",
      notes="Bench: 0x81 VIN1->VIN2, 0x41 VIN2->VIN1 (unvalidated per sheet)"),
    R(0x14, "REG14 Charger Control 5", access="RW",
      notes="BQ25798 charger control 5. Bit 6 is reserved and must remain 0; preserve other control bits when changing a setting.",
      source="datasheet", bitfields=[dict(name="SFET_PRESENT", bits=7), dict(name="EN_IBAT", bits=5),
        dict(name="IBAT_REG", bits=[4, 3]), dict(name="EN_IINDPM", bits=2),
        dict(name="EN_EXTILIM", bits=1), dict(name="EN_BATOC", bits=0)]),
    R(0x1B, "REG1B Charger Status 0"),
    R(0x1C, "REG1C Charger Status 1",
      bitfields=[dict(name="CHG_STAT", bits=[7, 5]), dict(name="VBUS_STAT", bits=[4, 1]),
                 dict(name="BC12_DONE", bits=0)]),
    R(0x1E, "REG1E Charger Status 3"),
    R(0x2E, "REG2E ADC Control", access="RW",
      notes="ADC_EN = bit7. Sheet bench 0x30 has ADC_EN=0; set bit7 (e.g. 0xB0) and verify",
      bitfields=[dict(name="ADC_EN", bits=7), dict(name="ADC_RATE", bits=6),
                 dict(name="ADC_SAMPLE", bits=[5, 4])]),
    R(0x30, "REG30 ADC Function Disable 1", access="RW",
      notes="0x00 enables VAC1/VAC2/D+/D- ADC channels"),
    R(0x31, "REG31 IBUS ADC", width=2, signed=True, scale=0.001, unit="A", notes="1 mA/LSB signed"),
    R(0x33, "REG33 IBAT ADC", width=2, signed=True, scale=0.001, unit="A",
      notes="1 mA/LSB signed (sheet: 0xFF88 -> -0.120 A)", source="sheet notes/datasheet"),
    R(0x35, "REG35 VBUS ADC", width=2, scale=0.001, unit="V", notes="1 mV/LSB. Sheet 0x13A0 -> 5.024 V"),
    R(0x37, "REG37 VAC1 ADC", width=2, scale=0.001, unit="V", notes="1 mV/LSB. Sheet 0x13B0 -> 5.040 V"),
    R(0x39, "REG39 VAC2 ADC", width=2, scale=0.001, unit="V", notes="1 mV/LSB", source="datasheet"),
    R(0x3B, "REG3B VBAT ADC", width=2, scale=0.001, unit="V", notes="1 mV/LSB. Sheet 0x38D9 -> 14.553 V"),
    R(0x3D, "REG3D VSYS ADC", width=2, scale=0.001, unit="V", notes="1 mV/LSB. Sheet 0x3206 -> 12.806 V"),
    R(0x41, "REG41 TDIE ADC", width=2, signed=True, scale=0.5, unit="degC", precision=1,
      notes="0.5 degC/LSB signed. Sheet 0x0026 -> 19.0 degC"),
    R(0x48, "REG48 Part Information",
      notes="0x19: PN[5:3]=3 (BQ25798), DEV_REV[2:0]=1",
      bitfields=[dict(name="PN", bits=[5, 3]), dict(name="DEV_REV", bits=[2, 0])]),
]

# INA226 (datasheet): 16-bit big-endian. Current/Power depend on CALIBRATION; defaults assume
# current_LSB = 1 mA (edit scale if your calibration differs).
INA_REGS = [
    R(0x00, "Configuration", access="RW", width=2, source="datasheet", notes="Default 0x4127"),
    R(0x01, "Shunt Voltage", width=2, signed=True, scale=2.5e-6, unit="V", precision=6,
      source="datasheet", notes="2.5 uV/LSB signed"),
    R(0x02, "Bus Voltage", width=2, scale=0.00125, unit="V", precision=4, source="datasheet",
      notes="1.25 mV/LSB"),
    R(0x03, "Power", width=2, scale=0.025, unit="W", source="datasheet",
      notes="25 x current_LSB per LSB (assumes current_LSB = 1 mA)"),
    R(0x04, "Current", width=2, signed=True, scale=0.001, unit="A", source="datasheet",
      notes="current_LSB (assumes 1 mA; set by CALIBRATION)"),
    R(0x05, "Calibration", access="RW", width=2, source="datasheet",
      notes="CAL = 0.00512 / (current_LSB * R_shunt)"),
    R(0x06, "Mask/Enable", access="RW", width=2, source="datasheet"),
    R(0x07, "Alert Limit", access="RW", width=2, source="datasheet"),
    R(0xFE, "Manufacturer ID", width=2, source="datasheet", notes="0x5449 'TI'"),
    R(0xFF, "Die ID", width=2, source="datasheet", notes="0x2260"),
]

DEFAULT_DEVICES = [
    dict(name="BMS (BQ76942)", addr="0x08", registers=BMS_REGS,
         notes="Repo maps BMS=0x08 (user note said 0x6B). Editable."),
    dict(name="MPPT Switch (BQ25798)", addr="0x6B", registers=SW_REGS,
         notes="Repo maps MPPT=0x6B (user note said 0x08). Editable."),
    dict(name="INA226", addr="0x40", registers=INA_REGS, notes=""),
]


def default_devices():
    return copy.deepcopy(DEFAULT_DEVICES)
