import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from '../madar-v2/node_modules/sharp/dist/index.mjs';
import { db } from '../madar-v2/server/database/connection.js';
import { createSession } from '../madar-v2/server/modules/auth/service.js';

const BASE_URL = 'http://127.0.0.1:3000';
const REP_USERNAME = 'meicheal';

console.log('🚀 Starting Full Field Representative End-to-End Simulation against Live Server...');

async function runSimulation() {
  // 1. Authenticate Rep
  console.log('📌 1. Authenticating representative & creating session...');
  const user = db.prepare('SELECT * FROM users WHERE id = 10').get();
  assert.ok(user, 'User meicheal must exist');
  const repToken = createSession(user, db);
  const cookie = `madar_token=${repToken}`;
  console.log('   ✅ Valid representative session created for meicheal (ID 10).');

  const headers = {
    'X-App-Version-Code': '29',
    'x-madar-native-client': 'android',
    'Authorization': `Bearer ${repToken}`,
    'Cookie': cookie,
  };

  // 2. Verify Server Date Header (Time Calibration)
  console.log('📌 2. Verifying HTTP Date Header for Mobile Time Calibration...');
  const pingRes = await fetch(`${BASE_URL}/download/apk/status`, {
    headers: { 'X-App-Version-Code': '29' },
  });
  const serverDateHeader = pingRes.headers.get('date');
  assert.ok(serverDateHeader, 'Server must return HTTP Date header');
  const serverTime = Date.parse(serverDateHeader);
  const localTime = Date.now();
  const drift = Math.abs(serverTime - localTime);
  console.log(`   ✅ HTTP Date Header: "${serverDateHeader}" (Server Time: ${serverTime}, Drift: ${drift}ms)`);
  assert.ok(drift < 60000, 'Drift should be within normal bounds');

  // 3. Query Today Route
  console.log('📌 3. Fetching Today Route for meicheal...');
  const routeRes = await fetch(`${BASE_URL}/api/rep/today-route`, { headers });
  assert.equal(routeRes.status, 200, 'Today route must return 200');
  const route = await routeRes.json();
  console.log(`   ✅ Route summary: total=${route.summary.totalMachines}, pending=${route.summary.pending}, completed=${route.summary.completed}`);
  assert.ok(route.summary.totalMachines >= 1, 'Today route must contain assigned machines');
  const targetCard = route.regions.flatMap(r => r.machines).find(m => m.cardId === 1990);
  assert.ok(targetCard, 'Target test card 1990 must be in today route');
  console.log(`   ✅ Found target machine: ${targetCard.machineCode} (Card ${targetCard.cardId}, Status: ${targetCard.workStatus})`);

  // 4. Start Machine Work (Claim Lease)
  console.log('📌 4. Testing Machine Work Lease & Crash Reclaim...');
  db.prepare('DELETE FROM rep_machine_work_leases WHERE card_id = 1990').run();
  db.prepare('DELETE FROM rep_visit_photos WHERE visit_id IN (SELECT id FROM rep_visits WHERE card_id = 1990)').run();
  db.prepare('DELETE FROM rep_visits WHERE card_id = 1990').run();
  
  const visitUuid = randomUUID();
  const testLocation = {
    latitude: 30.14619,
    longitude: 31.37397,
    accuracy: 25,
    updatedAt: new Date().toISOString(),
    isMock: false,
  };

  const startWorkRes = await fetch(`${BASE_URL}/api/rep/machines/1990/start-work`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitUuid, location: testLocation }),
  });
  const startWorkData = await startWorkRes.json();
  if (!startWorkRes.ok) {
    console.error('start-work error response:', startWorkData);
  }
  assert.equal(startWorkRes.status, 200, 'start-work must return 200');
  console.log(`   ✅ Lease claimed: status=${startWorkData.status}, expiresAt=${startWorkData.expiresAt}`);

  // Test Idempotent Retry (Same visitUuid)
  const retryWorkRes = await fetch(`${BASE_URL}/api/rep/machines/1990/start-work`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitUuid, location: testLocation }),
  });
  assert.equal(retryWorkRes.status, 200);
  const retryWorkData = await retryWorkRes.json();
  assert.equal(retryWorkData.idempotent, true, 'Same visitUuid claim must be idempotent');
  console.log('   ✅ Idempotent claim verified: idempotent=true');

  // Test Conflicting Claim Without Reclaim (Different visitUuid -> 409)
  const conflictUuid = randomUUID();
  const conflictWorkRes = await fetch(`${BASE_URL}/api/rep/machines/1990/start-work`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitUuid: conflictUuid, location: testLocation }),
  });
  assert.equal(conflictWorkRes.status, 409, 'Different visitUuid without reclaim must return 409 Conflict');
  console.log('   ✅ Conflict protection verified: returned 409 Conflict');

  // Test Crash Survival / Reclaim (Different visitUuid WITH reclaim: true)
  const reclaimWorkRes = await fetch(`${BASE_URL}/api/rep/machines/1990/start-work`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitUuid: conflictUuid, location: testLocation, reclaim: true }),
  });
  assert.equal(reclaimWorkRes.status, 200, 'Reclaim with reclaim=true must return 200');
  console.log('   ✅ Reclaim Lease after crash simulation verified: returned 200 OK');

  // 5. Submit Visit with Photos
  console.log('📌 5. Testing Visit Sync & Compressed Photo Ingestion...');
  const beforePhotoBuffer = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 128, b: 128 } }
  }).jpeg().toBuffer();
  const afterPhotoBuffer = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 128, g: 0, b: 128 } }
  }).jpeg().toBuffer();

  const formData = new FormData();
  formData.append('visit', JSON.stringify({
    visitUuid: conflictUuid,
    cardId: 1990,
    machineCode: 'TEST-ATM-47B870AAE52F488A9628B3CAFD462542',
    regionName: 'تجريبي',
    machineCondition: 'working',
    reasonIds: [],
    maintenanceLines: [],
    notes: 'تمت المحاكاة الميدانية بنجاح - اختبار التحصين والاستقرار',
    photoPolicyVersion: 2,
    capturedAt: new Date().toISOString(),
    beforeCapturedAt: [new Date().toISOString()],
    afterCapturedAt: [new Date().toISOString()],
    location: testLocation,
  }));
  formData.append('beforePhoto', new Blob([beforePhotoBuffer], { type: 'image/jpeg' }), 'before-1.jpg');
  formData.append('afterPhoto', new Blob([afterPhotoBuffer], { type: 'image/jpeg' }), 'after-1.jpg');

  const visitSyncRes = await fetch(`${BASE_URL}/api/rep/sync-visit`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const visitSyncData = await visitSyncRes.json();
  if (!visitSyncRes.ok) {
    console.error('sync-visit error response:', visitSyncData);
  }
  assert.equal(visitSyncRes.status, 200, 'sync-visit must return 200');
  console.log(`   ✅ Visit synced: success=${visitSyncData.success}, visitId=${visitSyncData.visitId}`);

  // 6. Verify Attendance & Clock-Out
  console.log('📌 6. Testing Attendance Verification & Clock-Out...');
  db.prepare("UPDATE employee_daily_attendance SET clock_out_time = NULL, total_hours = 0 WHERE employee_id = 14 AND work_date = ?").run(new Date().toISOString().slice(0, 10));
  const clockOutAction = {
    actionUuid: randomUUID(),
    action: 'out',
    occurredAt: new Date().toISOString(),
    biometricVerified: true,
    location: testLocation,
  };
  const clockOutRes = await fetch(`${BASE_URL}/api/rep/attendance/sync`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(clockOutAction),
  });
  const clockOutData = await clockOutRes.json();
  if (!clockOutRes.ok) {
    console.error('clock-out error response:', clockOutData);
  }
  assert.equal(clockOutRes.status, 200, 'clock-out sync must return 200');
  console.log(`   ✅ Clock-out synced: success=${clockOutData.success}, workDate=${clockOutData.attendance?.workDate}`);

  // 7. Verify Database State
  console.log('📌 7. Verifying SQLite Database State...');
  const attRecord = db.prepare('SELECT id, employee_id, work_date, status, clock_in_time, clock_out_time, total_hours FROM employee_daily_attendance WHERE employee_id = 14 AND work_date = ?').get(new Date().toISOString().slice(0, 10));
  console.log('   ✅ Daily Attendance Record:', attRecord);
  assert.ok(attRecord, 'Attendance record must exist');
  assert.ok(attRecord.clock_in_time, 'clock_in_time must be populated');
  assert.ok(attRecord.clock_out_time, 'clock_out_time must be populated');

  const savedVisit = db.prepare('SELECT id, card_id, rep_user_id, status FROM rep_visits WHERE visit_uuid = ?').get(conflictUuid);
  console.log('   ✅ Saved Visit Record:', savedVisit);
  assert.ok(savedVisit, 'Visit must exist in rep_visits');

  const savedPhotos = db.prepare('SELECT id, visit_id, phase, stored_path FROM rep_visit_photos WHERE visit_id = ?').all(savedVisit.id);
  console.log(`   ✅ Saved Photos Count: ${savedPhotos.length}`);
  assert.equal(savedPhotos.length, 2, 'Must have 2 photos saved');

  console.log('\n🎉 ALL LIVE FIELD REPRESENTATIVE SIMULATION TESTS PASSED 100%! 🎉\n');
}

runSimulation().catch(err => {
  console.error('❌ Simulation Error:', err);
  process.exit(1);
});
