#!/usr/bin/env python3
"""Build licensed raster MBTiles from a local Geofabrik Egypt OSM PBF.

Requires pyosmium and Pillow. Dependencies may be isolated via PYTHONPATH; this
script neither installs packages nor writes live application databases/storage.
It uses libosmium's disk-backed sparse location index and SQLite RTree geometry.
Outputs are bounded map packs, NOT routing, traffic, or satellite imagery.
"""
import argparse, array, datetime, hashlib, io, json, math, os, pathlib, sqlite3, struct, sys, time
import osmium
from PIL import Image, ImageDraw, ImageFont
SOURCE='https://download.geofabrik.de/africa/egypt-latest.osm.pbf'
ATTRIBUTION='© OpenStreetMap contributors · © geoBoundaries (EGY ADM1) · Geofabrik extract · ODbL 1.0'
LICENSE='https://opendatacommons.org/licenses/odbl/1-0/'
BOUNDARY_SOURCE='https://www.geoboundaries.org, EGY-ADM1 (Open Data Commons ODbL 1.0)'
# Coarse all-country coverage plus progressively denser populated corridors.
PACKS=[
 ('egypt-overview','مصر — خريطة عامة', (24.5,21.5,37.3,32.6),5,11),
 ('greater-cairo','القاهرة الكبرى', (30.6,29.4,32.1,31.0),8,14),
 ('delta-canal','الدلتا والقناة', (29.3,29.0,33.4,32.0),8,13),
 ('alexandria-coast','الإسكندرية والساحل', (26.0,29.0,31.9,32.0),8,13),
 ('upper-egypt','الصعيد ووادي النيل', (30.5,21.5,33.8,29.5),8,12),
 ('sinai-red-sea','سيناء والبحر الأحمر', (31.7,21.5,37.2,31.8),8,12),
 ('western-desert','الصحراء الغربية والواحات', (24.5,21.5,30.8,31.8),8,12),
]
MAX_TILES=50000
MAX_BYTES=120*1024*1024

def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def project(lon,lat):
 lat=max(-85.05112878,min(85.05112878,lat));return ((lon+180)/360,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2)
def unproject(x,y):return x*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-2*y))))
def tile_ranges(bounds,z):
 w,s,e,n=bounds; a,b=project(w,n);c,d=project(e,s);count=2**z
 return range(math.floor(a*count),math.floor(c*count)+1),range(math.floor(b*count),math.floor(d*count)+1)

class Extract(osmium.SimpleHandler):
 def __init__(self,db):
  super().__init__();self.db=db;self.features=0;self.nodes=0;self.started=time.time()
 def node(self,n):
  place=n.tags.get('place')
  if place in ('city','town','village') and n.location.valid():
   name=n.tags.get('name:ar') or n.tags.get('name')
   if name:
    x,y=project(n.location.lon,n.location.lat);self.db.execute('insert or replace into places values(?,?,?,?,?)',(n.id,x,y,place,name))
 def way(self,w):
  highway=w.tags.get('highway');water=w.tags.get('waterway');coast=w.tags.get('natural')=='coastline'
  if not(highway or water or coast):return
  coords=[]
  for node in w.nodes:
   if not node.location.valid():return # Do not draw invented bridges across missing nodes.
   coords.extend(project(node.lon,node.lat))
  if len(coords)<4:return
  kind='water' if water or coast else highway
  arr=array.array('f',coords);xs=coords[::2];ys=coords[1::2]
  self.db.execute('insert into ways values(?,?,?,?)',(w.id,kind,w.tags.get('name:ar') or w.tags.get('name') or '',arr.tobytes()))
  self.db.execute('insert into bounds values(?,?,?,?,?)',(w.id,min(xs),max(xs),min(ys),max(ys)))
  self.features+=1
  if self.features%10000==0:
   self.db.commit();print(json.dumps({'phase':'extract','features':self.features,'seconds':round(time.time()-self.started)}),flush=True)

def extract(source,out):
 target=out/'egypt-geometry.sqlite'
 if target.exists():
  with sqlite3.connect('file:'+str(target)+'?mode=ro',uri=True) as saved:
   old_hash=saved.execute("select value from metadata where name='sourceSha256'").fetchone()
  if not old_hash or old_hash[0]!=sha(source):raise ValueError('Existing geometry belongs to a different source; use a new output directory')
  return target
 temp=out/'egypt-geometry.sqlite.partial'
 if temp.exists():temp.unlink() # Only task-derived incomplete output, never source PBF or live data.
 db=sqlite3.connect(temp);db.executescript('pragma journal_mode=OFF; pragma synchronous=OFF; create table ways(id integer primary key,kind text,name text,points blob);create virtual table bounds using rtree(id,minx,maxx,miny,maxy);create table places(id integer primary key,x real,y real,kind text,name text);create index places_xy on places(x,y);create table metadata(name text primary key,value text);')
 handler=Extract(db);index=out/'osm-node-index.bin'
 handler.apply_file(str(source),locations=True,idx='sparse_file_array,'+str(index))
 db.executemany('insert into metadata values(?,?)',[('source',SOURCE),('sourceSha256',sha(source)),('license',LICENSE),('features',str(handler.features)),('createdAt',datetime.datetime.now(datetime.timezone.utc).isoformat())]);db.commit();db.close();os.replace(temp,target)
 if index.exists():index.unlink()
 return target

def color_width(kind,z):
 if kind=='boundary':return '#879b89',1
 if kind=='water':return '#90bdd0',2
 if kind in ('motorway','motorway_link','trunk','trunk_link'):return '#d5a15c',max(1,3 if z>=10 else 2)
 if kind in ('primary','primary_link'):return '#c8ae73',2
 if kind in ('secondary','secondary_link'):return '#c4bba2',2 if z>=11 else 1
 if kind in ('tertiary','tertiary_link'):return ('#c9c4b8',1) if z>=9 else (None,0)
 if kind in ('residential','unclassified','service','living_street'):return ('#ffffff',1) if z>=12 else (None,0)
 return ('#d5d0c5',1) if z>=14 else (None,0)

def render_pack(db,out,item,source_hash,boundary_hash):
 ident,name,bounds,minz,maxz=item;target=out/(ident+'.mbtiles');manifest=out/(ident+'.manifest.json')
 if target.exists() and manifest.exists():
  saved=json.loads(manifest.read_text())
  if saved.get('bounds')!=list(bounds) or saved.get('minZoom')!=minz or saved.get('maxZoom')!=maxz or saved.get('metadata',{}).get('sourceSha256')!=source_hash or saved.get('metadata',{}).get('boundarySourceSha256')!=boundary_hash or saved.get('sha256')!=sha(target):raise ValueError('Existing pack identity differs; use a new output directory: '+ident)
  print('Already complete: '+ident,flush=True);return saved
 total=sum(len(tile_ranges(bounds,z)[0])*len(tile_ranges(bounds,z)[1]) for z in range(minz,maxz+1))
 if total>MAX_TILES:raise ValueError(ident+' exceeds tile count before rendering: '+str(total))
 partial=out/(ident+'.mbtiles.partial')
 if partial.exists():partial.unlink()
 tiles=sqlite3.connect(partial);tiles.executescript('pragma journal_mode=OFF;pragma synchronous=OFF;create table metadata(name text primary key,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob,primary key(zoom_level,tile_column,tile_row));')
 metadata={'name':name,'format':'png','minzoom':str(minz),'maxzoom':str(maxz),'bounds':','.join(map(str,bounds)),'attribution':ATTRIBUTION,'license':LICENSE,'source':SOURCE,'sourceSha256':source_hash,'boundarySource':BOUNDARY_SOURCE,'boundarySourceSha256':boundary_hash,'boundaryLicense':LICENSE,'version':source_hash,'description':'Locally rendered OSM roads/waterways, geoBoundaries governorate outlines, and place labels. Offline raster only: no routing, traffic, or satellite imagery. Zoom limits and rectangular coverage bounds are explicit.'}
 tiles.executemany('insert into metadata values(?,?)',metadata.items())
 fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
 font=ImageFont.truetype(fontpath,11) if pathlib.Path(fontpath).exists() else ImageFont.load_default()
 size=0;count=0;started=time.time();blank={}
 for z in range(minz,maxz+1):
  xr,yr=tile_ranges(bounds,z);world=256*(2**z)
  for x in xr:
   for y in yr:
    margin=4/world;minx=x/(2**z)-margin;maxx=(x+1)/(2**z)+margin;miny=y/(2**z)-margin;maxy=(y+1)/(2**z)+margin
    image=Image.new('RGB',(256,256),'#ecebe2');draw=ImageDraw.Draw(image)
    rows=db.execute('select w.kind,w.points from bounds b join ways w on w.id=b.id where b.minx<=? and b.maxx>=? and b.miny<=? and b.maxy>=?',(maxx,minx,maxy,miny))
    for kind,data in rows:
     color,width=color_width(kind,z)
     if not color:continue
     points=array.array('f');points.frombytes(data)
     coords=[(points[i]*world-x*256,points[i+1]*world-y*256) for i in range(0,len(points),2)]
     # Pillow clips lines at tile boundaries; full segments retain continuity.
     draw.line(coords,fill=color,width=width)
    allowed=('city',) if z<8 else ('city','town') if z<11 else ('city','town','village')
    occupied=set()
    labels=db.execute("select x,y,kind,name from places where x between ? and ? and y between ? and ? order by case kind when 'city' then 0 when 'town' then 1 else 2 end",(x/(2**z),(x+1)/(2**z),y/(2**z),(y+1)/(2**z)))
    for px,py,kind,label in labels:
     if kind not in allowed:continue
     tx=px*world-x*256;ty=py*world-y*256
     cell=(int(tx)//80,int(ty)//24)
     if cell in occupied:continue
     occupied.add(cell)
     draw.ellipse((tx-2,ty-2,tx+2,ty+2),fill='#6a7869')
     try:draw.text((tx+4,ty-7),label[:50],font=font,fill='#344c45',stroke_width=1,stroke_fill='#f7f5ed')
     except UnicodeError:pass
    buffer=io.BytesIO();image.save(buffer,format='PNG',optimize=False,compress_level=5);data=buffer.getvalue();size+=len(data);count+=1
    if size>MAX_BYTES:raise ValueError(ident+' exceeds 120MiB; partial kept, not published')
    tiles.execute('insert into tiles values(?,?,?,?)',(z,x,(2**z)-1-y,data))
   tiles.commit()
  print(json.dumps({'phase':'render','pack':ident,'zoom':z,'tiles':count,'tileBytes':size,'seconds':round(time.time()-started)}),flush=True)
 assert count==total
 tiles.commit();check=tiles.execute('pragma integrity_check').fetchone()[0];assert check=='ok';tiles.close();os.replace(partial,target)
 record={'id':ident,'name':name,'path':str(target),'bounds':bounds,'minZoom':minz,'maxZoom':maxz,'tileCount':count,'tileBytes':size,'fileBytes':target.stat().st_size,'sha256':sha(target),'metadata':metadata,'integrityCheck':check,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 manifest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');return record

def add_boundaries(geometry, boundary_path):
 if not boundary_path.is_file():return None
 db=sqlite3.connect(geometry)
 existing=db.execute("select value from metadata where name='boundarySha256'").fetchone()
 if existing:db.close();return existing[0]
 geo=json.loads(boundary_path.read_text());ident=-1
 for feature in geo.get('features',[]):
  g=feature.get('geometry',{});polygons=g.get('coordinates',[])
  if g.get('type')=='Polygon':polygons=[polygons]
  if g.get('type') not in ('Polygon','MultiPolygon'):continue
  for polygon in polygons:
   for ring in polygon:
    points=[]
    for point in ring:
     lon,lat=point[:2]
     if not(math.isfinite(lon) and math.isfinite(lat) and -180<=lon<=180 and -90<=lat<=90):raise ValueError('Invalid boundary coordinate')
     points.extend(project(lon,lat))
    if len(points)<4:continue
    xs=points[::2];ys=points[1::2]
    db.execute('insert into ways values(?,?,?,?)',(ident,'boundary','',array.array('f',points).tobytes()))
    db.execute('insert into bounds values(?,?,?,?,?)',(ident,min(xs),max(xs),min(ys),max(ys)));ident-=1
 boundary_hash=sha(boundary_path);db.execute("insert into metadata values('boundarySha256',?)",(boundary_hash,));db.commit();db.close();return boundary_hash

def source_bounds(out):
 verification=out/'source-verification.json'
 if not verification.is_file():return None
 data=json.loads(verification.read_text())
 if data.get('officialMd5Verified') is not True:return None
 import re
 match=re.fullmatch(r'\(([-\d.]+)/([-\d.]+)\s+([-\d.]+)/([-\d.]+)\)',str(data.get('sourceBounds','')))
 if not match:return None
 return {'west':float(match[1]),'south':float(match[2]),'east':float(match[3]),'north':float(match[4])}

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path);p.add_argument('--packs',default='all');p.add_argument('--extract-only',action='store_true');args=p.parse_args()
 args.output.mkdir(parents=True,exist_ok=True);geometry=extract(args.source,args.output)
 if args.extract_only:return
 boundary_hash=add_boundaries(geometry,pathlib.Path(__file__).resolve().parents[1]/'android/native-platform/app/src/main/assets/egypt-adm1.geojson')
 if not boundary_hash:raise ValueError('Licensed governorate boundary dataset is required.')
 db=sqlite3.connect('file:'+str(geometry)+'?mode=ro',uri=True);source_hash=dict(db.execute('select name,value from metadata'))['sourceSha256'];requested=set(args.packs.split(','));records=[]
 for item in PACKS:
  if args.packs=='all' or item[0] in requested:records.append(render_pack(db,args.output,item,source_hash,boundary_hash))
 bounds=source_bounds(args.output)
 if not bounds:raise ValueError('Official source bounds have not been verified.')
 for record in records:record['sourceBounds']=bounds; (args.output/(record['id']+'.manifest.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
 catalog={'source':SOURCE,'sourceSha256':source_hash,'sourceBounds':bounds,'boundarySource':BOUNDARY_SOURCE,'boundarySourceSha256':boundary_hash,'license':LICENSE,'attribution':ATTRIBUTION,'packs':records,'limitations':'National overview z5–11 and explicit regional zoom/bounds; map content is roads, waterways, place labels, and licensed governorate outlines. Data completeness follows OSM. No routing, traffic or satellite layer.'};(args.output/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'complete':True,'packs':len(records),'catalog':str(args.output/'catalog.json')}),flush=True)
if __name__=='__main__':main()
