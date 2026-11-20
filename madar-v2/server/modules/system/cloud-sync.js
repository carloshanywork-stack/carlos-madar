import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export async function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Dispatches an offsite cloud sync for a verified backup archive.
 * Supports configurable shell commands (e.g. rclone, aws s3, curl),
 * external storage destinations, and notification webhooks.
 */
export async function syncBackupToCloud(filePath, options = {}) {
  const filename = basename(filePath);
  const command = options.command ?? process.env.MADAR_CLOUD_BACKUP_COMMAND;
  const destination = options.destination ?? process.env.MADAR_CLOUD_BACKUP_DEST;
  const webhookUrl = options.webhookUrl ?? process.env.MADAR_CLOUD_BACKUP_WEBHOOK;

  if (!command && !destination && !webhookUrl) {
    return {
      synced: false,
      method: 'none',
      message: 'No cloud destination, command, or webhook configured (local-only backup).',
    };
  }

  let fileStats = null;
  try {
    fileStats = await stat(filePath);
  } catch {
    return { synced: false, error: 'Backup file does not exist or is inaccessible.' };
  }

  const results = {
    synced: false,
    filename,
    sizeBytes: fileStats.size,
    methods: [],
  };

  // 1. Execute custom replication command if configured
  if (command) {
    try {
      const renderedCmd = command.replace(/\$\{BACKUP_FILE\}/g, filePath).replace(/\$\{FILENAME\}/g, filename);
      const [cmd, ...args] = renderedCmd.split(/\s+/);
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 60_000 });
      results.methods.push({ method: 'command', status: 'success', output: stdout.trim() || stderr.trim() });
      results.synced = true;
    } catch (err) {
      results.methods.push({ method: 'command', status: 'failed', error: err.message });
    }
  }

  // 2. Notify remote webhook if configured
  if (webhookUrl) {
    try {
      const sha256 = await computeFileSha256(filePath);
      const payload = {
        event: 'madar.backup.completed',
        filename,
        sizeBytes: fileStats.size,
        sha256,
        timestamp: new Date().toISOString(),
      };
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      results.methods.push({
        method: 'webhook',
        status: response.ok ? 'success' : 'failed',
        statusCode: response.status,
      });
      if (response.ok) results.synced = true;
    } catch (err) {
      results.methods.push({ method: 'webhook', status: 'failed', error: err.message });
    }
  }

  return results;
}
