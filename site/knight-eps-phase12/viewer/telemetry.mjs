/** The existing flat decoded-packet contract. No ADC conversion or inferred sensors. */
export const numericFields=['battery_voltage_v','solar_panel_current_a','esp32_temperature_c','mppt_switch_temperature_c','temperature_c','light_level'];
export function normalizeTelemetry(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Expected a decoded telemetry object');
 const out={};
 for(const key of numericFields){const value=input[key];if(value==null)continue;if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${key} must be a finite number or unavailable`);out[key]=value}
 if(input.status!=null){if(typeof input.status!=='string')throw new TypeError('status must be text');out.status=input.status.slice(0,64)}
 if(!numericFields.some(k=>k in out))throw new TypeError('Packet contains no supported measurements');
 return out;
}
export function telemetryHealth({last,receivedAt,source,transport,error,now=Date.now(),staleMs=15000}){
 const ageMs=receivedAt?Math.max(0,now-receivedAt):null;
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
