/** Camera, authoring and sensor controls for public-data exploration. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const validMissionPoint = p => finite(p?.lat) && finite(p?.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;
const fc = features => ({type:'FeatureCollection', features});
const point = (p, properties = {}) => ({type:'Feature', properties, geometry:{type:'Point', coordinates:[p.lon,p.lat]}});
const SENSORS = ['normal','crt','nvg','thermal','noir'];
const MAX_FILE = 512 * 1024;

export function validateView(value) {
  if (!validMissionPoint(value)) throw new Error('Choose valid latitude and longitude.');
  if (!finite(value.zoom) || value.zoom < 0 || value.zoom > 22) throw new Error('Camera zoom must be between 0 and 22.');
  if (value.bearing !== undefined && !finite(value.bearing) || value.pitch !== undefined && (!finite(value.pitch) || value.pitch < 0 || value.pitch > 65)) throw new Error('Invalid camera angle.');
  const layers = Array.isArray(value.layers) ? [...new Set(value.layers.filter(x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(x)))].slice(0,100) : [];
  return {lat:value.lat, lon:value.lon, zoom:value.zoom, bearing:value.bearing ?? 0, pitch:value.pitch ?? 0, layers, view:typeof value.view === 'string' ? value.view.slice(0,30) : 'tactical', sensor:SENSORS.includes(value.sensor) ? value.sensor : 'normal', globe:value.globe === true};
}

export function encodeMissionView(view) {
  const p = validateView(view);
  const data = {v:1, ...p, lat:Number(p.lat.toFixed(7)), lon:Number(p.lon.toFixed(7)), zoom:Number(p.zoom.toFixed(3)), pitch:Number(p.pitch.toFixed(2)), bearing:Number(p.bearing.toFixed(2))};
  return '#god-eye=' + encodeURIComponent(JSON.stringify(data));
}

export function decodeMissionView(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#god-eye=') || hash.length > 16000) return null;
  try { const data = JSON.parse(decodeURIComponent(hash.slice(9))); return data.v === 1 ? validateView(data) : null; } catch { return null; }
}

export function validateAnnotations(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 200) throw new Error('Import a GeoJSON FeatureCollection with at most 200 features.');
  return fc(data.features.map((f,i) => {
    const g = f?.geometry, title = String(f?.properties?.title ?? `Annotation ${i+1}`).slice(0,120);
    const validCoordinate = c => Array.isArray(c) && c.length >= 2 && validMissionPoint({lon:c[0],lat:c[1]});
    if (g?.type === 'Point' && validCoordinate(g.coordinates)) return {type:'Feature',properties:{title},geometry:{type:'Point',coordinates:g.coordinates.slice(0,2)}};
    if (g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.length <= 500 && g.coordinates.every(validCoordinate)) return {type:'Feature',properties:{title},geometry:{type:'LineString',coordinates:g.coordinates.map(c=>c.slice(0,2))}};
    throw new Error('Annotations support valid WGS84 points and routes only.');
  }));
}

export function validateScene(data) {
  if (data?.type !== 'GodEyeScene' || data.version !== 1 || !Array.isArray(data.anchors) || !data.anchors.length || data.anchors.length > 30) throw new Error('Import a God Eye scene containing 1–30 camera anchors.');
  return {type:'GodEyeScene',version:1,name:String(data.name || 'Imported scene').slice(0,100),anchors:data.anchors.map((a,i)=>({...validateView(a),name:String(a.name || `View ${i+1}`).slice(0,100),duration:clamp(finite(a.duration)?a.duration:5000,1500,30000)})),annotations:validateAnnotations(data.annotations || fc([]))};
}

export function parseMissionCommand(input) {
  const q = String(input || '').trim().slice(0,200);
  const coordinate = q.match(/^(?:fly(?: to)?|go(?: to)?)\s+(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/i);
  if (coordinate) { const p = {lat:Number(coordinate[1]),lon:Number(coordinate[2])}; return validMissionPoint(p) ? {action:'fly',...p} : {action:'error',message:'Coordinates are outside the supported map bounds.'}; }
  const layer = q.match(/^(show|enable|hide|disable)\s+([\w-]+)$/i);
  if (layer) return {action:'layer',id:layer[2],enabled:/show|enable/i.test(layer[1])};
  const sensor = q.match(/^(?:sensor|style)\s+(normal|crt|nvg|thermal|noir)$/i);
  if (sensor) return {action:'sensor',sensor:sensor[1].toLowerCase()};
  const count = q.match(/^(?:count|how many)\s*(.*)$/i);
  if (count) return {action:'count',query:count[1].toLowerCase().replace(/\?$/,'').trim()};
  if (/^(?:reset (?:globe|earth)|global(?: view)?|globe)$/i.test(q)) return {action:'globe'};
  if (/^(north(?: up)?|tilt|stop(?: tracking)?)$/i.test(q)) return {action:/north/i.test(q)?'north':/tilt/i.test(q)?'tilt':'stop'};
  return {action:'error',message:'Try “fly to 52.52, 13.405”, “show satellites”, “count earthquakes”, “style nvg” or “globe”.'};
}

export class MissionTools {
  constructor({map,onFly=()=>{},onMessage=()=>{},getState=()=>({}),onLayers=()=>{}}={}) {
    Object.assign(this,{map,onFly,onMessage,getState,onLayers});
    this.sensor='normal';this.tab='camera';this.annotations=fc([]);this.anchors=[];this.route=[];this.drawMode=null;this.boxes=false;this.trail=[];this.destroyed=false;
    this.mapClick=e=>this.addMapPoint(e);
    this.mapMove=()=>this.renderBoxes();
    if (map) this.attachMap(map);
  }
  mount(container) {
    this.container=container;
    this.clickHandler=e=>{const b=e.target.closest('[data-mission]');if(b&&container.contains(b))this.action(b.dataset.mission,b.dataset);};
    this.submitHandler=e=>{if(e.target.matches('[data-mission-command]')){e.preventDefault();this.command(e.target.querySelector('input').value);}};
    this.changeHandler=e=>{if(e.target.matches('[data-mission-import]'))this.importFile(e.target.files?.[0],e.target.dataset.missionImport);};
    container.addEventListener('click',this.clickHandler);container.addEventListener('submit',this.submitHandler);container.addEventListener('change',this.changeHandler);
    this.timer=setInterval(()=>{if(!this.destroyed)this.update();},2000);this.timer.unref?.();
    this.render();return this;
  }
  attachMap(map,ready=false) {
    if (this.mapAttached) { this.map?.off?.('click',this.mapClick);this.map?.off?.('move',this.mapMove); }
    this.map=map;this.mapAttached=true;
    map.on?.('click',this.mapClick);map.on?.('move',this.mapMove);
    const ensure=()=>{
      if(this.destroyed||!this.map)return;
      if(!map.getSource?.('mission-annotations')) {
        map.addSource('mission-annotations',{type:'geojson',data:this.annotations});
        map.addLayer({id:'mission-annotation-routes',type:'line',source:'mission-annotations',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#f7ce8b','line-width':3,'line-dasharray':[2,1]}});
        map.addLayer({id:'mission-annotation-marks',type:'circle',source:'mission-annotations',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#f7ce8b','circle-radius':7,'circle-stroke-color':'#fff4da','circle-stroke-width':2}});
        map.addLayer({id:'mission-annotation-labels',type:'symbol',source:'mission-annotations',filter:['==',['geometry-type'],'Point'],layout:{'text-field':['get','title'],'text-size':12,'text-offset':[0,1.5],'text-anchor':'top'},paint:{'text-color':'#ffe2af','text-halo-color':'#101923','text-halo-width':2}});
        map.addSource('mission-track',{type:'geojson',data:fc([])});
        map.addLayer({id:'mission-track-line',type:'line',source:'mission-track',paint:{'line-color':'#7ce2e6','line-width':3,'line-opacity':.85}});
        map.addLayer({id:'mission-track-point',type:'circle',source:'mission-track',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#94ecf2','circle-radius':11,'circle-opacity':.2,'circle-stroke-color':'#b0f6ff','circle-stroke-width':2}});
      }
      this.applySensor();this.restore();
    };
    if(!ready&&map.isStyleLoaded?.()===false)map.once?.('load',ensure);else ensure();
    const parent=map.getContainer?.();
    if(parent&&typeof document!=='undefined'&&!this.boxContainer){this.boxContainer=document.createElement('div');this.boxContainer.className='mission-contact-boxes';this.boxContainer.setAttribute('aria-hidden','true');parent.append(this.boxContainer);}
  }
  message(text) {this.notice=text;this.onMessage(text);this.render();}
  items() {return (this.getState().items || []).filter(validMissionPoint);}
  currentView() {
    if(!this.map)throw new Error('The map is still loading.');
    const c=this.map.getCenter(),s=this.getState();
    return validateView({lat:c.lat,lon:c.lng,zoom:this.map.getZoom(),bearing:this.map.getBearing(),pitch:this.map.getPitch(),layers:[...(s.enabled||s.layers||[])],view:s.view,sensor:this.sensor,globe:this.map.getProjection?this.map.getProjection()?.type==='globe':this.globe});
  }
  fly(p) {
    if(!validMissionPoint(p)){this.message('This record has no valid map position.');return;}
    this.onFly({...p,zoom:p.zoom??16,pitch:p.pitch??45,duration:p.duration??2500});
  }
  applyView(view) {
    const p=validateView(view);this.sensor=p.sensor;this.globe=p.globe;
    this.map?.setProjection?.({type:p.globe?'globe':'mercator'});
    this.onLayers({layers:p.layers,view:p.view});this.applySensor();this.fly(p);
  }
  restore(hash=typeof location!=='undefined'?location.hash:'') {
    if(this.restoredHash===hash)return false;
    if(!this.map)return false;
    const view=decodeMissionView(hash);if(!view)return false;
    this.restoredHash=hash;this.applyView(view);this.message('Shared camera and layers restored.');return true;
  }
  applySensor() {
    const canvas=this.map?.getCanvas?.();if(canvas)canvas.dataset.sensor=this.sensor;
    this.map?.getContainer?.()?.classList.toggle('mission-crt',this.sensor==='crt');
  }
  async share() {
    try {
      const view=this.currentView(),url=new URL(typeof location!=='undefined'?location.href:'https://example.invalid/');url.hash=encodeMissionView(view);
      this.shareURL=url.href;
      if(typeof history!=='undefined')history.replaceState(null,'',url.href);
      if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(url.href);this.message('Camera and active layers copied as a share link.');}
      else this.message('Copy the share link below.');
    } catch(e){this.message(e.message);}
  }
  exportJSON(data,name) {
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async importFile(file,kind) {
    if(!file)return;
    if(file.size>MAX_FILE){this.message('Choose a JSON file smaller than 512 KB.');return;}
    try {
      const data=JSON.parse(await file.text());
      if(kind==='scene'){const scene=validateScene(data);this.stopScene();this.anchors=scene.anchors;this.annotations=scene.annotations;this.renderAnnotations();this.message(`${scene.anchors.length} camera anchors imported. Select an anchor or play the scene.`);}
      else{this.annotations=validateAnnotations(data);this.renderAnnotations();this.message(`${this.annotations.features.length} map annotations imported.`);}
    } catch(e){this.message(e instanceof SyntaxError?'The file is not valid JSON.':e.message);}
  }
  renderAnnotations() {this.map?.getSource?.('mission-annotations')?.setData(this.annotations);}
  addMapPoint(event) {
    if(!this.drawMode||!event?.lngLat)return;
    const p={lat:event.lngLat.lat,lon:event.lngLat.lng};if(!validMissionPoint(p))return;
    if(this.annotations.features.length>=200){this.message('Annotation limit reached. Clear or export the current marks.');return;}
    if(this.drawMode==='mark')this.annotations.features.push(point(p,{title:`Mark ${this.annotations.features.filter(f=>f.geometry.type==='Point').length+1}`}));
    else {if(this.route.length>=500){this.message('Route limit reached. Finish this route.');return;}this.route.push([p.lon,p.lat]);const existing=this.annotations.features.find(f=>f.properties.drawing);if(this.route.length>=2){if(existing)existing.geometry.coordinates=[...this.route];else this.annotations.features.push({type:'Feature',properties:{title:'Drawn route',drawing:true},geometry:{type:'LineString',coordinates:[...this.route]}});}}
    this.renderAnnotations();this.render();
  }
  finishRoute() {for(const f of this.annotations.features)delete f.properties.drawing;this.route=[];this.drawMode=null;this.map?.getCanvas?.().style&&(this.map.getCanvas().style.cursor='');this.render();}
  setDrawMode(mode) {this.finishRoute();this.drawMode=mode;const canvas=this.map?.getCanvas?.();if(canvas)canvas.style.cursor='crosshair';this.message(mode==='mark'?'Click the map to add marks. Finish drawing when done.':'Click successive map locations to draw a route. Finish drawing when done.');}
  scene() {return {type:'GodEyeScene',version:1,name:'God Eye camera scene',anchors:this.anchors,annotations:this.annotations};}
  stopScene() {this.playing=false;clearTimeout(this.sceneTimer);this.sceneTimer=null;}
  playScene() {
    if(this.playing){this.stopScene();this.render();return;}
    if(!this.anchors.length){this.message('Save a camera anchor first.');return;}
    this.stopTracking();this.playing=true;let index=0;
    const next=()=>{if(!this.playing||this.destroyed)return;if(index>=this.anchors.length){this.stopScene();this.render();return;}const anchor=this.anchors[index++];this.applyView(anchor);this.sceneTimer=setTimeout(next,anchor.duration);this.sceneTimer.unref?.();this.render();};next();
  }
  track(id,cockpit=false) {
    const target=this.items().find(x=>String(x.id)===String(id));if(!target){this.message('This contact is no longer in the loaded data.');return;}
    this.stopScene();this.trackedId=target.id;this.cockpit=cockpit;this.trail=[];this.update();
    this.message(`${cockpit?'Cockpit perspective':'Tracking'}: ${target.title}. Camera follows supplied coordinates as the feed refreshes; movement between observations is not invented.`);
  }
  stopTracking(){this.trackedId=null;this.trail=[];this.map?.getSource?.('mission-track')?.setData(fc([]));}
  update() {
    if(this.trackedId){const target=this.items().find(x=>x.id===this.trackedId);if(target){const last=this.trail.at(-1);if(!last||last[0]!==target.lon||last[1]!==target.lat){this.trail.push([target.lon,target.lat]);if(this.trail.length>100)this.trail.shift();const features=[point(target)];if(this.trail.length>1)features.unshift({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[...this.trail]}});this.map?.getSource?.('mission-track')?.setData(fc(features));this.fly({...target,zoom:this.cockpit?17.5:15.4,pitch:this.cockpit?65:45,bearing:finite(target.heading)?target.heading:this.map?.getBearing?.()??0,duration:1500});}}else{this.stopTracking();this.notice='Tracked contact is absent from the current feed; camera follow stopped.';}}
    this.renderBoxes();if(this.container&&this.tab==='contacts')this.render();
  }
  renderBoxes() {
    if(!this.boxContainer)return;
    this.boxContainer.hidden=!this.boxes;if(!this.boxes||!this.map?.project)return;
    const canvas=this.map.getCanvas(),width=canvas.clientWidth||canvas.width,height=canvas.clientHeight||canvas.height;
    this.boxContainer.innerHTML=this.items().slice(0,150).map(item=>{const p=this.map.project([item.lon,item.lat]);if(!finite(p.x)||!finite(p.y)||p.x<0||p.x>width||p.y<0||p.y>height)return '';return `<span class="mission-contact-box" style="left:${Math.round(p.x)}px;top:${Math.round(p.y)}px"><i>${esc(String(item.id).slice(0,16))}</i><b>${esc(String(item.title).slice(0,45))}</b></span>`;}).join('');
  }
  command(input) {
    const c=parseMissionCommand(input);
    if(c.action==='error'){this.message(c.message);return;}
    if(c.action==='fly'){this.stopTracking();this.fly(c);this.message(`Flying to ${c.lat}, ${c.lon}.`);}
    if(c.action==='layer'){this.onLayers({id:c.id,enabled:c.enabled});this.message(`${c.enabled?'Show':'Hide'} layer: ${c.id}.`);}
    if(c.action==='sensor'){this.sensor=c.sensor;this.applySensor();this.message(`Sensor style: ${c.sensor}. This changes the display, not the measured data.`);}
    if(c.action==='count'){const q=c.query.replace(/s$/,'');const list=this.items().filter(x=>!q||q==='contact'||`${x.category||''} ${x.title||''}`.toLowerCase().includes(q));this.message(`${list.length} matching contacts in the currently loaded data. This is not a complete world count.`);}
    if(c.action==='globe')this.action('globe');
    if(c.action==='north')this.action('north');
    if(c.action==='tilt')this.action('tilt');
    if(c.action==='stop'){this.stopScene();this.stopTracking();this.finishRoute();this.message('Camera tracking and scene playback stopped.');}
  }
  voice() {
    const Recognition=typeof window!=='undefined'&&(window.SpeechRecognition||window.webkitSpeechRecognition);
    if(!Recognition){this.message('Voice recognition is unavailable in this browser. Type a command instead.');return;}
    this.recognition?.abort?.();this.recognition=new Recognition();this.recognition.lang='en-US';this.recognition.interimResults=false;
    this.recognition.onresult=e=>this.command(e.results[0][0].transcript);this.recognition.onerror=()=>this.message('Voice input was not received. Check microphone permission or type a command.');
    try{this.recognition.start();}catch{this.message('Microphone recognition could not start. Type a command instead.');return;}this.message('Listening for a command. Browser speech recognition may use its speech service.');
  }
  action(action,data={}) {
    if(action==='tab'){this.tab=data.tab;this.notice='';}
    if(action==='sensor'){this.sensor=data.sensor;this.applySensor();}
    if(action==='globe'){this.stopTracking();this.globe=true;this.map?.setProjection?.({type:'globe'});this.fly({lat:20,lon:13.405,zoom:1.6,pitch:0,bearing:0});}
    if(action==='regional'){this.globe=false;this.map?.setProjection?.({type:'mercator'});this.fly({lat:52.52,lon:13.405,zoom:12.6,pitch:45,bearing:-18});}
    if(action==='north')this.map?.easeTo?.({bearing:0,duration:800});
    if(action==='tilt')this.map?.easeTo?.({pitch:(this.map?.getPitch?.()??0)>10?0:35,duration:800});
    if(action==='terrain'){if(!this.map){this.message('The map is still loading.');return;}this.terrain=!this.terrain;if(this.terrain&&!this.map.getSource('mission-terrain'))this.map.addSource('mission-terrain',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,maxzoom:15,encoding:'terrarium',attribution:'Elevation: Mapzen / AWS Open Data'});this.map.setTerrain?.(this.terrain?{source:'mission-terrain',exaggeration:1.3}:null);this.message(this.terrain?'Terrain relief enabled. Elevation tiles are geographic context, not live measurements.':'Terrain relief disabled.');}
    if(action==='share')this.share();
    if(action==='boxes'){this.boxes=!this.boxes;this.renderBoxes();}
    if(action==='mark'||action==='route')this.setDrawMode(action);
    if(action==='finish')this.finishRoute();
    if(action==='clear'){this.finishRoute();this.annotations=fc([]);this.renderAnnotations();}
    if(action==='export-marks')this.exportJSON(validateAnnotations(this.annotations),'god-eye-annotations.geojson');
    if(action==='anchor'){if(this.anchors.length>=30){this.message('Scene limit is 30 anchors.');return;}try{this.anchors.push({...this.currentView(),name:`View ${this.anchors.length+1}`,duration:5000});}catch(e){this.message(e.message);}}
    if(action==='anchor-fly'){const a=this.anchors[Number(data.index)];if(a)this.applyView(a);}
    if(action==='anchor-remove')this.anchors.splice(Number(data.index),1);
    if(action==='scene-play')this.playScene();
    if(action==='scene-clear'){this.stopScene();this.anchors=[];}
    if(action==='scene-export'){if(!this.anchors.length){this.message('Save at least one camera anchor first.');return;}this.exportJSON(this.scene(),'god-eye-scene.json');}
    if(action==='inspect'){const p=this.items().find(x=>String(x.id)===data.id);if(p){this.stopTracking();this.fly(p);this.notice=`${p.title} · ${p.source||'Public source'} · ${p.updatedAt?new Date(p.updatedAt).toLocaleString():'Source time not supplied'}`;}}
    if(action==='track'||action==='cockpit')this.track(data.id,action==='cockpit');
    if(action==='stop-track')this.stopTracking();
    if(action==='voice')this.voice();
    if(action==='directions')this.directions();
    this.render();
  }
  async directions() {
    const get=name=>this.container.querySelector(`[data-route-${name}]`)?.value||'';
    this.routeFrom=get('from');this.routeTo=get('to');this.routeMode=get('mode')||'drive';
    const pair=v=>{const m=v.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);return m?{lat:Number(m[1]),lon:Number(m[2])}:null;};
    const from=pair(this.routeFrom),to=pair(this.routeTo);
    if(!validMissionPoint(from)||!validMissionPoint(to)){this.message('Enter start and end as latitude, longitude.');return;}
    this.routeAbort?.abort();this.routeAbort=new AbortController();this.notice='Calculating route…';this.render();
    try{const r=await fetch('/api/route?'+new URLSearchParams({from:`${from.lon},${from.lat}`,to:`${to.lon},${to.lat}`,mode:this.routeMode}),{signal:this.routeAbort.signal});const d=await r.json();if(!r.ok)throw new Error(d.error);if(this.destroyed)return;
      if(d.route?.type!=='LineString'||!Array.isArray(d.route.coordinates)||d.route.coordinates.length<2)throw new Error('No valid route returned.');
      this.directionsResult=d;const coordinates=d.route.coordinates.filter((_,i,a)=>i===a.length-1||i%Math.max(1,Math.ceil(a.length/490))===0);
      this.annotations.features=this.annotations.features.filter(f=>f.properties.id!=='directions');this.annotations.features.push({type:'Feature',properties:{id:'directions',title:`${this.routeMode} route · OpenStreetMap / OSRM`},geometry:{type:'LineString',coordinates}});this.renderAnnotations();this.fly({lat:(from.lat+to.lat)/2,lon:(from.lon+to.lon)/2,zoom:12.8});this.message('Calculated route added to the whiteboard. Travel times are estimates, not live traffic.');
    }catch(e){if(e.name!=='AbortError')this.message(e.message||'Routing is unavailable.');}
  }
  render() {
    if(!this.container)return;
    const button=(action,label,extra='')=>`<button type="button" data-mission="${action}" ${extra}>${label}</button>`;
    let body='';
    if(this.tab==='camera')body=`<h3>Camera & sensor</h3><div class="mission-buttons">${button('globe','Reset globe')}${button('regional','Berlin')}${button('north','North up')}${button('tilt','Tilt 35° / top down')}${button('terrain',this.terrain?'Hide terrain':'Terrain relief',`aria-pressed="${!!this.terrain}"`)}</div><p class="mission-copy">Sensor styles change the map display. Thermal is a colour treatment, not measured infrared imagery.</p><div class="mission-sensors">${SENSORS.map(s=>button('sensor',s==='nvg'?'Night vision':s==='thermal'?'Thermal look':s.toUpperCase(),`data-sensor="${s}" aria-pressed="${this.sensor===s}"`)).join('')}</div><div class="mission-buttons">${button('boxes',this.boxes?'Hide contact boxes':'Show contact boxes',`aria-pressed="${this.boxes}"`)}${button('share','Share this view')}</div><p class="mission-copy">Boxes label loaded public-data contacts. They do not detect people or objects in imagery.</p>${this.shareURL?`<label class="mission-field">Share link<input readonly value="${esc(this.shareURL)}" aria-label="Share link"></label>`:''}`;
    if(this.tab==='marks')body=`<h3>Map whiteboard</h3><p class="mission-copy">Place marks or click a route on the map. Import and export WGS84 GeoJSON points and lines.</p><div class="mission-buttons">${button('mark','Add marks',`aria-pressed="${this.drawMode==='mark'}"`)}${button('route','Draw route',`aria-pressed="${this.drawMode==='route'}"`)}${button('finish','Finish drawing')}${button('clear','Clear')}</div><p class="mission-copy">${this.annotations.features.length} annotations · ${this.route.length} route points</p><div class="mission-buttons">${button('export-marks','Export GeoJSON')}<label class="mission-import">Import GeoJSON<input type="file" data-mission-import="marks" accept=".json,.geojson,application/json"></label></div>`;
    if(this.tab==='scenes')body=`<h3>Scene director</h3><p class="mission-copy">Save camera anchors, move between them, and share the authored scene as a JSON file. Each anchor records its camera and active layers.</p><div class="mission-buttons">${button('anchor','Save camera anchor')}${button('scene-play',this.playing?'Stop scene':'Play scene')}${button('scene-clear','Clear scene')}</div><div class="mission-anchors">${this.anchors.map((a,i)=>`<div>${button('anchor-fly',`${i+1}. ${esc(a.name)} <small>${a.lat.toFixed(3)}, ${a.lon.toFixed(3)} · z${a.zoom.toFixed(1)}</small>`,`data-index="${i}"`)}${button('anchor-remove','Remove',`data-index="${i}" aria-label="Remove ${esc(a.name)}"`)}</div>`).join('')||'<p class="mission-copy">No camera anchors saved in this session.</p>'}</div><div class="mission-buttons">${button('scene-export','Export scene')}<label class="mission-import">Import scene<input type="file" data-mission-import="scene" accept=".json,application/json"></label></div>`;
    if(this.tab==='contacts'){const items=this.items().slice(0,80);body=`<h3>Loaded contacts <small>${this.items().length}</small></h3><p class="mission-copy">Inspect a public-data record or follow its supplied position. Cockpit gives an oblique camera perspective; it is not an aircraft camera feed.</p>${this.trackedId?button('stop-track','Stop tracking'):''}<div class="mission-contacts">${items.map(p=>`<article><strong>${esc(p.title)}</strong><small>${esc(p.category)} · ${esc(p.source||'Public source')}</small><div>${button('inspect','Fly to',`data-id="${esc(p.id)}"`)}${button('track','Track',`data-id="${esc(p.id)}"`)}${/flight|airspace|satellite|vessel/i.test(p.category)?button('cockpit','Cockpit',`data-id="${esc(p.id)}"`):''}</div></article>`).join('')||'<p class="mission-copy">Enable a data layer to populate contacts.</p>'}</div>${this.items().length>80?'<p class="mission-copy">Showing the first 80 loaded records.</p>':''}`;}
    if(this.tab==='routing')body=`<h3>Directions</h3><p class="mission-copy">Start and end use latitude, longitude. Routes use public OpenStreetMap services.</p><label class="mission-field">Start<input data-route-from value="${esc(this.routeFrom||'52.516275, 13.377704')}" placeholder="52.516275, 13.377704"></label><label class="mission-field">End<input data-route-to value="${esc(this.routeTo||'52.5219, 13.4132')}" placeholder="52.5219, 13.4132"></label><label class="mission-field">Mode<select data-route-mode>${['drive','walk','cycle'].map(m=>`<option value="${m}" ${m===(this.routeMode||'drive')?'selected':''}>${m}</option>`).join('')}</select></label>${button('directions','Calculate route')}${this.directionsResult?`<p class="mission-copy">${(this.directionsResult.distance/1000).toFixed(1)} km · about ${Math.round(this.directionsResult.duration/60)} min</p><ol>${this.directionsResult.steps.slice(0,30).map(s=>`<li>${esc([s.type,s.modifier,s.name].filter(Boolean).join(' '))} · ${Math.round(s.distance)} m</li>`).join('')}</ol>`:''}`;
    this.container.innerHTML=`<section class="mission-widget"><div class="mission-tabs" role="group" aria-label="Mission tools">${[['camera','Camera'],['marks','Whiteboard'],['scenes','Director'],['contacts','Contacts'],['routing','Directions']].map(([key,name])=>button('tab',name,`data-tab="${key}" aria-pressed="${this.tab===key}"`)).join('')}</div><div class="mission-body">${body}${this.notice?`<p class="mission-notice" role="status">${esc(this.notice)}</p>`:''}</div><form data-mission-command class="mission-command"><label for="mission-command-input">LOCAL COMMANDS · no AI key required</label><div><input id="mission-command-input" maxlength="200" placeholder="show satellites · count earthquakes"><button type="submit" aria-label="Run command">→</button>${button('voice','Mic','aria-label="Speak a command"')}</div></form></section>`;
  }
  destroy() {
    this.destroyed=true;this.routeAbort?.abort();clearInterval(this.timer);this.stopScene();this.stopTracking();this.recognition?.abort?.();this.finishRoute();
    this.map?.off?.('click',this.mapClick);this.map?.off?.('move',this.mapMove);
    if(this.map?.getCanvas?.())delete this.map.getCanvas().dataset.sensor;
    this.map?.getContainer?.()?.classList.remove('mission-crt');this.boxContainer?.remove();if(this.terrain){this.map?.setTerrain?.(null);if(this.map?.getSource?.('mission-terrain'))this.map.removeSource('mission-terrain');}
    for(const id of ['mission-track-point','mission-track-line','mission-annotation-labels','mission-annotation-marks','mission-annotation-routes'])if(this.map?.getLayer?.(id))this.map.removeLayer(id);
    for(const id of ['mission-track','mission-annotations'])if(this.map?.getSource?.(id))this.map.removeSource(id);
    if(this.container){this.container.removeEventListener('click',this.clickHandler);this.container.removeEventListener('submit',this.submitHandler);this.container.removeEventListener('change',this.changeHandler);}
  }
}
