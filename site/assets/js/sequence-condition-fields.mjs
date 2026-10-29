import { MPPT_FAULT_BITS } from './streaming-telemetry.mjs';
import { READABLE_REGISTERS } from './sequence-register-catalog.mjs';

// Preserve existing telemetry-backed IDs in saved definitions.
export const CONDITION_REGISTERS = Object.freeze([
  { id: 'pv.shunt', label: 'PV / INA226 · 0x01 shunt', group: 'pv', path: ['pv', 'shunt'] },
  { id: 'pv.bus', label: 'PV / INA226 · 0x02 bus', group: 'pv', path: ['pv', 'bus'] },
  { id: 'pv.power', label: 'PV / INA226 · 0x03 power', group: 'pv', path: ['pv', 'power'] },
  { id: 'pv.current', label: 'PV / INA226 · 0x04 current', group: 'pv', path: ['pv', 'current'] },
  { id: 'pv.calibration', label: 'PV / INA226 · 0x05 calibration', group: 'pv', path: ['pv', 'calibration'] },
  { id: 'mppt.reg13', label: 'MPPT / BQ25798 · 0x13 ACDRV', group: 'mppt', path: ['mppt', 'reg13'] },
  { id: 'mppt.fault20', label: 'MPPT / BQ25798 · 0x20 faults', group: 'mppt', path: ['mppt', 'fault20'] },
  ...READABLE_REGISTERS
]);
export const CONDITION_FAULTS = MPPT_FAULT_BITS;
export const DEVICE_LABELS = Object.freeze({ '0x08': 'BMS / BQ76942 (0x08)', '0x40': 'PV / INA226 (0x40)', '0x6B': 'MPPT / BQ25798 (0x6B)' });
