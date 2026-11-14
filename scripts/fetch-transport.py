#!/usr/bin/env python3
"""Extract compact, real Berlin route paths and stations from an official VBB GTFS zip.

Usage: python scripts/fetch-transport.py /tmp/vbb-gtfs.zip
Download source: https://unternehmen.vbb.de/gtfs (CC BY 4.0).
Only representative published service patterns are retained; no live positions.
"""
import collections,csv,datetime,hashlib,io,json,math,pathlib,sys,zipfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
BBOX=[12.99,52.30,13.82,52.70]
MODE={'0':'tram','1':'ubahn','2':'rail','3':'bus','4':'ferry','100':'rail','106':'rail','109':'sbahn','400':'ubahn','700':'bus','900':'tram','1000':'ferry'}
COLORS={'ubahn':'#77b9ed','sbahn':'#75ca91','tram':'#e6626e','bus':'#ac91e5','rail':'#d5c886','ferry':'#62c8d5'}

def inside(p):return BBOX[0]<=p[0]<=BBOX[2] and BBOX[1]<=p[1]<=BBOX[3]

def simplify(points,threshold):
    if len(points)<3:return points
    keep={0,len(points)-1}; stack=[(0,len(points)-1)]
    # Ramer-Douglas-Peucker in a Berlin-local metric plane.
    projected=[(x*67700,y*111200) for x,y in points]
    while stack:
        start,end=stack.pop(); ax,ay=projected[start];bx,by=projected[end];dx=bx-ax;dy=by-ay;den=dx*dx+dy*dy
        furthest=-1;idx=None
        for i in range(start+1,end):
            x,y=projected[i];t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/den)) if den else 0
            d=(x-ax-t*dx)**2+(y-ay-t*dy)**2
            if d>furthest:furthest=d;idx=i
        if idx is not None and furthest>threshold*threshold:keep.add(idx);stack.extend([(start,idx),(idx,end)])
    return [points[i] for i in sorted(keep)]

def clipped_runs(points):
    runs=[];run=[]
    for p in points:
        if inside(p):run.append(p)
        elif run:
            if len(run)>1:runs.append(run)
            run=[]
    if len(run)>1:runs.append(run)
    return runs

def main(path):
    z=zipfile.ZipFile(path)
    def rows(name):return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
    routes={r['route_id']:r for r in rows('routes.txt') if r['route_type'] in MODE}
    shape_info=collections.defaultdict(lambda:collections.Counter())
    representative={};trips={}
    for t in rows('trips.txt'):
        if t['route_id'] not in routes or not t.get('shape_id'):continue
        key=(t['route_id'],t.get('direction_id','0'))
        shape_info[key][t['shape_id']]+=1
        representative.setdefault((t['route_id'],t['shape_id']),t['trip_id'])
    candidate_ids={shape for c in shape_info.values() for shape,_ in c.most_common(8)}
    raw=collections.defaultdict(list)
    for p in rows('shapes.txt'):
        if p['shape_id'] in candidate_ids:
            # Retain nearby shape coordinates only; split at every out-of-bounds point.
            point=[round(float(p['shape_pt_lon']),5),round(float(p['shape_pt_lat']),5)]
            if inside(point):raw[p['shape_id']].append((int(p['shape_pt_sequence']),point))
            elif raw[p['shape_id']] and raw[p['shape_id']][-1][1] is not None:raw[p['shape_id']].append((int(p['shape_pt_sequence']),None))
    paths={}
    for sid,pts in raw.items():
        runs=[];run=[]
        for _,point in sorted(pts):
            if point is None:
                if len(run)>1:runs.append(run)
                run=[]
            elif not run or point!=run[-1]:run.append(point)
        if len(run)>1:runs.append(run)
        if runs:paths[sid]=runs
    selected=[];trip_to_route={}
    for (rid,direction),counts in shape_info.items():
        candidates=[s for s in counts if s in paths]
        if not candidates:continue
        candidates.sort(key=lambda sid:sum(len(r) for r in paths[sid]),reverse=True)
        seen=set();n=0
        for sid in candidates:
            runs=paths[sid]
            # Keep the longest pattern, then material branches, capped at 3 patterns/direction.
            segments={tuple(sorted((tuple(a),tuple(b)))) for run in runs for a,b in zip(run,run[1:])}
            if n and len(segments-seen)<max(12,len(segments)*.35):continue
            seen.update(segments);n+=1
            r=routes[rid];mode=MODE[r['route_type']]
            simplified=[simplify(run,7 if mode=='bus' else 3) for run in runs]
            name=r.get('route_short_name') or r.get('route_long_name') or rid
            color='#'+r['route_color'] if len(r.get('route_color',''))==6 else COLORS[mode]
            selected.append({'id':f'{rid}-{direction}-{sid}','name':name,'mode':mode,'color':color,'routeId':rid,'direction':direction,'lines':simplified})
            trip_to_route[representative[(rid,sid)]]=rid
            if n>=3:break
    # Combine identical published pattern geometry from duplicate route IDs.
    unique={}
    for r in selected:
        key=(r['name'],r['mode'],json.dumps(r['lines'],separators=(',',':')))
        unique.setdefault(key,r)
    selected=list(unique.values())
    stops={s['stop_id']:s for s in rows('stops.txt') if s.get('stop_lat') and s.get('stop_lon') and inside([float(s['stop_lon']),float(s['stop_lat'])])}
    stop_lines=collections.defaultdict(set);stop_modes=collections.defaultdict(set)
    for t in rows('stop_times.txt'):
        rid=trip_to_route.get(t['trip_id'])
        if rid and t['stop_id'] in stops:
            r=routes[rid];stop_lines[t['stop_id']].add(r.get('route_short_name') or r.get('route_long_name') or rid);stop_modes[t['stop_id']].add(MODE[r['route_type']])
    merged={}
    for sid,names in stop_lines.items():
        s=stops[sid];parent=s.get('parent_station')
        # Use parent station when supplied; otherwise retain the actual platform/stop location.
        base=stops.get(parent,s);group=parent or sid.split('::')[0]
        if group not in merged:merged[group]={'id':group,'name':base['stop_name'],'lat':round(float(base['stop_lat']),5),'lon':round(float(base['stop_lon']),5),'modes':set(),'lines':set()}
        merged[group]['modes'].update(stop_modes[sid]);merged[group]['lines'].update(names)
    priority=['ubahn','sbahn','tram','rail','ferry','bus']
    stations=[]
    for s in merged.values():
        s['modes']=sorted(s['modes'],key=priority.index);s['mode']=s['modes'][0];s['lines']=sorted(s['lines']);stations.append(s)
    stations.sort(key=lambda s:(priority.index(s['mode']),s['name']))
    source={'name':'VBB GTFS network snapshot','url':'https://unternehmen.vbb.de/digitale-services/datensaetze/','license':'CC BY 4.0 — Verkehrsverbund Berlin-Brandenburg GmbH (VBB)','updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'downloadUrl':'https://unternehmen.vbb.de/gtfs','sha256':hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(),'note':'Published schedule geometry and named stops. Representative service patterns; route lines are not engineering track alignments or live vehicle positions. Snapshot covers Berlin and its immediate border; some temporary/branch patterns may be omitted.','bbox':BBOX}
    output={'source':source,'routes':selected,'stations':stations}
    dest=ROOT/'data'/'transport-network.json';dest.parent.mkdir(exist_ok=True);dest.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')))
    print(json.dumps({'bytes':dest.stat().st_size,'routePatterns':len(selected),'modes':dict(collections.Counter(r['mode'] for r in selected)),'stations':len(stations),'stationModes':dict(collections.Counter(r['mode'] for r in stations))}))

if __name__=='__main__':main(sys.argv[1])
