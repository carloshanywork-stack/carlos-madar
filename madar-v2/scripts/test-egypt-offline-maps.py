#!/usr/bin/env python3
"""Isolated tests of raster-pack bounds, tile contents and generation identity."""
import array,importlib.util,io,json,pathlib,sqlite3,tempfile,unittest
from PIL import Image
spec=importlib.util.spec_from_file_location('egypt_maps',pathlib.Path(__file__).with_name('prepare-egypt-offline-maps.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MapTests(unittest.TestCase):
 def test_projection_round_trip(self):
  for lon,lat in [(31.2357,30.0444),(32.9,24.1),(25.5,29.2)]:
   x,y=m.project(lon,lat);l,a=m.unproject(x,y);self.assertAlmostEqual(l,lon,places=8);self.assertAlmostEqual(a,lat,places=8)
 def test_national_bounds_include_source_box(self):
  _,_,(w,s,e,n),_,_=m.PACKS[0]
  self.assertLessEqual(w,24.626276);self.assertLessEqual(s,21.983803);self.assertGreaterEqual(e,37.162628);self.assertGreaterEqual(n,32.52518)
 def test_all_pack_tile_limits(self):
  for ident,_,bounds,minz,maxz in m.PACKS:
   count=sum(len(m.tile_ranges(bounds,z)[0])*len(m.tile_ranges(bounds,z)[1]) for z in range(minz,maxz+1))
   self.assertLessEqual(count,m.MAX_TILES,ident)
 def test_real_road_raster_fixture_and_tms_identity(self):
  with tempfile.TemporaryDirectory(prefix='madar-map-test-') as d:
   out=pathlib.Path(d);db=sqlite3.connect(':memory:');db.executescript('create table ways(id integer primary key,kind text,name text,points blob);create virtual table bounds using rtree(id,minx,maxx,miny,maxy);create table places(id integer primary key,x real,y real,kind text,name text);')
   coords=[]
   for p in [(31.1,30.0),(31.2,30.1)]:coords.extend(m.project(*p))
   db.execute('insert into ways values(1,?,?,?)',('primary','test',array.array('f',coords).tobytes()))
   db.execute('insert into bounds values(1,?,?,?,?)',(min(coords[::2]),max(coords[::2]),min(coords[1::2]),max(coords[1::2])))
   record=m.render_pack(db,out,('fixture','fixture',(31.05,29.95,31.25,30.15),8,8),'test-only-source','test-only-boundary')
   rendered=sqlite3.connect(out/'fixture.mbtiles');rows=rendered.execute('select tile_column,tile_row,tile_data from tiles where zoom_level=8').fetchall()
   self.assertEqual(record['tileCount'],len(rows));self.assertEqual('ok',rendered.execute('pragma integrity_check').fetchone()[0])
   self.assertTrue(any(len(Image.open(io.BytesIO(data)).getcolors(65536))>1 for _,_,data in rows))
   expected={(x,(2**8)-1-y) for x in m.tile_ranges((31.05,29.95,31.25,30.15),8)[0] for y in m.tile_ranges((31.05,29.95,31.25,30.15),8)[1]}
   self.assertEqual(expected,{(x,y) for x,y,_ in rows});self.assertEqual(record['sha256'],m.sha(out/'fixture.mbtiles'));rendered.close();db.close()
if __name__=='__main__':unittest.main()
