const fc = features => ({type: 'FeatureCollection', features});
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
const validPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const row = (id, name, group, symbol, color, description, scope = 'nearby') => ({id, name, group, symbol, color, description, scope});
export const WORLD_LAYERS = [
 row('earthquakes','Earthquakes','Earth & space','◉','#f5a57d','USGS recent seismic events','global'),
 row('satellites','Satellites & orbits','Earth & space','◇','#c3b0ff','CelesTrak orbital elements and calculated positions','global'),
 row('launches','Space launches','Earth & space','↑','#ffce87','Published launch schedule and launch locations','global'),
 row('fires','Active fires & events','Earth & space','▲','#ff896d','NASA EONET published natural events','global'),
 row('cyclones','Cyclones','Earth & space','◎','#82d4ed','Official tropical cyclone advisories','global'),
 row('militaryFlights','Military aircraft broadcasts','Transport & signals','✈','#f2c28a','Publicly broadcast aircraft feed; availability varies','regional'),
 row('vessels','Vessels / AIS','Transport & signals','▰','#78cbd9','AIS provider credentials required for live ship positions','global'),
 row('bikeshare','Bikeshare','Transport & signals','○','#b1d87e','Citi Bike availability in NYC; mapped stations elsewhere'),
 row('rail','Rail','Transport & signals','R','#dabb86','Mapped railway infrastructure; Berlin network in layer library'),
 row('transit','Public transport','Transport & signals','T','#80b7eb','Mapped public transport; Berlin lines in layer library'),
 row('traffic','Traffic context','Transport & signals','≋','#e6c387','Mapped roads; live congestion needs a provider'),
 row('radio','Radio stations','Transport & signals','≈','#d3afe9','Radio Browser public station locations and streams','regional'),
 row('cameras','Public camera locations','Cameras & imagery','▣','#7cc9ce','Mapped camera metadata; a location is not a live video feed'),
 row('alpr','Mapped ALPR cameras','Cameras & imagery','▤','#d5b87a','OpenStreetMap licence-plate-reader camera locations'),
 row('streetlevel','Street-level imagery','Cameras & imagery','▧','#b5c8e3','Panoramax public photographs; optional imagery providers need keys'),
 row('datacenters','Datacenters','Infrastructure','▥','#a5d0e4','Publicly mapped data-centre locations'),
 row('dams','Dams','Infrastructure','▰','#8fcab6','OpenStreetMap dams and weirs'),
 row('installations','Mapped installations','Infrastructure','□','#d5b58a','Public OpenStreetMap installations; reference locations'),
 row('cables','Submarine cables','Infrastructure','⌁','#c3ace7','Mapped infrastructure and source coverage'),
 row('seaMarks','Sea marks','Infrastructure','⚑','#80c8d1','Publicly mapped navigational marks'),
 row('skiPistes','Ski pistes','Infrastructure','⌇','#b1d4ef','Mapped pistes and winter-sport routes'),
 row('shipwrecks','Shipwrecks','Infrastructure','×','#a8c3cc','Publicly mapped wreck locations'),
 row('airspaceRestricted','Restricted airspace','Infrastructure','△','#e6a98c','Published airspace reference coverage'),
 row('gnss','GNSS integrity','Weather & environment','⊕','#dbbc86','Integrity observations need an available dedicated feed'),
 row('firePerimeters','US fire perimeters','Weather & environment','△','#ff9c6f','Published wildfire perimeter geometry','global'),
 row('airquality','Air quality','Weather & environment','≈','#b3d295','Modeled air-quality readings around the scan centre'),
 row('clouds','Satellite clouds','Weather & environment','☁','#ccd8e4','Observed cloud imagery availability'),
 row('lightning','Lightning','Weather & environment','ϟ','#f6dc8e','Published lightning observations where available'),
 row('news','Mapped news','News & nature','▣','#dda6b0','Source-linked reports; mapped places may be approximate','regional'),
 row('wildlife','Wildlife observations','News & nature','✧','#9bd397','Public iNaturalist observations; obscured coordinates stay approximate')
];
const CATALOG = new Map(WORLD_LAYERS.map(x => [x.id, x]));
const STYLE_IDS = ['world-polygons', 'world-lines', 'world-points', 'world-labels'];
const SOURCE_IDS = ['world-areas', 'world-paths', 'world-contacts'];
function validGeometry(g) {
 if (!g || !['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(g.type)) return false;
 let count = 0;
 const walk = c => {
  if (!Array.isArray(c) || !c.length || ++count > 15000) return false;
  if (typeof c[0] === 'number') return c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
  return c.every(walk);
 };
 return walk(g.coordinates);
}
export function worldFeatures(data, enabled) {
 const points = [], lines = [], areas = [];
 for (const id of enabled) {
  const layer = CATALOG.get(id), d = data[id]; if (!layer || !d) continue;
  for (const item of Array.isArray(d.items) ? d.items.slice(0, 1000) : []) {
   if (!validPoint(item) || points.length >= 2000) continue;
   points.push({type:'Feature',geometry:{type:'Point',coordinates:[item.lon,item.lat]},properties:{id:`${id}:${item.id}`,kind:id,title:String(item.title||layer.name).slice(0,200),symbol:layer.symbol,color:layer.color}});
  }
  for (const feature of Array.isArray(d.features?.features) ? d.features.features.slice(0,200) : []) {
   if (!validGeometry(feature?.geometry)) continue;
   const f={type:'Feature',geometry:feature.geometry,properties:{id:`${id}:${feature.properties?.id||''}`,kind:id,color:layer.color,title:String(feature.properties?.title||layer.name).slice(0,200)}};
   if (/LineString/.test(f.geometry.type)) lines.push(f); else if (/Polygon/.test(f.geometry.type)) areas.push(f);
  }
 }
 return {points:fc(points),lines:fc(lines),areas:fc(areas)};
}

export class WorldIntelligence {
 constructor({map,onFly=()=>{},onDetail=()=>{},onMessage=()=>{},getArea=()=>({lat:52.52,lon:13.405,radius:5})}={}) {
  Object.assign(this,{onFly,onDetail,onMessage,getArea});this.enabled=new Set();this.data={};this.status={};this.controllers=new Map();this.revision=0;this.destroyed=false;this.query='';this.global=false;this.areaKey='';
  this._click=e=>{const p=e.features?.[0]?.properties;if(!p)return;const item=this.getItems().find(x=>`${x.worldKind}:${x.id}`===p.id);if(item)this.onDetail(item);};
  this._enter=()=>{if(this.map)this.map.getCanvas().style.cursor='pointer';};this._leave=()=>{if(this.map)this.map.getCanvas().style.cursor='';};
  this._load=()=>this.initMap();
  this.timer=setInterval(()=>{if(typeof document==='undefined'||!document.hidden)this.refresh(false);},60000);
  this.timer.unref?.();if(map)this.attach(map);
 }
 mount(container) {
  this.container=container;
  container.innerHTML=`<section class="world-intelligence"><div class="world-heading"><div><span class="world-eyebrow">PUBLIC SIGNALS / WORLD VIEW</span><h2>World intelligence</h2></div><button data-world-refresh class="world-refresh" title="Refresh enabled sources" aria-label="Refresh enabled world sources">↻</button></div><p class="world-intro">Explore the original God’s Eye source families alongside your Berlin layers. Every feed keeps its own coverage and timestamp. <a href="https://github.com/shayanhaider-pdf/gods-eye-berlin/blob/main/docs/UPSTREAM-PARITY.md" target="_blank" rel="noopener noreferrer">Full original-feature comparison ↗</a></p><div class="world-scope" role="group" aria-label="Map scope"><button data-world-scope="nearby" class="active">Scan area</button><button data-world-scope="global">Whole Earth</button></div><div class="world-scope-note" role="status">Local sources use your scan area. Global sources can show records anywhere on Earth.</div><div class="world-actions"><label class="world-search"><span>⌕</span><input data-world-query placeholder="Find a source…" aria-label="Find a world source"></label><button data-world-off>Hide all</button></div><div class="world-catalog"></div><div class="world-selection" aria-live="polite"></div></section>`;
  container.querySelector('[data-world-refresh]').onclick=()=>this.refresh(true);
  container.querySelector('[data-world-off]').onclick=()=>this.setEnabled([]);
  container.querySelector('[data-world-query]').oninput=e=>{this.query=e.target.value;this.renderPanel();};
  container.querySelectorAll('[data-world-scope]').forEach(button=>button.onclick=()=>this.setScope(button.dataset.worldScope));
  container.querySelector('.world-catalog').onclick=e=>{const b=e.target.closest('[data-world-layer]');if(b)this.setLayer(b.dataset.worldLayer,!this.enabled.has(b.dataset.worldLayer));};
  container.querySelector('.world-selection').onclick=e=>{const b=e.target.closest('[data-world-contact]');if(!b)return;const item=this.getItems().find(x=>`${x.worldKind}:${x.id}`===b.dataset.worldContact);if(item){this.onFly(item);this.onDetail(item);}};
  this.renderPanel();return this;
 }
 attach(map) {
  if(this.destroyed||this.map===map&&this.ready)return this;
  this.map=map;
  if(map.isStyleLoaded?.())this.initMap();else map.on('load',this._load);
  return this;
 }
 initMap(){
  if(!this.map||this.destroyed||this.ready)return;
  this.ready=true;const map=this.map;
  for(const id of SOURCE_IDS)if(!map.getSource(id))map.addSource(id,{type:'geojson',data:fc([])});
  map.addLayer({id:'world-polygons',type:'fill',source:'world-areas',paint:{'fill-color':['get','color'],'fill-opacity':0.14}});
  map.addLayer({id:'world-lines',type:'line',source:'world-paths',paint:{'line-color':['get','color'],'line-width':2,'line-opacity':0.72}});
  map.addLayer({id:'world-points',type:'circle',source:'world-contacts',paint:{'circle-color':['get','color'],'circle-radius':['interpolate',['linear'],['zoom'],1,3,10,6,17,8],'circle-stroke-color':'#e9f1f7','circle-stroke-width':1,'circle-opacity':0.88}});
  map.addLayer({id:'world-labels',type:'symbol',source:'world-contacts',minzoom:5,layout:{'text-field':['concat',['get','symbol'],' ',['get','title']],'text-font':['Open Sans Regular'],'text-size':11,'text-offset':[0,1.2],'text-anchor':'top','text-max-width':18},paint:{'text-color':'#d8e7f1','text-halo-color':'#08121f','text-halo-width':1.5}});
  for(const id of ['world-points','world-labels']){map.on('click',id,this._click);map.on('mouseenter',id,this._enter);map.on('mouseleave',id,this._leave);}
  this.renderMap();
 }
 setScope(scope){
  this.global=scope==='global';
  this.container?.querySelectorAll('[data-world-scope]').forEach(b=>b.classList.toggle('active',(b.dataset.worldScope==='global')===this.global));
  if(this.map){this.map.stop?.();if(this.global){this.map.setProjection?.({type:'globe'});this.map.flyTo({zoom:1.8,pitch:0,duration:2000});}else{this.map.setProjection?.({type:'mercator'});const a=this.getArea();this.onFly({...a,zoom:13.5});}}
  const note=this.container?.querySelector('.world-scope-note');if(note)note.textContent=this.global?'Whole Earth: global feeds stay worldwide. Infrastructure and local observations still use the scan coordinates.':'Local sources use your scan area. Global sources can show records anywhere on Earth.';
 }
 getEnabled(){return [...this.enabled];}
 getItems(){return [...this.enabled].flatMap(id=>(Array.isArray(this.data[id]?.items)?this.data[id].items:[]).filter(validPoint).map(item=>({...item,worldKind:id,worldLayer:CATALOG.get(id)?.name}))).slice(0,3000);}
 async setLayer(id,enabled){
  if(!CATALOG.has(id)||this.destroyed)return;
  if(enabled)this.enabled.add(id);else{this.enabled.delete(id);this.controllers.get(id)?.abort();this.controllers.delete(id);}
  this.renderMap();this.renderPanel();if(enabled)await this.load(id);
 }
 async setEnabled(ids=[]){
  const next=new Set(Array.isArray(ids)?ids.filter(id=>CATALOG.has(id)):[]);
  for(const id of this.enabled)if(!next.has(id)){this.controllers.get(id)?.abort();this.controllers.delete(id);}
  this.enabled=next;this.renderMap();this.renderPanel();await Promise.allSettled([...next].map(id=>this.load(id)));
 }
 async updateArea(){
  const a=this.getArea(),key=`${a.lat}|${a.lon}|${a.radius}`;if(key===this.areaKey)return;
  this.areaKey=key;this.revision++;for(const c of this.controllers.values())c.abort();this.controllers.clear();this.data={};this.status={};this.renderMap();this.renderPanel();await this.refresh(true);
 }
 async refresh(force=true){if(this.destroyed)return;await Promise.allSettled([...this.enabled].map(id=>this.load(id,force)));}
 async load(id,force=false){
  if(!this.enabled.has(id)||this.destroyed||this.controllers.has(id))return;
  if(!force&&this.data[id]&&Date.now()-(this.status[id]?.loadedAt||0)<60000)return;
  const controller=new AbortController(),revision=this.revision;this.controllers.set(id,controller);this.status[id]={...this.status[id],state:'loading'};this.renderPanel();
  const a=this.getArea();
  try{
   const response=await fetch('/api/world?'+new URLSearchParams({kind:id,lat:a.lat,lon:a.lon,radius:a.radius}),{signal:controller.signal});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Source request failed');
   if(this.destroyed||revision!==this.revision||!this.enabled.has(id)||this.controllers.get(id)!==controller)return;
   this.data[id]={...data,items:Array.isArray(data.items)?data.items.slice(0,1000):[]};this.status[id]={...data.source,state:data.source?.status||'unavailable',loadedAt:Date.now()};this.renderMap();
  }catch(e){if(e.name!=='AbortError'&&!this.destroyed&&revision===this.revision&&this.controllers.get(id)===controller){this.status[id]={state:'unavailable',note:e.message,loadedAt:Date.now()};delete this.data[id];this.renderMap();}}
  finally{if(this.controllers.get(id)===controller)this.controllers.delete(id);this.renderPanel();}
 }
 renderMap(){if(!this.ready||this.destroyed)return;
  const cloud=this.data.clouds,show=this.enabled.has('clouds')&&Array.isArray(cloud?.tiles)&&cloud.tiles.length;
  if(show){const tiles=cloud.tiles.filter(t=>{try{return new URL(t).origin==='https://gibs.earthdata.nasa.gov';}catch{return false;}});if(tiles.length){if(!this.map.getSource('world-clouds')){this.map.addSource('world-clouds',{type:'raster',tiles,tileSize:256,maxzoom:9,attribution:'NASA GIBS / MODIS daily observed imagery'});this.map.addLayer({id:'world-clouds',type:'raster',source:'world-clouds',paint:{'raster-opacity':0.65}},'world-polygons');}else{this.map.getSource('world-clouds').setTiles?.(tiles);this.map.setLayoutProperty('world-clouds','visibility','visible');}}}else if(this.map.getLayer('world-clouds'))this.map.setLayoutProperty('world-clouds','visibility','none');
  const g=worldFeatures(this.data,this.enabled);this.map.getSource('world-contacts')?.setData(g.points);this.map.getSource('world-paths')?.setData(g.lines);this.map.getSource('world-areas')?.setData(g.areas);}
 renderPanel(){
  if(!this.container||this.destroyed)return;
  const q=this.query.toLowerCase().trim(),groups=[...new Set(WORLD_LAYERS.map(x=>x.group))];
  this.container.querySelector('.world-catalog').innerHTML=groups.map(group=>{const rows=WORLD_LAYERS.filter(l=>l.group===group&&(!q||`${l.name} ${l.description}`.toLowerCase().includes(q)));if(!rows.length)return '';return `<details class="world-group" open><summary>${escapeHTML(group)}<span>${rows.length}</span></summary>${rows.map(l=>{const on=this.enabled.has(l.id),s=this.status[l.id],count=s?.count??this.data[l.id]?.items?.length??0,state=!on?'off':s?.state||'idle',badge=({off:'OFF',idle:'READY',loading:'LOADING',connected:`${count} RECORDS`,'needs-key':'KEY NEEDED',unavailable:'UNAVAILABLE',reference:`${count} MAPPED`})[state]||state.toUpperCase(),stamp=s?.updatedAt&&Number.isFinite(Date.parse(s.updatedAt))?new Date(s.updatedAt).toISOString().slice(0,16).replace('T',' ')+' UTC':'';return `<article class="world-source${on?' enabled':''}" style="--world-color:${l.color}"><button data-world-layer="${l.id}" aria-pressed="${on}" aria-label="${on?'Hide':'Show'} ${escapeHTML(l.name)}"><span class="world-source-symbol" aria-hidden="true">${l.symbol}</span><span class="world-source-title">${escapeHTML(l.name)}<small>${escapeHTML(l.description)}</small></span><span class="world-toggle" aria-hidden="true"></span></button><div class="world-source-meta"><span data-world-status="${l.id}" class="world-source-state state-${state}">${escapeHTML(badge)}</span><span>${l.scope==='global'?'GLOBAL':l.scope==='regional'?'REGIONAL':'SCAN AREA'}</span>${stamp?`<time>${stamp}</time>`:''}</div>${on&&s?.note?`<p class="world-source-note">${escapeHTML(s.note)}</p>`:''}${on&&s?.url?`<a class="world-source-link" href="${escapeHTML(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.name||'Original source')} ↗</a>`:''}</article>`;}).join('')}</details>`;}).join('')||'<p class="world-empty">No matching sources.</p>';
  const items=this.getItems();this.container.querySelector('.world-selection').innerHTML=`<div class="world-contact-heading"><strong>${items.length} mapped contacts</strong><span>${this.enabled.size} sources enabled</span></div>${items.slice(0,40).map(item=>`<button data-world-contact="${escapeHTML(`${item.worldKind}:${item.id}`)}"><span style="color:${CATALOG.get(item.worldKind).color}">${CATALOG.get(item.worldKind).symbol}</span><span>${escapeHTML(item.title||item.worldLayer)}<small>${escapeHTML(item.worldLayer)} · ${Number(item.lat).toFixed(3)}, ${Number(item.lon).toFixed(3)}</small></span><span>↗</span></button>`).join('')}${items.length>40?'<p class="world-empty">First 40 contacts shown here. Explore all mapped points on the globe.</p>':!this.enabled.size?'<p class="world-empty">Enable a source to discover its public data.</p>':!items.length?'<p class="world-empty">No mapped records returned. Check coverage and source status above.</p>':''}`;
 }
 destroy(){
  this.destroyed=true;this.revision++;clearInterval(this.timer);for(const c of this.controllers.values())c.abort();this.controllers.clear();
  if(this.map){this.map.off('load',this._load);if(this.ready){for(const id of ['world-points','world-labels']){this.map.off('click',id,this._click);this.map.off('mouseenter',id,this._enter);this.map.off('mouseleave',id,this._leave);}for(const id of ['world-clouds',...STYLE_IDS].reverse())if(this.map.getLayer(id))this.map.removeLayer(id);for(const id of ['world-clouds',...SOURCE_IDS])if(this.map.getSource(id))this.map.removeSource(id);}}
  if(this.container)this.container.innerHTML='';
 }
}
