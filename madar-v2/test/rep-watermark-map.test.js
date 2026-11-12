import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { buildWatermarkLines, compressAndWatermark, getWatermarkLayout } from '../client/src/modules/rep/image-processing.js';
import { isFreshGpsFix, orderMachinesByStraightLineDistance } from '../client/src/modules/rep/location-review.js';
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
  assert.match(lines[4], /المحافظة: غير متاحة.*الدقي/);
  assert.match(lines[5], /CIB-001.*ماكينة الدلتا/);
});

test('photo watermark names unavailable location explicitly and never infers a governorate', () => {
  const lines = buildWatermarkLines({
    machineCode: 'CIB-002', machineName: 'ماكينة', phase: 'before', capturedAt: new Date('2026-11-03T12:45:18Z'),
    location: null,
  });
  assert.match(lines[3], /GPS: الموقع غير متاح/);
  assert.match(lines[4], /المحافظة: غير متاحة/);
  assert.match(lines[4], /المنطقة المسجلة: غير متاحة/);
});

test('watermark processing returns JPEG bytes containing rendered MADAR logo and GPS/location text layers', async () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    Image: globalThis.Image,
    createImageBitmap: globalThis.createImageBitmap,
  };
  const icon = readFileSync(resolve('client/public/icon-192.png'));
  const xml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  class MockImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(_value) { this.complete = true; this.naturalWidth = 192; this.naturalHeight = 192; }
  }
  let width = 0;
  let height = 0;
  const operations = [];
  const context = {
    measureText(value) { return { width: String(value).length * 11 }; },
    drawImage(image, ...args) { operations.push({ type: 'image', image, args }); },
    fillRect(x, y, rectWidth, rectHeight) { operations.push({ type: 'rect', x, y, width: rectWidth, height: rectHeight, color: this.fillStyle }); },
    fillText(value, x, y) { operations.push({ type: 'text', value: String(value), x, y, font: this.font, color: this.fillStyle }); },
  };
  const canvas = {
    getContext() { return context; },
    toBlob(callback, type) {
      const layers = operations.map((operation) => {
        if (operation.type === 'rect') return `<rect x="${operation.x}" y="${operation.y}" width="${operation.width}" height="${operation.height}" fill="#07131f" fill-opacity=".82"/>`;
        if (operation.type === 'text') return `<text x="${operation.x}" y="${operation.y}" text-anchor="end" font-family="Arial" font-size="22" font-weight="800" fill="#fff">${xml(operation.value)}</text>`;
        if (operation.image === globalThis.__mockPhoto) return '';
        return `<image x="${operation.args[0]}" y="${operation.args[1]}" width="${operation.args[2]}" height="${operation.args[3]}" href="data:image/png;base64,${icon.toString('base64')}"/>`;
      }).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#9c3442"/>${layers}</svg>`;
      void sharp(Buffer.from(svg)).jpeg().toBuffer().then((bytes) => callback(new Blob([bytes], { type })));
    },
  };
  globalThis.window = { createImageBitmap: true };
  globalThis.Image = MockImage;
  globalThis.createImageBitmap = async () => globalThis.__mockPhoto;
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas');
    return new Proxy(canvas, { set(target, key, value) { if (key === 'width') width = value; if (key === 'height') height = value; target[key] = value; return true; } });
  } };
  globalThis.__mockPhoto = {};
  globalThis.__mockPhoto.width = 400;
  globalThis.__mockPhoto.height = 300;
  globalThis.__mockPhoto.close = () => {};
  try {
    const blob = await compressAndWatermark(new Blob(['source-photo']), {
      machineCode: 'CIB-099', machineName: 'ماكينة تجريبية', regionName: 'الدلتا', areaName: 'طنطا',
      phase: 'before', capturedAt: new Date('2026-11-03T12:45:18Z'),
      location: { latitude: 30.0444, longitude: 31.2357, accuracy: 8 },
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok(bytes.length > 1000);
    assert.ok(operations.some((operation) => operation.type === 'image' && operation.image !== globalThis.__mockPhoto), 'the MADAR logo is painted, not left as UI-only text');
    const stampedText = operations.filter((operation) => operation.type === 'text').map((operation) => operation.value).join('\n');
    for (const expected of ['30.04440, 31.23570', 'المحافظة: غير متاحة', 'CIB-099']) assert.ok(stampedText.includes(expected), expected);
    const logoOperation = operations.find((operation) => operation.type === 'image' && operation.image !== globalThis.__mockPhoto);
    const logoSize = getWatermarkLayout(width, height).logoSize;
    const logoPixels = await sharp(bytes).extract({ left: logoOperation.args[0], top: logoOperation.args[1], width: logoSize, height: logoSize }).raw().toBuffer();
    assert.ok(new Set(logoPixels).size > 20, 'decoded JPEG pixels retain visible logo detail');
  } finally {
    delete globalThis.__mockPhoto;
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete globalThis[key];
      else globalThis[key] = original[key];
    }
  }
});

test('approved machines sort by straight-line distance only from a fresh GPS fix; unapproved pins stay separate', () => {
  const gps = { latitude: 30.0444, longitude: 31.2357, accuracy: 8, updatedAt: new Date().toISOString() };
  const machines = [
    { machineCode: 'FAR', latitude: 30.1, longitude: 31.3, isLocationLocked: true, approvedLocation: { latitude: 30.1, longitude: 31.3 } },
    { machineCode: 'NEAR', latitude: 30.045, longitude: 31.236, isLocationLocked: true, approvedLocation: { latitude: 30.045, longitude: 31.236 } },
    { machineCode: 'UNSET', latitude: 30.04, longitude: 31.23, isLocationLocked: false, approvedLocation: null },
  ];
  assert.equal(isFreshGpsFix(gps), true);
  const ordered = orderMachinesByStraightLineDistance(machines, gps);
  assert.deepEqual(ordered.located.map((machine) => machine.machineCode), ['NEAR', 'FAR']);
  assert.ok(ordered.located[0].straightLineDistanceMeters < ordered.located[1].straightLineDistanceMeters);
  assert.deepEqual(ordered.needsLocation.map((machine) => machine.machineCode), ['UNSET']);
  assert.equal(Object.hasOwn(orderMachinesByStraightLineDistance(machines, null).located[0], 'straightLineDistanceMeters'), false);
  assert.equal(isFreshGpsFix({ ...gps, updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() }), false);
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
