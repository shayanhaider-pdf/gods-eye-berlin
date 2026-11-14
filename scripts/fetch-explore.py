#!/usr/bin/env python3
"""Rebuild sourced Berlin reference catalogue. Public Wikipedia API, CC BY-SA 4.0."""
import json,subprocess,urllib.parse,time,datetime,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
GROUPS={
'history':[
'Brandenburg Gate','Reichstag building','Berlin Wall','Berlin Wall Memorial','Checkpoint Charlie','Palace of Tears','Topography of Terror','East Side Gallery','Nikolaiviertel','Bebelplatz','Humboldt University of Berlin','Rotes Rathaus','Tempelhof Airport','Anhalter Bahnhof','Berlin Anhalter Bahnhof','Berlin Nordbahnhof','Berlin Friedrichstraße station','Berlin Alexanderplatz station','Berlin Zoologischer Garten railway station','Berlin Hauptbahnhof','Berlin Ostbahnhof','Berlin Ostkreuz','Berlin Gesundbrunnen station','Berlin Südkreuz','Potsdamer Platz station','Wittenbergplatz (Berlin U-Bahn)','Nollendorfplatz (Berlin U-Bahn)','Bülowstraße (Berlin U-Bahn)','Eberswalder Straße (Berlin U-Bahn)','Klosterstraße (Berlin U-Bahn)','Märkisches Museum (Berlin U-Bahn)','Onkel Toms Hütte (Berlin U-Bahn)','Heidelberger Platz (Berlin U-Bahn)','Kottbusser Tor (Berlin U-Bahn)','Görlitzer Bahnhof (Berlin U-Bahn)','Ruhleben (Berlin U-Bahn)','Ullsteinhaus','AEG turbine factory','Siemensstadt','Olympiastadion (Berlin)','Stasi Museum','Hohenschönhausen Memorial'],
'architecture':[
'Fernsehturm Berlin','Berlin Cathedral','Charlottenburg Palace','Berlin Palace','Gendarmenmarkt','Konzerthaus Berlin','Neue Nationalgalerie','Bauhaus Archive','Jewish Museum Berlin','Berliner Philharmonie','Kaiser Wilhelm Memorial Church','Oberbaum Bridge','Glienicke Bridge','Berlin Victory Column','Hackesche Höfe','Hansaviertel','Corbusierhaus','Hufeisensiedlung','Shell-Haus','Haus des Lehrers','Bierpinsel','Haus der Kulturen der Welt','Parochialkirche','New Synagogue (Berlin)','St. Nicholas Church, Berlin','St. Mary\'s Church, Berlin'],
'culture':[
'Museum Island','Pergamon Museum','Altes Museum','Neues Museum','Bode Museum','Alte Nationalgalerie','Hamburger Bahnhof','Kulturbrauerei','Molecule Man (sculpture)','World Clock (Alexanderplatz)','Prater Garten','Deutsche Oper Berlin','Komische Oper Berlin','Berlin State Opera','Friedrichstadt-Palast','Berliner Ensemble','Deutsches Theater (Berlin)','Urban Nation','Kreuzberg Museum','Märkisches Museum','German Museum of Technology','Deutsches Historisches Museum','Berlinische Galerie','Tacheles','Haus Schwarzenberg','RAW-Gelände'],
'memorials':[
'Memorial to the Murdered Jews of Europe','Memorial to the Sinti and Roma Victims of National Socialism','Memorial to Homosexuals Persecuted Under Nazism','Neue Wache','Soviet War Memorial (Treptower Park)','Soviet War Memorial (Tiergarten)','Memorial to the German Resistance','Gedenkstätte Plötzensee','Gleis 17 Memorial','Platform 17 memorial','Otto Weidt Museum','Memorial to the Berlin Wall','Invalidenfriedhof'],
'geography':[
'Spree','Havel','Landwehr Canal','Pfaueninsel','Teufelsberg','Müggelberge','Wannsee','Großer Müggelsee','Schlachtensee','Krumme Lanke','Rummelsburger See','Tegeler See','Großer Wannsee','Langer See','Spandau Citadel','Luiseninsel','Insel der Jugend'],
'parks':[
'Großer Tiergarten','Mauerpark','Volkspark Friedrichshain','Treptower Park','Tempelhofer Feld','Viktoriapark','Volkspark Humboldthain','Britzer Garten','Gardens of the World','Botanical Garden and Botanical Museum Berlin-Dahlem','Grunewald (forest)','Gleisdreieck Park','Park am Gleisdreieck','Volkspark Rehberge','Schlosspark Charlottenburg','Körnerpark','Natur-Park Schöneberger Südgelände','Bürgerpark Pankow','Ernst-Thälmann-Park']}
rows=[(cat,title) for cat,titles in GROUPS.items() for title in titles]
records=[];missing=[];seen=set()
for start in range(0,len(rows),15):
 batch=rows[start:start+15]
 params={'action':'query','format':'json','formatversion':'2','redirects':'1','prop':'extracts|coordinates|pageprops|info','inprop':'url','exintro':'1','explaintext':'1','exlimit':'max','exchars':'5500','coprimary':'primary','colimit':'max','ppprop':'wikibase_item','titles':'|'.join(t for c,t in batch)}
 url='https://en.wikipedia.org/w/api.php?'+urllib.parse.urlencode(params)
 run=subprocess.run(['curl','-fsSL','--max-time','30',url],capture_output=True,text=True)
 if run.returncode: raise RuntimeError(run.stderr)
 data=json.loads(run.stdout); pages={p['title']:p for p in data.get('query',{}).get('pages',[])}
 redirects={x['from']:x['to'] for x in data.get('query',{}).get('redirects',[])}
 normalized={x['from']:x['to'] for x in data.get('query',{}).get('normalized',[])}
 for cat,title in batch:
  norm=normalized.get(title,title);norm=redirects.get(norm,norm); p=pages.get(norm,{})
  coords=(p.get('coordinates') or [{}])[0];lat=coords.get('lat');lon=coords.get('lon');extract=p.get('extract','').strip()
  if p.get('missing') or not lat or not lon or not extract or not (52.28<lat<52.78 and 12.9<lon<13.95):missing.append({'title':title,'reason':'missing page, coordinates, extract or outside Berlin bounding box'});continue
  if p['pageid'] in seen:continue
  seen.add(p['pageid'])
  records.append({'id':'explore-'+str(p['pageid']),'category':cat,'title':p['title'],'description':extract[:700].rsplit(' ',1)[0]+'…' if len(extract)>700 else extract,'extract':extract,'lat':lat,'lon':lon,'wikiTitle':p['title'],'pageId':p['pageid'],'wikidataId':p.get('pageprops',{}).get('wikibase_item'),'source':'Wikipedia contributors','sourceUrl':p.get('fullurl') or 'https://en.wikipedia.org/?curid='+str(p['pageid']),'license':'CC BY-SA 4.0','status':'reference','updatedAt':None})
 print(f'Fetched {start+len(batch)}/{len(rows)} titles; {len(records)} usable records',flush=True)
 time.sleep(.15)
result={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'English Wikipedia via MediaWiki API','sourceUrl':'https://en.wikipedia.org/','license':'CC BY-SA 4.0','note':'Curated, coordinate-tagged public reference places. Geographic markers indicate article reference coordinates, not the extent of a site or evidence of current activity. Wikipedia extracts are reused with attribution and share-alike licensing.','places':records}
(ROOT/'data'/'explore-berlin.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
(ROOT/'data'/'explore-missing.json').write_text(json.dumps(missing,ensure_ascii=False,indent=2))
print('Final:',len(records),'records;',len(missing),'unavailable titles')
