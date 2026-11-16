#!/usr/bin/env node
// Records the verified local release APK in the apk_releases distribution
// registry without needing an admin browser session. The same verification as
// POST /api/system/rep-releases/publish is applied (clean release manifest,
// artifact SHA-256, approved signer fingerprint), and the change is audited.
//
// Usage: node scripts/record-release.mjs <adminUserId> [notes]
import { db } from '../server/database/connection.js';
import { recordVerifiedRelease } from '../server/modules/system/rep-release-routes.js';

const actorId = Number(process.argv[2]);
const notes = process.argv.slice(3).join(' ').trim() || null;
if (!Number.isSafeInteger(actorId) || actorId < 1) {
  console.error('Usage: node scripts/record-release.mjs <adminUserId> [notes]');
  process.exit(2);
}

const admin = db.prepare(
  "SELECT id, username FROM users WHERE id = ? AND role = 'admin' AND active = 1 AND deleted_at IS NULL",
).get(actorId);
if (!admin) {
  console.error(`User ${actorId} is not an active administrator.`);
  db.close();
  process.exit(2);
}

try {
  const release = recordVerifiedRelease({ actorId, notes });
  console.log(JSON.stringify({ status: 'RECORDED', actor: admin.username, release }, null, 2));
} catch (error) {
  console.error(`Release was not recorded: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (db.open) db.close();
}
