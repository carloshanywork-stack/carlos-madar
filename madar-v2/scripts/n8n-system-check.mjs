import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  databasePath,
  projectRoot,
  repApkPath,
  storageMountPath,
  storageRoot,
} from '../server/config/paths.js';
import { getStorageHealth } from '../server/modules/system/health.js';

const apiBaseUrl = (process.env.MADAR_V2_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const n8nBaseUrl = (process.env.MADAR_N8N_BASE_URL ?? 'http://127.0.0.1:5678').replace(/\/+$/, '');
const netdataBaseUrl = (process.env.MADAR_NETDATA_BASE_URL ?? 'http://127.0.0.1:19999').replace(/\/+$/, '');
const checkMode = process.env.MADAR_CHECK_MODE ?? 'operational';
if (!['operational','release'].includes(checkMode)) throw new Error('MADAR_CHECK_MODE must be operational or release.');
const revisionRead = spawnSync('git', ['rev-parse','HEAD'], {cwd:projectRoot,encoding:'utf8',timeout:2000});
const expectedRevision = revisionRead.status === 0 ? revisionRead.stdout.trim() : null;
const checks = [];

function addCheck(name, status, details) {
  checks.push({ name, status, details });
}

async function attemptCheck(name, callback) {
  try {
    const result = await callback();
    addCheck(name, result.status ?? 'PASS', result.details ?? result);
  } catch (error) {
    addCheck(name, 'FAIL', { error: String(error?.message ?? error).slice(0, 1200) });
  }
}

async function fetchResponse(url, timeoutMs = 5000) {
  const startedAt = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { response, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 };
}

async function fetchJson(url, timeoutMs = 5000) {
  const { response, durationMs } = await fetchResponse(url, timeoutMs);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}.`);
  }
  return { response, durationMs, body };
}

function readNetdataChart(chart) {
  return fetchJson(`${netdataBaseUrl}/api/v1/data?chart=${encodeURIComponent(chart)}&after=-1&points=1&format=json`)
    .then(({ response, body }) => {
      if (!response.ok || !Array.isArray(body.labels) || !Array.isArray(body.data) || !body.data.length) {
        throw new Error(`Netdata chart ${chart} is unavailable (HTTP ${response.status}).`);
      }
      const row = body.data.at(-1);
      return Object.fromEntries(body.labels.slice(1).map((label, index) => [label, Number(row[index + 1])]));
    });
}

await attemptCheck('MADAR V2 API health', async () => {
  const { response, durationMs, body } = await fetchJson(`${apiBaseUrl}/api/health`);
  if (!response.ok || body.status !== 'ok' || body.service !== 'madar-v2') {
    throw new Error(`Expected MADAR V2 health HTTP 200; received HTTP ${response.status}.`);
  }
  if (!expectedRevision || body.sourceRevision !== expectedRevision || body.sourceDirty !== false) throw new Error('Running service does not match the clean checked-out source revision.');
  return { details: { httpStatus: response.status, durationMs, service: body.service, sourceRevision:body.sourceRevision } };
});

await attemptCheck('Representative API authentication boundary', async () => {
  const { response, durationMs } = await fetchResponse(`${apiBaseUrl}/api/rep/map/packs`);
  if (response.status !== 401) {
    throw new Error(`Unauthenticated /api/rep/map/packs should return 401; received ${response.status}.`);
  }
  return { details: { unauthenticatedStatus: response.status, durationMs } };
});

await attemptCheck('n8n and Netdata telemetry', async () => {
  const [{ response: n8nResponse, durationMs: n8nDurationMs }, infoResult, alarmsResult, cpu, ram] = await Promise.all([
    fetchResponse(`${n8nBaseUrl}/`),
    fetchJson(`${netdataBaseUrl}/api/v1/info`),
    fetchJson(`${netdataBaseUrl}/api/v1/alarms?all`),
    readNetdataChart('system.cpu'),
    readNetdataChart('system.ram'),
  ]);
  if (!n8nResponse.ok) throw new Error(`n8n returned HTTP ${n8nResponse.status}.`);
  if (!infoResult.response.ok || !alarmsResult.response.ok) {
    throw new Error(`Netdata returned HTTP ${infoResult.response.status}/${alarmsResult.response.status}.`);
  }

  const activeAlarms = Object.values(alarmsResult.body.alarms ?? {}).filter((alarm) =>
    alarm.active && !alarm.silenced && ['WARNING', 'CRITICAL'].includes(alarm.status));
  const warnings = activeAlarms.filter((alarm) => alarm.status === 'WARNING').map((alarm) => ({
    name: alarm.name,
    summary: alarm.summary,
    value: alarm.value_string,
  }));
  const criticals = activeAlarms.filter((alarm) => alarm.status === 'CRITICAL').map((alarm) => ({
    name: alarm.name,
    summary: alarm.summary,
    value: alarm.value_string,
  }));
  const cpuNonIdlePercent = Object.entries(cpu)
    .filter(([dimension]) => !['guest', 'guest_nice'].includes(dimension))
    .reduce((total, [, value]) => total + (Number.isFinite(value) ? value : 0), 0);
  const memoryTotalMb = Object.values(ram).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const severity = criticals.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS';
  return {
    status: severity,
    details: {
      n8n: { httpStatus: n8nResponse.status, durationMs: n8nDurationMs },
      netdataVersion: infoResult.body.version,
      resourceSample: {
        cpuNonIdlePercent: Math.round(cpuNonIdlePercent * 100) / 100,
        memoryUsedMb: ram.used ?? null,
        memoryTotalMb: Math.round(memoryTotalMb * 100) / 100,
        note: 'Point-in-time Netdata sample; not a build or load benchmark.',
      },
      activeWarnings: warnings,
      activeCriticals: criticals,
    },
  };
});

await attemptCheck('SQLite WAL and integrity (read-only)', async () => {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    const journalMode = database.pragma('journal_mode', { simple: true });
    const integrity = database.pragma('integrity_check', { simple: true });
    const foreignKeyViolations = database.pragma('foreign_key_check');
    if (String(journalMode).toLowerCase() !== 'wal') throw new Error(`SQLite journal mode is ${journalMode}, not WAL.`);
    if (integrity !== 'ok') throw new Error(`SQLite integrity_check returned ${integrity}.`);
    if (foreignKeyViolations.length) throw new Error(`SQLite reports ${foreignKeyViolations.length} foreign-key violation(s).`);
    return { details: { journalMode, integrity, foreignKeyViolations: foreignKeyViolations.length, readOnly: true } };
  } finally {
    database.close();
  }
});

await attemptCheck('Representative APK artifact', async () => {
  const fileInfo = await stat(repApkPath);
  const apkBytes = await readFile(repApkPath);
  const modifiedAt = fileInfo.mtime.toISOString();
  const ageDays = (Date.now() - fileInfo.mtimeMs) / (24 * 60 * 60 * 1000);
  const sizeBytes = fileInfo.size;
  if (!fileInfo.isFile()) throw new Error('Configured APK artifact is not a regular file.');
  if (sizeBytes <= 5 * 1024 * 1024) throw new Error(`APK is only ${sizeBytes} bytes; minimum is greater than 5 MiB.`);
  if (ageDays < 0 || ageDays > 30) throw new Error(`APK mtime age ${ageDays.toFixed(1)} days is outside the 30-day freshness window.`);
  if (apkBytes.subarray(0, 4).toString('hex') !== '504b0304') throw new Error('APK does not start with a ZIP local-file header.');
  return {
    details: {
      path: repApkPath,
      sizeBytes,
      modifiedAt,
      ageDays: Math.round(ageDays * 100) / 100,
      zipHeader: true,
      sha256: createHash('sha256').update(apkBytes).digest('hex'),
      signatureAndDeviceInstallVerified: false,
    },
  };
});

await attemptCheck('Configured storage capacity', async () => {
  const storagePath = storageMountPath ?? storageRoot;
  const storage = await getStorageHealth({ storagePath, mountRequired: Boolean(storageMountPath) });
  if (storage.status === 'error') throw new Error(storage.error ?? 'Storage health check failed.');
  return {
    status: storage.status === 'warning' ? 'WARN' : 'PASS',
    details: storage,
  };
});

if (checkMode === 'release') await attemptCheck('Rep API integration tests', async () => {
  const testRun = spawnSync(process.execPath, ['--test', 'test/rep-api.test.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${testRun.stdout ?? ''}\n${testRun.stderr ?? ''}`;
  const tapValue = (name) => {
    const matches = [...output.matchAll(new RegExp(`^ℹ ${name}\\s+(\\d+)\\s*$`, 'gm'))];
    return matches.length ? Number(matches.at(-1)[1]) : null;
  };
  const tests = tapValue('tests');
  const passed = tapValue('pass');
  const failed = tapValue('fail');
  const ok = !testRun.error && testRun.status === 0 && tests > 0 && passed === tests && failed === 0;
  if (!ok) {
    const detail = output.trim().slice(-5000);
    throw new Error(`node --test test/rep-api.test.js failed (exit ${testRun.status ?? 'unknown'}; ${passed ?? '?'} / ${tests ?? '?'} passed). ${detail}`);
  }
  return { details: { command: 'node --test test/rep-api.test.js', tests, passed, failed, isolatedTestDatabase: true } };
});

const failedCount = checks.filter((check) => check.status === 'FAIL').length;
const warningCount = checks.filter((check) => check.status === 'WARN').length;
const overall = failedCount ? 'FAIL' : warningCount ? 'WARN' : 'PASS';
const report = {
  schemaVersion: 2,
  sourceRevision: expectedRevision,
  checkMode,
  releaseAcceptance: 'NOT_ESTABLISHED',
  physicalDevice: 'BLOCKED_PREREQUISITE',
  alertDelivery: 'UNCONFIGURED_NO_AUTHORIZED_DESTINATION',
  system: 'MADAR V2',
  checkedAt: new Date().toISOString(),
  overall,
  summary: { checks: checks.length, failed: failedCount, warnings: warningCount },
  checks,
};

console.log(JSON.stringify(report));
process.exitCode = failedCount ? 1 : 0;
