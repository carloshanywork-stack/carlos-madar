import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const approvedSigner = 'f4c8bffc9f852ea6056e350b65156eb880d05629991682492159b9e3937c02a1';

export function readApkIdentity(apkPath, buildToolsDirectory) {
  const windows = process.platform === 'win32';
  const aapt = join(buildToolsDirectory, windows ? 'aapt.exe' : 'aapt');
  const badging = execFileSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' });
  const pkg = badging.match(/^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'/m);
  if (!pkg || !Number.isSafeInteger(Number(pkg[2])) || Number(pkg[2]) <= 0) {
    throw new Error('Could not read APK package and version from AndroidManifest.xml.');
  }
  return {
    applicationId: pkg[1],
    versionCode: Number(pkg[2]),
    versionName: pkg[3],
    debuggable: /^application-debuggable\s*$/m.test(badging),
    apkSha256: createHash('sha256').update(readFileSync(apkPath)).digest('hex'),
  };
}

export function assertApkIdentity(identity, expected) {
  for (const key of ['applicationId', 'versionCode', 'versionName']) {
    if (identity[key] !== expected[key]) {
      throw new Error(`APK ${key} is ${identity[key]}, expected ${expected[key]}.`);
    }
  }
  if (expected.release && identity.debuggable) throw new Error('A release APK must not be debuggable.');
}

export function inspectApkArtifact(apkPath, buildToolsDirectory, expected) {
  const identity = readApkIdentity(apkPath, buildToolsDirectory);
  assertApkIdentity(identity, expected);
  const windows = process.platform === 'win32';
  const apksigner = join(buildToolsDirectory, windows ? 'apksigner.bat' : 'apksigner');
  const report = execFileSync(apksigner, ['verify', '--verbose', '--print-certs', apkPath], {
    encoding: 'utf8', shell: windows,
  });
  const signers = [...report.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/gim)];
  if (signers.length !== 1) throw new Error('Expected exactly one verified APK signer.');
  const signerCertificateSha256 = signers[0][1].toLowerCase();
  if (expected.release && signerCertificateSha256 !== approvedSigner) {
    throw new Error('The release APK certificate does not match the approved MADAR signer.');
  }
  return {
    ...identity,
    signerCertificateSha256,
  };
}

/** Compare both the binary and advertised version so a metadata mismatch cannot cause a downgrade. */
export function assertReleaseProgression(candidate, currentBinary, currentManifest) {
  if (currentBinary && candidate.applicationId !== currentBinary.applicationId) {
    throw new Error('The existing release belongs to a different application.');
  }
  const floor = Math.max(currentBinary?.versionCode ?? 0, currentManifest?.versionCode ?? 0);
  if (candidate.versionCode > floor) return;
  const sameRelease = candidate.versionCode === floor
    && candidate.versionCode === currentBinary?.versionCode
    && candidate.versionCode === currentManifest?.versionCode
    && candidate.apkSha256 === currentBinary?.apkSha256
    && candidate.apkSha256 === currentManifest?.apkSha256;
  if (!sameRelease) throw new Error(`Release versionCode must be greater than ${floor}.`);
}
