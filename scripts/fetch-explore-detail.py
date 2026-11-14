#!/usr/bin/env python3
"""Capture substantial attributed article history text; MediaWiki exchars cannot exceed1200, so omit it and bound stored text locally."""
import json,pathlib,subprocess,urllib.parse,time
root=pathlib.Path(__file__).resolve().parents[1];path=root/'data'/'explore-berlin.json';data=json.loads(path.read_text());places=data['places'];expanded=0

def query(params):
 url='https://en.wikipedia.org/w/api.php?'+urllib.parse.urlencode({'action':'query','format':'json','formatversion':'2',**params})
 result=subprocess.run(['curl','-fsSL','--retry','2','--retry-delay','3','--max-time','30',url],capture_output=True,text=True)
 if result.returncode: return {}
 try:return json.loads(result.stdout)
 except:return {}
# Complete introductions for all places, without the provider's 1200-character exchars clamp.
for at in range(0,len(places),15):
 batch=places[at:at+15]
 d=query({'prop':'extracts','exintro':'1','explaintext':'1','exlimit':'max','pageids':'|'.join(str(p['pageId']) for p in batch)})
 pages={p['pageid']:p for p in d.get('query',{}).get('pages',[])}
 for p in batch:
  extract=pages.get(p['pageId'],{}).get('extract','').strip()
  if len(extract)>len(p['extract']):p['extract']=extract[:12000];expanded+=1
 print('Complete introductions:',at+len(batch),'/',len(places),flush=True)
 time.sleep(.4)
# Station histories: read actual full article text, retain a substantial bounded extract.
stations=[p for p in places if any(x in p['title'].lower() for x in ['station','bahnhof','u-bahn'])]
for at,p in enumerate(stations):
 d=query({'prop':'extracts','explaintext':'1','exlimit':'1','exsectionformat':'plain','pageids':str(p['pageId'])})
 pages=d.get('query',{}).get('pages',[]); extract=pages[0].get('extract','').strip() if pages else ''
 if len(extract)>len(p['extract']):p['extract']=extract[:16000];expanded+=1
 print('Station history:',at+1,'/',len(stations),p['title'],len(p['extract']),flush=True)
 time.sleep(.4)
path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
print('Final:',expanded,'expanded article extracts')
