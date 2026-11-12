import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  mergeMachineActions,
  REP_RECOVERY_PACKAGE_TYPE,
  REP_RECOVERY_SCHEMA_VERSION,
  sha256Hex,
  sha256Json,
  validateRepRecoveryPackage,
} from '../client/src/modules/rep/queue-recovery.js';

globalThis.crypto ??= webcrypto;

const repId = 41;
const sessionId = 'b62a930f-083d-4a0e-9d2c-e50e1c953769';
const visitUuid = 'f712ce53-b00d-4720-a802-79412adfac11';
const actionUuid = '48fd08d4-3844-451c-a0bf-343e3d9874b2';
const bytesBase64 = Buffer.from('real image evidence bytes').toString('base64');

async function file() {
  const bytes = Buffer.from(bytesBase64, 'base64');
  return { name: 'evidence.jpg', mimeType: 'image/jpeg', byteSize: bytes.length, bytesBase64, sha256: await sha256Hex(bytes) };
}

async function recoveryPackage() {
  const evidence = await file();
  const visit = { visitUuid, repId, payload: { cardId: 9, machineCode: 'M-9' }, beforePhotos: [evidence, evidence, evidence], afterPhotos: [], status: 'queued', provenance: 'native-sqlite' };
  visit.identity = {
    visitUuid, repId, payload: visit.payload,
    beforeHashes: [evidence.sha256, evidence.sha256, evidence.sha256], afterHashes: [],
    beforeCapturedAt: ['', '', ''], afterCapturedAt: [],
  };
visit.identityHash = await sha256Json(visit.identity);
const action = { actionUuid, repId, type: 'report_correction', machineId: 4, cardId: 9, payload: { cardId: 9, reportedCode: 'X' }, evidence, status: 'blocked', provenance: 'native-sqlite' };
action.identity = { actionUuid, repId, type: action.type, machineId: action.machineId, cardId: action.cardId, payload: action.payload, evidenceSha256: evidence.sha256 };
action.identityHash = await sha256Json(action.identity);
const attendance = { actionUuid: '80483995-ae4e-4f06-85c0-2e8e73d4da4d', repId, action: 'in', status: 'attendance_rejected', provenance: 'native-sqlite' };
attendance.payload = { actionUuid: attendance.actionUuid, repId, action: 'in', occurredAt: '2026-11-11T09:00:00.000Z', biometricVerified: true, location: { latitude: 25, longitude: 55, accuracy: 8 } };
  attendance.identity = { actionUuid: attendance.actionUuid, repId, action: 'in', payload: attendance.payload };
attendance.identityHash = await sha256Json(attendance.identity);
const point = { trackId: 8, repId, timestamp: 1770000000000, capturedAt: new Date(1770000000000).toISOString(), latitude: 25, longitude: 55, accuracy: 8, speed: 0, status: 'pending', provenance: 'native-gps-sqlite' };
point.identity = { trackId: 8, repId, timestamp: point.timestamp, latitude: 25, longitude: 55, accuracy: 8, speed: 0, reason: '' };
point.identityHash = await sha256Json(point.identity);
return {
  type: REP_RECOVERY_PACKAGE_TYPE,
    schemaVersion: REP_RECOVERY_SCHEMA_VERSION,
    repId,
    repUsername: 'rep-a',
    localSessionId: sessionId,
    complete: true,
    omissions: [],
    visits: [visit],
    machineActions: [action],
    attendanceActions: [attendance],
    pendingGpsPoints: [point],
    rejectedGpsPoints: [],
  };
}

test('validates and preserves actual visit and machine evidence bytes in a recovery package', async () => {
  const recovery = await recoveryPackage();
  const checked = await validateRepRecoveryPackage(JSON.stringify(recovery), repId);
  assert.equal(Buffer.from(checked.visits[0].beforePhotos[0].bytesBase64, 'base64').toString(), 'real image evidence bytes');
  assert.equal(Buffer.from(checked.machineActions[0].evidence.bytesBase64, 'base64').toString(), 'real image evidence bytes');
});

test('rejects account changes, corrupt hashes, and packages that report omissions', async () => {
const recovery = await recoveryPackage();
await assert.rejects(validateRepRecoveryPackage(recovery, repId + 1), /different representative/);
const corrupt = structuredClone(recovery);
corrupt.visits[0].beforePhotos[0].bytesBase64 = Buffer.from('changed bytes').toString('base64');
await assert.rejects(validateRepRecoveryPackage(corrupt, repId), /SHA-256|declared file size/);
const incomplete = structuredClone(recovery);
incomplete.complete = false;
incomplete.omissions = [{ type: 'evidence', id: actionUuid }];
await assert.rejects(validateRepRecoveryPackage(incomplete, repId), /incomplete/);
});

test('native-only actions are merged once; changed UUID content is a surfaced conflict', () => {
  const native = { actionUuid, repId, type: 'report_correction', machineId: 4, cardId: 9, payload: { cardId: 9, reportedCode: 'X' }, status: 'blocked' };
  assert.equal(mergeMachineActions([], [native], repId).length, 1);
  assert.equal(mergeMachineActions([{ ...native, status: 'queued' }], [native], repId).length, 1);
  assert.throws(() => mergeMachineActions([{ ...native, payload: { cardId: 9, reportedCode: 'Y' } }], [native], repId), /conflicting local content/);
  assert.throws(() => mergeMachineActions([], [{ ...native, repId: repId + 1 }], repId), /ownership/);
});


test('rejects changed payloads and GPS fields even when the old identity hash remains valid', async () => {
  for (const queue of ['visits', 'machineActions', 'attendanceActions', 'pendingGpsPoints']) {
    const recovery = await recoveryPackage();
    if (queue === 'pendingGpsPoints') recovery[queue][0].latitude = 26;
    else recovery[queue][0].payload.changed = true;
    // Keep the signed content snapshot unchanged, as it would be in a tampered archive.
    if (queue === 'attendanceActions') recovery[queue][0].identity.payload = { ...recovery[queue][0].identity.payload };
    // Avoid fixture object aliasing before changing the outer payload.
    const original = await recoveryPackage();
    recovery[queue][0].identity = original[queue][0].identity;
    await assert.rejects(validateRepRecoveryPackage(recovery, repId), /immutable|identity/);
  }
});

test('rejects a GPS capture time changed independently of its durable timestamp', async () => {
  const recovery = await recoveryPackage();
  recovery.pendingGpsPoints[0].capturedAt = '2026-01-01T00:00:00.000Z';
  await assert.rejects(validateRepRecoveryPackage(recovery, repId), /identity/);
});
