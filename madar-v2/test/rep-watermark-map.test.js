import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWatermarkLines, getWatermarkLayout } from '../client/src/modules/rep/image-processing.js';
import {
  getVisibleTileCoordinates,
  googleMapsNavigationUrl,
  projectToWorld,
  unprojectFromWorld,
} from '../client/src/modules/rep/map-utils.js';

test('photo watermark includes Cairo date, Arabic weekday, seconds, GPS, region, machine identity and visit phase', () => {
  const lines = buildWatermarkLines({
    machineCode: 'CIB-001',
    machineName: 'ماكينة الدلتا',
    regionName: 'محافظة القاهرة',
    areaName: 'الدقي',
    phase: 'before',
    capturedAt: new Date('2026-11-03T12:45:18.000Z'),
    location: { latitude: 30.0444, longitude: 31.2357, accuracy: 8 },
  });
  assert.equal(lines.length, 6);
  assert.match(lines[0], /قبل الصيانة/);
  assert.match(lines[1], /2026-11-03.*الثلاثاء/);
  assert.match(lines[2], /02:45:18 PM/);
  assert.match(lines[3], /30\.04440, 31\.23570.*8م/);
  assert.match(lines[4], /محافظة القاهرة.*الدقي/);
  assert.match(lines[5], /CIB-001.*ماكينة الدلتا/);
});

test('watermark badge stays on the physical left edge and reserves a readable six-line panel', () => {
  const layout = getWatermarkLayout(1600, 900);
  assert.ok(layout.fontSize >= 30);
  assert.equal(layout.panelWidth, 928);
  assert.equal(layout.panelTop + layout.panelHeight, 900);
  assert.ok(layout.panelHeight >= layout.lineHeight * 6);
});

test('Google Maps navigation prefers the machine GPS pin and safely falls back to address search', () => {
  const url = new URL(googleMapsNavigationUrl({ latitude: 30.0444, longitude: 31.2357, address: 'Downtown' }));
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.pathname, '/maps/dir/');
  assert.equal(url.searchParams.get('destination'), '30.0444,31.2357');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  const addressUrl = new URL(googleMapsNavigationUrl({ address: 'الدقي، القاهرة' }));
  assert.equal(addressUrl.pathname, '/maps/search/');
  assert.equal(addressUrl.searchParams.get('query'), 'الدقي، القاهرة');
  assert.equal(googleMapsNavigationUrl({}), null);
});

test('offline map projection round-trips coordinates and resolves the expected Cairo raster tile', () => {
  const location = { latitude: 30.0444, longitude: 31.2357 };
  const world = projectToWorld(location, 8);
  const roundTrip = unprojectFromWorld(world, 8);
  assert.ok(Math.abs(roundTrip.latitude - location.latitude) < 1e-8);
  assert.ok(Math.abs(roundTrip.longitude - location.longitude) < 1e-8);
  assert.ok(getVisibleTileCoordinates(location, 8, 256, 256).some((tile) => tile.z === 8 && tile.x === 150 && tile.y === 105));
});
