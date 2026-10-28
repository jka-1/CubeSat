export function parseRegisterAddress(input) {
  const text = String(input ?? '').trim();
  if (!/^0x[0-9a-f]{1,2}$/i.test(text)) throw new Error('Register address must be hexadecimal from 0x00 to 0xFF.');
  return `0x${Number.parseInt(text.slice(2), 16).toString(16).toUpperCase().padStart(2, '0')}`;
}

export function findRegister(map, deviceAddress, registerAddress) {
  return map.devices.find((device) => device.addr.toUpperCase() === deviceAddress.toUpperCase())
    ?.registers.find((register) => register.addr.toUpperCase() === registerAddress.toUpperCase()) || null;
}

export function validateRegisterWrite(map, deviceAddress, registerAddress, data) {
  const register = findRegister(map, deviceAddress, registerAddress);
  if (!register || !String(register.access).includes('W')) {
    throw new Error(`Register ${registerAddress} on ${deviceAddress} is not approved for writing.`);
  }
  if (data.length !== Number(register.width)) {
    throw new Error(`Register ${registerAddress} requires exactly ${register.width} byte(s).`);
  }
  if (deviceAddress.toUpperCase() === '0X6B' && registerAddress.toUpperCase() === '0X14' &&
      (Number(data[0]) & 0x40) !== 0) {
    throw new Error('BQ25798 register 0x14 bit 6 is reserved and must be 0.');
  }
  return register;
}

export function commandErrorDetail(error) {
  const text = String(error || '').trim();
  if (/^ESP_(?:ERR_[A-Z0-9_]+|FAIL|OK)$/.test(text) ||
      /^(?:An operator account is required|A valid command token is required|Sign in to continue|Session expired or invalid|Session verification failed)/.test(text) ||
      /^(?:Register 0x[0-9A-F]{2}|BQ25798 register 0x14|addr |reg |data\[\d+\] |i2c_write data)/i.test(text)) {
    return text.slice(0, 160);
  }
  return 'The bridge or device rejected this command. Check the register, value, and connection.';
}

export function registerWriteFeedback(result) {
  if (result?.status === 'pending') return 'Accepted by bridge; awaiting ESP32 response.';
  if (result?.status === 'completed' && result.result?.ok === true) {
    return 'ESP32 acknowledged the I²C write transaction. Register value was not read back.';
  }
  if (result?.status === 'timed_out') return 'Timed out waiting for an ESP32 response; write outcome is unknown.';
  if (result?.status === 'failed') return `ESP32 rejected the write: ${commandErrorDetail(result.result?.error || result.error)}`;
  return `Write not confirmed: ${commandErrorDetail(result?.error)}`;
}
