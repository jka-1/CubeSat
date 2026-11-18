import { StreamingModel, SERIES, decodeDevices } from './streaming-telemetry.mjs?v=20261109b';

export const METRICS = [
  ['pv.powerW','Solar power','W',3,'INA226','0x03'],['pv.busV','Bus voltage','V',3,'INA226','0x02'],
  ['pv.currentA','PV current','A',3,'INA226','0x04'],['pv.shuntMv','Shunt voltage','mV',3,'INA226','0x01'],
  ['bms.packV','Pack voltage','V',3,'BQ76942','0x36'],['bms.intTempC','BMS internal temperature','°C',1,'BQ76942','0x68'],
  ...[0,1,2,3].map(i=>[`bms.cell${i}`,`Cell ${i+1} voltage`,'V',3,'BQ76942',['0x14','0x16','0x18','0x1A'][i]]),
  ['bms.deltaMv','Cell spread','mV',0,'BQ76942','derived'],
  ['mppt.ibusMa','Charger bus current','mA',0,'BQ25798','0x31'],['mppt.vbusV','Charger VBUS','V',3,'BQ25798','0x35'],
  ['mppt.vac1V','Charger VAC1','V',3,'BQ25798','0x37'],['mppt.vbatV','Charger VBAT','V',3,'BQ25798','0x3B'],
  ['mppt.vsysV','Charger VSYS','V',3,'BQ25798','0x3D'],['mppt.dieTempC','Charger die temperature','°C',1,'BQ25798','0x41'],
  ['mppt.faults','Active charger faults','',0,'BQ25798','0x20'],['per.tempC','Peripheral temperature','°C',1,'MCP9700','ADC1'],
  ['per.tempMv','Temperature sensor output','mV',0,'MCP9700','ADC1'],['per.lightMv','Light sensor output','mV',0,'TEMT6000','ADC1']
].map(([key,label,unit,digits,device,register])=>({key,label,unit,digits,device,register}));

export function flattenFields(value, prefix='', out=[]) {
  if(value && typeof value==='object') {
    for(const [key,item] of Object.entries(value))flattenFields(item,prefix?`${prefix}.${key}`:key,out);
    if(!Object.keys(value).length)out.push([prefix,Array.isArray(value)?'[]':'{}']);
  } else out.push([prefix,value]);
  return out;
}

// Presentation-only history. This model never talks to the recorder or command API.
export class TelemetryOverviewModel {
  constructor(){this.mode=null;this.stream=new StreamingModel();this.raw=null;this.metadata=null;this.mockSequence=0;this.extra=new Map();this.metrics=[...METRICS];}
  reset(mode){this.mode=mode;this.stream.reset();this.raw=null;this.extra.clear();this.metrics=[...METRICS];}
  ingest(telemetry, metadata, mode, envelope, now=Date.now()) {
    if(this.mode!==mode)this.reset(mode);
    this.metadata=metadata;
    if(!envelope && !flattenFields(telemetry).some(([,v])=>typeof v==='number'&&Number.isFinite(v)))return false;
    const packet=envelope?.packet||{telemetry,device_id:metadata?.deviceId,seq:++this.mockSequence,packet_format:mode==='mock'?'local mock telemetry':'engineering telemetry'};
    const event=envelope?.packet?envelope:{type:'telemetry',received_at:new Date(now).toISOString(),packet};
    this.raw=event;
    if(!this.stream.ingest(event,now))return false;
    const time=this.stream.lastReceivedAt;
    const numeric=flattenFields(packet.telemetry).filter(([,v])=>typeof v==='number'&&Number.isFinite(v));
    const standardPaths=new Set(['pv.powerW','pv.busVoltageV','pv.currentA','pv.shuntVoltageMv','bms.packVoltageV','bms.internalTempC','mppt.ibusA','mppt.vbusV','mppt.vac1V','mppt.vbatV','mppt.vsysV','mppt.dieTempC','peripheral.temperatureC','peripheral.temperatureVoltageMv','peripheral.lightVoltageMv',...[0,1,2,3].map(i=>`bms.cellVoltagesV.${i}`)]);
    const values=new Map(numeric);
    for(const [path] of numeric)if(!standardPaths.has(path)&&!this.extra.has(path)){
      const group=path.split('.')[0];
      this.extra.set(path,[]);this.metrics.push({key:`extra:${path}`,label:path,unit:'',digits:3,device:group,register:'packet'});
    }
    for(const [path,points] of this.extra){
      const device=path.split('.')[0],available=this.stream.visibility[device]?.visible!==false;
      points.push([time,available?(values.get(path)??null):null]);
      while(points.length&&(points[0][0]<time-3600000||points.length>10000))points.shift();
    }
    return true;
  }
  series(key,windowMs,now=Date.now()) {
    if(key.startsWith('extra:')){const end=this.stream.serverNow(now),start=end-windowMs;return{start,end,points:(this.extra.get(key.slice(6))||[]).filter(p=>p[0]>=start)};}
    return this.stream.seriesWindow(key,windowMs,now);
  }
  value(key){
    if(!this.stream.decoded)return null;
    if(key.startsWith('extra:')){const points=this.extra.get(key.slice(6));return points?.at(-1)?.[1]??null;}
    const device=key.split('.')[0];
    if(this.stream.visibility[device]?.visible===false)return null;
    return SERIES[key]?.(this.stream.decoded)??null;
  }
  devices(){return this.stream.decoded||decodeDevices({});}
}
