#!/usr/bin/env node
// Records the verified local release APK in the apk_releases distribution
// registry without needing an admin browser session. The same verification as
// POST /api/system/rep-releases/publish is applied (clean release manifest,
// artifact SHA-256, approved signer fingerprint), and the change is audited.
//
// Usage: node scripts/record-release.mjs <adminUserId> [--manager|--system] [notes]
import { db } from '../server/database/connection.js';
import { recordVerifiedRelease } from '../server/modules/system/rep-release-routes.js';

const rawArgs = process.argv.slice(2);
const isManager = rawArgs.includes('--manager') || rawArgs.includes('--system');
const args = rawArgs.filter((arg) => arg !== '--manager' && arg !== '--system');
const actorId = Number(args[0]);
const notes = args.slice(1).join(' ').trim() || null;
const target = isManager ? 'system' : 'rep';
if (!Number.isSafeInteger(actorId) || actorId < 1) {
  console.error('Usage: node scripts/record-release.mjs <adminUserId> [--manager|--system] [notes]');
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
  const release = recordVerifiedRelease({ actorId, notes, target });
  console.log(JSON.stringify({ status: 'RECORDED', target, actor: admin.username, release }, null, 2));
} catch (error) {
  console.error(`Release was not recorded: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (db.open) db.close();
}
