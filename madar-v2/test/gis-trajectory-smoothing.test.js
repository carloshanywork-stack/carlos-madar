import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDistanceMeters,
  filterGpsAccuracy,
  suppressStationaryJitter,
  smoothTrajectoryOutliers,
  smoothPolyline,
  DEFAULT_ACCURACY_THRESHOLD,
  DEFAULT_STATIONARY_THRESHOLD,
} from '../client/src/modules/supervisor/trajectory-smoothing.js';

test('calculateDistanceMeters computes accurate surface distance between coordinates', () => {
  // Distance between two known points in Cairo / Qalyubia
  const dist = calculateDistanceMeters(30.2470, 31.4870, 30.2470, 31.4880);
  // ~96 meters longitudinally at latitude 30.247
  assert.ok(dist >= 94 && dist <= 98, `Expected ~96m, got ${dist}`);

  // Zero distance for identical points
  assert.equal(calculateDistanceMeters(30.2470, 31.4870, 30.2470, 31.4870), 0);

  // Handles non-finite inputs gracefully
  assert.equal(calculateDistanceMeters(null, undefined, 30.2470, 31.4870), 0);
});

test('GPS accuracy filtering strictly rejects coarse fixes exceeding 15m threshold', () => {
  const points = [
    { latitude: 30.2471, longitude: 31.4871, accuracy: 5.2 },
    { latitude: 30.2472, longitude: 31.4872, accuracy: 14.8 },
    { latitude: 30.2473, longitude: 31.4873, accuracy: 15.0 }, // boundary: accepted
    { latitude: 30.2474, longitude: 31.4874, accuracy: 15.1 }, // rejected
    { latitude: 30.2475, longitude: 31.4875, accuracy: 42.7 }, // Belbaisi coarse fix: rejected
    { latitude: 30.2476, longitude: 31.4876, accuracy: 100.0 }, // rejected
    { latitude: 30.2477, longitude: 31.4877, accuracy: 2632.1 }, // cellular tower fix: rejected
    { latitude: 30.2478, longitude: 31.4878, accuracy: 8.0 }, // accepted
    { latitude: 30.2479, longitude: 31.4879, accuracy: Infinity }, // non-finite: rejected
    { latitude: 30.2480, longitude: 31.4880, accuracy: NaN }, // non-finite: rejected
  ];

  const filtered = filterGpsAccuracy(points, DEFAULT_ACCURACY_THRESHOLD);
  assert.equal(filtered.length, 4);
  assert.deepEqual(
    filtered.map((p) => p.accuracy),
    [5.2, 14.8, 15.0, 8.0]
  );
  assert.ok(filtered.every((p) => p.accuracy <= 15));
});

test('Stationary jitter suppression collapses points < 12m apart into a single anchor node', () => {
  // Base coordinate at a stationary stop
  const baseLat = 30.24744;
  const baseLon = 31.48742;

  // 10 micro-jitter points oscillating within a 1m to 8m radius
  const stationaryJitterPoints = [
    { latitude: baseLat, longitude: baseLon, accuracy: 4.0 },
    { latitude: baseLat + 0.00002, longitude: baseLon + 0.00003, accuracy: 4.2 }, // ~3.5m
    { latitude: baseLat - 0.00003, longitude: baseLon - 0.00001, accuracy: 3.8 }, // ~3.4m
    { latitude: baseLat + 0.00004, longitude: baseLon - 0.00002, accuracy: 4.5 }, // ~4.8m
    { latitude: baseLat - 0.00001, longitude: baseLon + 0.00005, accuracy: 5.0 }, // ~4.9m
    { latitude: baseLat + 0.00006, longitude: baseLon + 0.00004, accuracy: 4.1 }, // ~7.7m
    { latitude: baseLat, longitude: baseLon + 0.00002, accuracy: 3.9 }, // ~1.9m
    { latitude: baseLat - 0.00004, longitude: baseLon + 0.00001, accuracy: 4.0 }, // ~4.5m
    { latitude: baseLat + 0.00003, longitude: baseLon - 0.00004, accuracy: 4.3 }, // ~5.0m
    { latitude: baseLat + 0.00001, longitude: baseLon + 0.00001, accuracy: 3.6 }, // ~1.4m
  ];

  // Verify all points are indeed < 12m from the first point
  for (const pt of stationaryJitterPoints) {
    const d = calculateDistanceMeters(baseLat, baseLon, pt.latitude, pt.longitude);
    assert.ok(d < DEFAULT_STATIONARY_THRESHOLD, `Test fixture error: point is ${d}m away`);
  }

  const collapsed = suppressStationaryJitter(stationaryJitterPoints, DEFAULT_STATIONARY_THRESHOLD);
  // All 10 points must collapse into exactly 1 anchor node (zero spiderwebs or zig-zags)
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].latitude, baseLat);
  assert.equal(collapsed[0].longitude, baseLon);
});

test('Stationary jitter suppression preserves legitimate transit movement (>= 12m)', () => {
  const routePoints = [
    { latitude: 30.2470, longitude: 31.4870, accuracy: 4 }, // Start
    { latitude: 30.24703, longitude: 31.48702, accuracy: 4 }, // ~4m: collapsed
    { latitude: 30.2472, longitude: 31.4870, accuracy: 4 }, // ~22m: kept (movement)
    { latitude: 30.24724, longitude: 31.48702, accuracy: 4 }, // ~5m: collapsed
    { latitude: 30.2475, longitude: 31.4870, accuracy: 4 }, // ~33m: kept (movement)
    { latitude: 30.2478, longitude: 31.4870, accuracy: 4 }, // ~33m: kept (movement)
  ];

  const smoothed = suppressStationaryJitter(routePoints, DEFAULT_STATIONARY_THRESHOLD);
  assert.equal(smoothed.length, 4);
  assert.equal(smoothed[0].latitude, 30.2470);
  assert.equal(smoothed[1].latitude, 30.2472);
  assert.equal(smoothed[2].latitude, 30.2475);
  assert.equal(smoothed[3].latitude, 30.2478);
});

test('Trajectory continuity along Belbaisi drain and Abu Hashin mosque reference corridor rejects building jumps', () => {
  // Reference corridor along the road between Belbaisi drain and Abu Hashin mosque
  const baseTime = Date.parse('2026-11-13T10:00:00.000Z');

  const corridorPoints = [
    // Point 1: Moving along road
    { latitude: 30.24710, longitude: 31.48710, accuracy: 5.0, recordedAt: new Date(baseTime).toISOString() },
    // Point 2: 25m along road
    { latitude: 30.24730, longitude: 31.48715, accuracy: 4.8, recordedAt: new Date(baseTime + 10000).toISOString() },
    // Point 3: Coarse jump (42.7m accuracy) into the Belbaisi drain
    { latitude: 30.24768, longitude: 31.48780, accuracy: 42.7, recordedAt: new Date(baseTime + 15000).toISOString() },
    // Point 4: Back on the road
    { latitude: 30.24755, longitude: 31.48720, accuracy: 5.5, recordedAt: new Date(baseTime + 20000).toISOString() },
    // Point 5: Acute multipath spike jumping 70m laterally into a building near Abu Hashin mosque
    // (deflection > 140 degrees with immediate 5-second snap-back)
    { latitude: 30.24810, longitude: 31.48790, accuracy: 8.0, recordedAt: new Date(baseTime + 25000).toISOString() },
    // Point 6: Next road coordinate 22m ahead of Point 4
    { latitude: 30.24775, longitude: 31.48725, accuracy: 4.2, recordedAt: new Date(baseTime + 30000).toISOString() },
    // Point 7: Coarse jump (55.1m accuracy) across canal
    { latitude: 30.24820, longitude: 31.48820, accuracy: 55.1, recordedAt: new Date(baseTime + 35000).toISOString() },
    // Point 8: Arrival at stop near Abu Hashin mosque
    { latitude: 30.24795, longitude: 31.48730, accuracy: 3.5, recordedAt: new Date(baseTime + 40000).toISOString() },
    // Points 9-11: Stationary dwell at the mosque (< 12m jitter)
    { latitude: 30.24796, longitude: 31.48732, accuracy: 3.8, recordedAt: new Date(baseTime + 45000).toISOString() },
    { latitude: 30.24794, longitude: 31.48729, accuracy: 4.0, recordedAt: new Date(baseTime + 50000).toISOString() },
    { latitude: 30.24797, longitude: 31.48731, accuracy: 3.6, recordedAt: new Date(baseTime + 55000).toISOString() },
  ];

  const stops = [
    {
      latitude: 30.24795,
      longitude: 31.48730,
      arrivedAt: new Date(baseTime + 40000).toISOString(),
      departedAt: new Date(baseTime + 60000).toISOString(),
    },
  ];

  const smoothed = smoothPolyline(corridorPoints, stops);

  // 1. Both coarse fixes (42.7m and 55.1m) must be completely eliminated
  assert.ok(smoothed.every((p) => Number(p.accuracy) <= 15), 'All points must have accuracy <= 15');
  assert.ok(!smoothed.some((p) => p.accuracy === 42.7), 'Belbaisi 42.7m coarse point must be removed');
  assert.ok(!smoothed.some((p) => p.accuracy === 55.1), 'Belbaisi 55.1m coarse point must be removed');

  // 2. The acute building-jump spike (Point 5 at 30.24810, 31.48790) must be rejected
  assert.ok(
    !smoothed.some((p) => Math.abs(p.latitude - 30.24810) < 0.00001 && Math.abs(p.longitude - 31.48790) < 0.00001),
    'Abu Hashin mosque building-penetrating spike must be rejected'
  );

  // 3. Stationary jitter at stop (Points 8-11) must be collapsed to single stop node
  const stopPoints = smoothed.filter((p) => Math.abs(p.latitude - 30.24795) < 0.0001);
  assert.equal(stopPoints.length, 1, 'Stationary stop at Abu Hashin mosque must collapse to 1 node');

  // 4. Resulting polyline is continuous and clean
  assert.ok(smoothed.length >= 3 && smoothed.length <= 5, `Expected 4 smoothed points, got ${smoothed.length}`);
  // Verify progressive progression along the road
  for (let i = 1; i < smoothed.length; i += 1) {
    const segmentDist = calculateDistanceMeters(
      smoothed[i - 1].latitude, smoothed[i - 1].longitude,
      smoothed[i].latitude, smoothed[i].longitude
    );
    assert.ok(segmentDist >= 12, `Segment ${i} displacement must be >= 12m, got ${segmentDist}m`);
    assert.ok(segmentDist < 100, `Segment ${i} distance should not have wild jumps, got ${segmentDist}m`);
  }
});
