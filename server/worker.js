import {assets} from '../.build/assets.js';
import {getOverview} from './data.js';
import {getTransport} from './transport.js';
import {getExplore,getPlaceDetails} from './explore.js';
import {getOverlays} from './overlays.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const searchLabel=(p={})=>{p=p||{};const text=v=>typeof v==='string'?v.trim():'';const street=[text(p.street),text(p.housenumber)].filter(Boolean).join(' '),locality=[text(p.postcode),text(p.city||p.town||p.village)].filter(Boolean).join(' ');return [...new Set([text(p.name),street,locality,text(p.country)].filter(Boolean))].join(', ').slice(0,400);};
const coordinate=(value,fallback)=>value===null?fallback:value.trim()===''?NaN:Number(value);
export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 try{
  if(u.pathname==='/api/health')return json({status:'ready',version:'2.1.0'});
  if(u.pathname==='/api/overlays'){
   const lat=coordinate(u.searchParams.get('lat'),NaN),lon=coordinate(u.searchParams.get('lon'),NaN),radius=coordinate(u.searchParams.get('radius'),5),kind=u.searchParams.get('kind');
   if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>80||Math.abs(lon)>180||!Number.isFinite(radius)||radius<1||radius>20||!['radar','weather','aircraft'].includes(kind))return json({error:'Choose valid overlay coordinates and type.'},400);
   return json(await getOverlays({lat,lon,radius,kind}));
  }
  if(['/api/transport','/api/explore'].includes(u.pathname)){
   const lat=coordinate(u.searchParams.get('lat'),NaN),lon=coordinate(u.searchParams.get('lon'),NaN),radius=coordinate(u.searchParams.get('radius'),5);
   if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180||!Number.isFinite(radius)||radius<1||radius>20)return json({error:'Choose valid coordinates and a radius between 1 and 20 km.'},400);
   return json(await (u.pathname==='/api/transport'?getTransport({lat,lon,radius}):getExplore({lat,lon,radius})));
  }
  if(u.pathname==='/api/place'){
   const id=(u.searchParams.get('id')||'').slice(0,160),title=(u.searchParams.get('title')||'').trim(),rawPage=u.searchParams.get('pageId'),pageId=rawPage===null?undefined:Number(rawPage),lat=coordinate(u.searchParams.get('lat'),NaN),lon=coordinate(u.searchParams.get('lon'),NaN);
   if(title.length>200||/[|\u0000-\u001f]/.test(title)||(!id&&!title&&!pageId)||pageId!==undefined&&(!Number.isSafeInteger(pageId)||pageId<=0)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)return json({error:'Choose a valid place.'},400);
   return json(await getPlaceDetails({id,title:title||undefined,pageId,lat,lon}));
  }
  if(u.pathname==='/api/overview'){
   const lat=coordinate(u.searchParams.get('lat'),NaN),lon=coordinate(u.searchParams.get('lon'),NaN),radius=coordinate(u.searchParams.get('radius'),5),city=u.searchParams.get('city')||'berlin';
   if(!u.searchParams.has('lat')||!u.searchParams.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180||!Number.isFinite(radius)||radius<1||radius>20||!['berlin','seattle','newyork'].includes(city))return json({error:'Choose a valid map location and a radius between 1 and 20 km.'},400);
   return json(await getOverview({lat,lon,radius,city}));
  }
  if(u.pathname==='/api/search'){
   const q=(u.searchParams.get('q')||'').trim();
   if(q.length<3||q.length>160)return json({error:'Enter between 3 and 160 characters.'},400);
   const lat=coordinate(u.searchParams.get('lat'),52.52),lon=coordinate(u.searchParams.get('lon'),13.405);
   if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)return json({error:'Invalid search location'},400);
   const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q,limit:'5',lat:String(lat),lon:String(lon),lang:'en'});
   const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
   if(!r.ok)return json({error:'Place search is temporarily unavailable. Select an area on the map.'},503);
   const d=await r.json();if(!Array.isArray(d.features))return json({error:'Place search returned an invalid response. Select an area on the map.'},503);
   return json({results:d.features.slice(0,5).filter(f=>f?.geometry?.type==='Point').map(f=>({lon:f.geometry.coordinates?.[0],lat:f.geometry.coordinates?.[1],label:searchLabel(f.properties),zoom:['city','town','village','state','country'].includes(f.properties?.osm_value)?12.5:f.properties?.osm_value==='street'?16:17.2})).filter(f=>Number.isFinite(f.lat)&&Number.isFinite(f.lon)&&Math.abs(f.lat)<=85&&Math.abs(f.lon)<=180&&f.label)});
  }
  const a=assets[u.pathname];if(!a)return new Response('Not found',{status:404});
  return new Response(a.body,{headers:{'Content-Type':a.type,'Cache-Control':u.pathname==='/'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'geolocation=(self), camera=(), microphone=()','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://*.openfreemap.org https://*.cartocdn.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.openfreemap.org https://*.cartocdn.com https://server.arcgisonline.com https://tilecache.rainviewer.com; worker-src blob:; child-src blob:; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site; object-src 'none'; base-uri 'self'"}});
 }catch(e){return json({error:'This data request could not complete. Please try again.'},503);}
}};
