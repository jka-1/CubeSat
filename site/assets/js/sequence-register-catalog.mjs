// Supported I²C reads for both register blocks and condition operands.
const groups = [
  ['0x08', 'bms', 'BMS / BQ76942', '', '14 16 18 1A 36 3A 68 3E', 'little'],
  ['0x6B', 'mppt', 'MPPT / BQ25798', '0F 10 12 13 14 1B 1C 1E 2E 30 48', '31 33 35 37 39 3B 3D 41', 'big'],
  ['0x40', 'pv', 'PV / INA226', '', '00 01 02 03 04 05 06 07 FE FF', 'big']
];

export const READABLE_REGISTERS = Object.freeze(groups.flatMap(([addr, group, device, one, two, endian]) => [
  ...one.split(' ').filter(Boolean).map((reg) => ({ addr, group, device, reg: `0x${reg}`, len: 1, endian })),
  ...two.split(' ').filter(Boolean).map((reg) => ({ addr, group, device, reg: `0x${reg}`, len: 2, endian }))
].map((item) => Object.freeze({ ...item, id: `${item.addr}:${item.reg}`, label: `${item.device} · ${item.reg}` }))));
