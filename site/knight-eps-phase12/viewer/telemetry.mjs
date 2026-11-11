/** Decoded engineering units only; unavailable channels stay absent. */
export const telemetryFields=Object.freeze({
 battery_voltage_v:{label:'Battery pack',short:'BATTERY',unit:'V',precision:3},
 pv_current_a:{label:'PV current · INA226',short:'PV CURRENT',unit:'A',precision:3},
 pv_bus_voltage_v:{label:'PV bus voltage',unit:'V',precision:3},
 pv_power_w:{label:'PV power',unit:'W',precision:3},
 pv_shunt_voltage_mv:{label:'PV shunt voltage',unit:'mV',precision:3},
 solar_panel_current_a:{label:'Solar panel current',unit:'A',precision:3},
 esp32_temperature_c:{label:'MCU temperature',short:'MCU TEMP',unit:'°C',precision:1},
 mppt_switch_temperature_c:{label:'MPPT die temperature',short:'MPPT TEMP',unit:'°C',precision:1},
 mppt_vbus_v:{label:'VBUS · 0x35',unit:'V',precision:3},
 mppt_vac1_v:{label:'VAC1 · 0x37',unit:'V',precision:3},
 mppt_vbat_v:{label:'VBAT · 0x3B',unit:'V',precision:3},
 mppt_vsys_v:{label:'VSYS · 0x3D',unit:'V',precision:3},
 mppt_ibus_a:{label:'IBUS · 0x31',unit:'mA',precision:0,scale:1000},
 bms_temperature_c:{label:'BMS internal temperature',unit:'°C',precision:1},
 bms_cell_1_v:{label:'Cell 1',unit:'V',precision:3},
 bms_cell_2_v:{label:'Cell 2',unit:'V',precision:3},
 bms_cell_3_v:{label:'Cell 3',unit:'V',precision:3},
 bms_cell_4_v:{label:'Cell 4',unit:'V',precision:3},
 temperature_c:{label:'Ambient temperature',short:'AMBIENT',unit:'°C',precision:1},
 light_level:{label:'Relative light',short:'LIGHT LEVEL',unit:'',precision:2},
 light_voltage_mv:{label:'Light sensor output',unit:'mV',precision:0},
 temperature_voltage_mv:{label:'Temperature sensor output',unit:'mV',precision:0},
 wifi_rssi_dbm:{label:'Device Wi-Fi RSSI',unit:'dBm',precision:0}
});
export const numericFields=Object.keys(telemetryFields);
export const overviewFields=['battery_voltage_v','pv_current_a','temperature_c','light_level','esp32_temperature_c','mppt_switch_temperature_c'];
export function formatReading(key,value,{missing='—'}={}){
 const field=telemetryFields[key];if(typeof value!=='number'||!Number.isFinite(value))return missing;
 return (value*(field?.scale||1)).toFixed(field?.precision??2)+(field?.unit?' '+field.unit:'');
}
export function normalizeTelemetry(input,{allowEmpty=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Expected a decoded telemetry object');
 const out={};
 for(const key of numericFields){const value=input[key];if(value==null)continue;if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${key} must be a finite number or unavailable`);out[key]=value}
 if(input.status!=null){if(typeof input.status!=='string')throw new TypeError('status must be text');out.status=input.status.slice(0,64)}
 if(!allowEmpty&&!numericFields.some(k=>k in out))throw new TypeError('Packet contains no supported measurements');
 return out;
}
export function telemetryHealth({last,receivedAt,source,transport,error,now=Date.now(),staleMs=15000}){
 const ageMs=receivedAt!==null&&receivedAt!==undefined?Math.max(0,now-receivedAt):null;
 const stale=!!last&&ageMs>=staleMs;
 let health,label;
 if(error){health='error';label=error}
 else if(transport==='disconnected'){health='disconnected';label='Disconnected'}
 else if(stale){health='stale';label=source==='mock'?'Mock data · stale':'Stale data'}
 else if(last){health=source==='mock'?'mock':'fresh';label=source==='mock'?'Mock demonstration':'Live data'}
 else if(transport==='connecting'){health='connecting';label='Connecting · waiting for first packet'}
 else {health='waiting';label='Waiting for first packet'}
 return {health,label,ageMs,telemetry:!last?'no_data':stale?'stale':'received'};
}

export function wifiIndicator(state){
 const rssi=state.readings?.wifi_rssi_dbm,reported=typeof rssi==='number'&&Number.isFinite(rssi);
 const live=state.source==='live'&&state.health==='fresh'&&['connected','dashboard'].includes(state.transport);
 const levels=!live||!reported?0:rssi>=-55?3:rssi>=-70?2:1;
 return {levels,reported,active:live&&reported,label:state.source==='mock'?'MOCK':reported?`Wi-Fi ${rssi.toFixed(0)} dBm`:state.health==='fresh'?'DATA LINK':'NO LINK'};
}
