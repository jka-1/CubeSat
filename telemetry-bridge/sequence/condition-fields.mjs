// Streaming packet raw register words and MPPT fault bits. Match server.js packet decoding.
export const CONDITION_REGISTERS = Object.freeze([
  { id: 'pv.shunt', group: 'pv', path: ['pv', 'shunt'] },
  { id: 'pv.bus', group: 'pv', path: ['pv', 'bus'] },
  { id: 'pv.power', group: 'pv', path: ['pv', 'power'] },
  { id: 'pv.current', group: 'pv', path: ['pv', 'current'] },
  { id: 'pv.calibration', group: 'pv', path: ['pv', 'calibration'] },
  { id: 'mppt.reg13', group: 'mppt', path: ['mppt', 'reg13'] },
  { id: 'mppt.fault20', group: 'mppt', path: ['mppt', 'fault20'] }
]);
export const CONDITION_FAULTS = Object.freeze(['VAC1_OVP_STAT', 'VAC2_OVP_STAT', 'CONV_OCP_STAT', 'BAT_OCP_STAT',
  'IBUS_OCP_STAT', 'VBAT_OVP_STAT', 'VBUS_OVP_STAT', 'BAT_REG_STAT']);
