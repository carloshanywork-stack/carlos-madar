import assert from 'node:assert/strict';
import test from 'node:test';
import { validVisitPhotoCounts } from '../shared/visit-photo-policy.js';
import { normalizeNativeVisitPhotoResults } from '../client/src/modules/rep/camera-photo-results.js';
test('new visits require both phases; optional legacy After remains recoverable; limits are bounded', () => {
  for (const n of [1, 4, 20]) assert.equal(validVisitPhotoCounts(2, n, n), true);
  for (const [policy, before, after] of [[2,0,1],[2,1,0],[2,21,1],[2,1,21],[3,3,3],[null,3,3],['2',1,1],[undefined,1,1]]) assert.equal(validVisitPhotoCounts(policy,before,after),false);
  assert.equal(validVisitPhotoCounts(undefined,3,0),true);
  assert.equal(validVisitPhotoCounts(undefined,3,3),true);
});
test('native multi-shot handoff preserves twenty actual objects and rejects an over-limit group', () => {
  const photos = Array.from({length:20},(_,i)=>({
    sourceUri:`file:///capture-${i}.jpg`,
    capturedAt:'2026-11-14T10:00:00Z',
    captureId:`10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    photoIndex:i,
    location:null,
  }));
  assert.equal(normalizeNativeVisitPhotoResults({photos}).length,20);
  assert.throws(()=>normalizeNativeVisitPhotoResults({photos:[...photos,photos[0]]}));
});
