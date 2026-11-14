import catalogue from '../data/explore-berlin.json' with {type:'json'};

const WIKI='https://en.wikipedia.org/w/api.php';
const cache=new Map(),pending=new Map();
const recordMap=new Map(catalogue.places.map(p=>[p.id,p]));
const ids=new Map(catalogue.places.map(p=>[String(p.pageId),p]));
const clean=(v,max=12000)=>String(v??'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max);
const rad=Math.PI/180;
export const exploreDistance=(lat1,lon1,lat2,lon2)=>{const a=Math.sin((lat2-lat1)*rad/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon1)*rad/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));};
const station=p=>/station|bahnhof|U-Bahn/i.test(p.title);
const decorate=p=>({...p,subtype:station(p)?'Station history':({history:'Historic Berlin',architecture:'Architecture & engineering',geography:'Geographic feature',culture:'Culture & public art',memorials:'Memorial & remembrance',parks:'Park & landscape'}[p.category]),sourceId:'berlin-explore',isReference:true,locationPrecision:'reference',contentCapturedAt:catalogue.generatedAt});
function validArea({lat,lon,radius=5}={}){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180||!Number.isFinite(radius)||radius<.25||radius>30)throw new RangeError('Valid coordinates and a radius from 0.25 to 30 km are required');
 return {lat,lon,radius};
}
/** Public reference content. The curated catalogue is available without a live provider request. */
export async function getExplore(input={}){
 const {lat,lon,radius}=validArea(input);
 const places=catalogue.places.filter(p=>exploreDistance(lat,lon,p.lat,p.lon)<=radius).map(p=>{const {extract,...brief}=decorate(p);return {...brief,distance:exploreDistance(lat,lon,p.lat,p.lon)};}).sort((a,b)=>a.distance-b.distance);
 return {places,sources:[{id:'berlin-explore',name:'Berlin history & landscape atlas',status:'connected',count:places.length,updatedAt:catalogue.generatedAt,url:catalogue.sourceUrl,license:catalogue.license,note:`${catalogue.places.length} curated, sourced reference places across Berlin. Extracts captured ${catalogue.generatedAt.slice(0,10)}; these are historic/geographic context, not live activity. ${catalogue.note}`}],catalogue:{count:catalogue.places.length,capturedAt:catalogue.generatedAt,license:catalogue.license}};
}
async function json(url,timeout=7500){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json','User-Agent':'AroundMe/2.0'}});if(!r.ok)throw new Error('Reference provider is temporarily unavailable');const text=await r.text();if(text.length>2500000)throw new Error('Reference response exceeded its limit');return JSON.parse(text);}finally{clearTimeout(timer);}
}
async function memo(key,fn){
 const hit=cache.get(key);if(hit&&Date.now()<hit.until)return hit.value;
 if(pending.has(key))return pending.get(key);
 const task=fn().then(value=>{if(cache.size>=150)cache.delete(cache.keys().next().value);cache.set(key,{until:Date.now()+(value?.status==='unavailable'?15000:3600000),value});return value;}).finally(()=>pending.delete(key));pending.set(key,task);return task;
}
const pageUrl=p=>`https://en.wikipedia.org/?curid=${encodeURIComponent(p.pageid)}`;
function parsedPage(p,matchType='article'){
 if(!p||p.missing||!Number.isSafeInteger(p.pageid)||p.pageprops?.disambiguation!==undefined||!clean(p.extract))return null;
 const coordinate=p.coordinates?.find(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon));
 return {title:clean(p.title,300),extract:clean(p.extract,9000),source:'Wikipedia contributors',sourceUrl:p.fullurl||pageUrl(p),license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',pageId:p.pageid,wikiTitle:clean(p.title,300),lat:coordinate?.lat,lon:coordinate?.lon,matchType,isReference:true,updatedAt:null,contentCapturedAt:new Date().toISOString(),facts:[{label:'Reference source',value:'Wikipedia contributors'},{label:'Content license',value:'CC BY-SA 4.0'}]};
}
const requestPages=async params=>{
 const data=await json(WIKI+'?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',redirects:'1',prop:'extracts|info|coordinates|pageprops',inprop:'url',exintro:'1',explaintext:'1',exlimit:'max',coprimary:'primary',colimit:'max',...params}));
 if(!Array.isArray(data.query?.pages))throw new Error('Reference provider returned an invalid response');return data.query.pages;
};
function canonicalStationTitle(title){
 return clean(title,180).replace(/^(?:S\+U|S\/U|S U|U|S)\s+(?=[A-ZÄÖÜ])/,'').replace(/\s*\((?:Berlin|Bln)\)\s*$/,'').replace(/\s*Bhf\.?\s*$/i,'').trim();
}
/** Returns source text, never a fabricated biography when a provider fails. */
export async function getPlaceDetails({id,pageId,title,lat,lon}={}){
 if(id!==undefined&&(typeof id!=='string'||id.length>180))throw new RangeError('Invalid reference id');
 if(pageId!==undefined&&!/^\d{1,12}$/.test(String(pageId)))throw new RangeError('Invalid Wikipedia page id');
 if(title!==undefined&&(typeof title!=='string'||title.trim().length<1||title.length>200||/[|\u0000-\u001f]/.test(title)))throw new RangeError('Invalid reference title');
 if((lat!==undefined||lon!==undefined)&&(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180))throw new RangeError('Invalid reference coordinates');
 if(!pageId&&typeof id==='string'&&/^wiki-\d{1,12}$/.test(id))pageId=id.slice(5);
 const known=recordMap.get(id)||ids.get(String(pageId))||catalogue.places.find(p=>p.wikiTitle.toLowerCase()===String(title||'').toLowerCase());
 if(known){const p=decorate(known);return {...p,extract:p.extract,licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',matchType:'curated',facts:[{label:'Layer',value:p.subtype},{label:'Text captured',value:catalogue.generatedAt.slice(0,10)},{label:'Reference source',value:'Wikipedia contributors'}]};}
 if(!pageId&&!title)throw new RangeError('Choose a reference id, page id or title');
 return memo('detail:'+JSON.stringify({pageId,title,lat,lon}),async()=>{
  try{
   let pages=await requestPages(pageId?{pageids:String(pageId)}:{titles:title});
   let result=pages.map(p=>parsedPage(p,pageId?'page-id':'title')).find(Boolean);
   if(result)return result;
   if(title){
    const base=canonicalStationTitle(title);
    const variants=[base,`${base} (Berlin U-Bahn)`,`Berlin ${base} station`,`${base} station`].filter((v,i,a)=>v!==title&&a.indexOf(v)===i);
    pages=await requestPages({titles:variants.join('|')});
    // Exact standardized station variants only: a full-text search could misidentify a similarly named place.
    result=pages.map(p=>parsedPage(p,'station-title')).find(Boolean);
    if(result)return result;
   }
   if(Number.isFinite(lat)&&Number.isFinite(lon)){
    const nearby=await json(WIKI+'?'+new URLSearchParams({action:'query',format:'json',formatversion:'2',list:'geosearch',gscoord:`${lat}|${lon}`,gsradius:'250',gslimit:'5'}));
    const candidates=nearby.query?.geosearch;
    if(Array.isArray(candidates)&&candidates.length){
     pages=await requestPages({pageids:candidates.filter(x=>Number.isSafeInteger(x.pageid)).map(x=>x.pageid).slice(0,3).join('|')});
     const byId=new Map(pages.map(p=>[p.pageid,p]));
     result=candidates.map(c=>parsedPage(byId.get(c.pageid),'nearby')).find(Boolean);
     if(result)return {...result,note:'This is a nearby reference article. It is not a verified history of the selected station or place.'};
    }
   }
   return {title:clean(title||'Reference place',200),extract:null,source:'Wikipedia',sourceUrl:'https://en.wikipedia.org/',license:'CC BY-SA 4.0',status:'not-found',note:'No matching reference article was found. No historical account has been generated.'};
  }catch{return {title:clean(title||'Reference place',200),extract:null,source:'Wikipedia',sourceUrl:'https://en.wikipedia.org/',license:'CC BY-SA 4.0',status:'unavailable',note:'The reference provider could not be reached. No historical account has been generated.'};}
 });
}
export const exploreMetadata={count:catalogue.places.length,generatedAt:catalogue.generatedAt,license:catalogue.license};
