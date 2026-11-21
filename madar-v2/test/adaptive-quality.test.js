import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUALITY_TIERS,
  evaluateAdaptiveTier,
  getStoredQualityPreference,
  setStoredQualityPreference,
} from '../client/src/lib/adaptive-quality.js';

test('QUALITY_TIERS contains complete definitions for all tiers with safe bounded limits', () => {
  const tiers = ['conservative', 'balanced', 'high', 'ultra'];
  for (const tier of tiers) {
    const config = QUALITY_TIERS[tier];
    assert.ok(config, `Missing tier definition for ${tier}`);
    assert.ok(config.label, 'Missing Arabic label');
    assert.ok(Number.isFinite(config.previewSize) && config.previewSize >= 800);
    assert.ok(Number.isFinite(config.maxCacheBytes) && config.maxCacheBytes > 0);
    assert.ok(Number.isFinite(config.prefetchWindow) && config.prefetchWindow >= 0);
    assert.ok(Number.isFinite(config.maxConcurrentDecodes) && config.maxConcurrentDecodes >= 1);
  }

  // Verify progression: conservative < balanced < high < ultra
  assert.ok(QUALITY_TIERS.conservative.previewSize < QUALITY_TIERS.balanced.previewSize);
  assert.ok(QUALITY_TIERS.balanced.previewSize < QUALITY_TIERS.high.previewSize);
  assert.ok(QUALITY_TIERS.high.previewSize < QUALITY_TIERS.ultra.previewSize);

  assert.ok(QUALITY_TIERS.conservative.maxCacheBytes < QUALITY_TIERS.balanced.maxCacheBytes);
  assert.ok(QUALITY_TIERS.balanced.maxCacheBytes < QUALITY_TIERS.high.maxCacheBytes);
  assert.ok(QUALITY_TIERS.high.maxCacheBytes < QUALITY_TIERS.ultra.maxCacheBytes);
});

test('evaluateAdaptiveTier selects conservative tier for low RAM or constrained CPU', () => {
  // Low memory (<= 4GB)
  assert.equal(evaluateAdaptiveTier({ totalMemoryGb: 4, cpuCores: 8 }), 'conservative');
  assert.equal(evaluateAdaptiveTier({ totalMemoryGb: 2, cpuCores: 4 }), 'conservative');

  // Low CPU cores (<= 2)
  assert.equal(evaluateAdaptiveTier({ totalMemoryGb: 16, cpuCores: 2 }), 'conservative');

  // Low free disk space (< 2GB)
  assert.equal(evaluateAdaptiveTier({ totalMemoryGb: 16, cpuCores: 8, freeDiskGb: 1 }), 'conservative');

  // Battery discharging (resource conservation mode)
  assert.equal(evaluateAdaptiveTier({ totalMemoryGb: 16, cpuCores: 8, isBatteryDischarging: true }), 'conservative');
});

test('evaluateAdaptiveTier selects ultra tier for high-spec workstations', () => {
  // 16GB+ RAM, 8+ cores, 4K screen
  assert.equal(evaluateAdaptiveTier({
    totalMemoryGb: 32,
    cpuCores: 16,
    width: 3840,
    height: 2160,
    dpr: 1.5,
    freeDiskGb: 100,
  }), 'ultra');

  // 16GB RAM, 8 cores, 1080p display with High-DPI (Retina / 2x scale)
  assert.equal(evaluateAdaptiveTier({
    totalMemoryGb: 16,
    cpuCores: 8,
    width: 1920,
    height: 1080,
    dpr: 2,
    freeDiskGb: 50,
  }), 'ultra');
});

test('evaluateAdaptiveTier selects high tier for capable standard desktop PCs', () => {
  // 8GB RAM, 6 cores, 1080p screen
  assert.equal(evaluateAdaptiveTier({
    totalMemoryGb: 8,
    cpuCores: 6,
    width: 1920,
    height: 1080,
    dpr: 1,
    freeDiskGb: 30,
  }), 'high');

  // 8GB RAM, 4 cores, High-DPI display (dpr 1.5)
  assert.equal(evaluateAdaptiveTier({
    totalMemoryGb: 8,
    cpuCores: 4,
    width: 1920,
    height: 1080,
    dpr: 1.5,
    freeDiskGb: 30,
  }), 'high');
});

test('evaluateAdaptiveTier selects balanced tier for intermediate standard machines', () => {
  // 6GB RAM, 4 cores, 1366x768 or 1600x900 screen
  assert.equal(evaluateAdaptiveTier({
    totalMemoryGb: 6,
    cpuCores: 4,
    width: 1600,
    height: 900,
    dpr: 1,
    freeDiskGb: 20,
  }), 'balanced');
});

test('user preference override handling in non-browser environment defaults safely', () => {
  // Without localStorage, defaults to 'auto'
  assert.equal(getStoredQualityPreference(), 'auto');
  // Setting preference does not crash outside browser
  assert.doesNotThrow(() => setStoredQualityPreference('ultra'));
});
