import {twoline2satrec,propagate,gstime,eciToEcf,ecfToLookAngles} from 'satellite.js';
/** Geometric horizon passes only; daylight, shadow and cloud visibility are not inferred. */
export function satellitePasses(item,observer,{start=new Date(),hours=24}={}) {
  if(!/^1 /.test(item?.tle1||'')||!/^2 /.test(item?.tle2||'')||!Number.isFinite(observer.lat)||!Number.isFinite(observer.lon)||Math.abs(observer.lat)>85||Math.abs(observer.lon)>180||!Number.isFinite(hours)||hours<1||hours>48)throw new Error('A current TLE and valid observation location are required.');
  const record=twoline2satrec(item.tle1,item.tle2),point={latitude:observer.lat*Math.PI/180,longitude:observer.lon*Math.PI/180,height:0};
  const passes=[];let active=null;
  for(let minute=0;minute<=hours*60;minute++){
    const time=new Date(start.getTime()+minute*60000),p=propagate(record,time);
    if(!p.position)continue;
    const elevation=ecfToLookAngles(point,eciToEcf(p.position,gstime(time))).elevation*180/Math.PI;
    if(elevation>=10){if(!active)active={rise:time.toISOString(),peak:time.toISOString(),maxElevation:elevation,inProgress:minute===0};if(elevation>active.maxElevation){active.maxElevation=elevation;active.peak=time.toISOString();}}
    else if(active){passes.push({...active,set:time.toISOString()});active=null;}
  }
  if(active)passes.push({...active,set:null});
  return passes.slice(0,16);
}
