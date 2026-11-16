import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const desktopDir = resolve(projectRoot, 'desktop');
const certKeyPath = resolve(desktopDir, 'temp-codesign.key');
const certCrtPath = resolve(desktopDir, 'temp-codesign.crt');
const pfxPath = resolve(desktopDir, 'madar-codesign.pfx');
const cerPath = resolve(desktopDir, 'madar-codesign.cer');

export const DEFAULT_PUBLISHER_NAME = 'MADAR ERP';
export const DEFAULT_CERT_PASSWORD = process.env.MADAR_CODESIGN_PASSWORD || 'madar-codesign-2026';

export function ensureDesktopCertificate() {
  if (existsSync(pfxPath) && existsSync(cerPath)) {
    console.log(`[CodeSign] Existing Authenticode certificate found: ${pfxPath}`);
    return { pfxPath, cerPath, password: DEFAULT_CERT_PASSWORD, publisherName: DEFAULT_PUBLISHER_NAME };
  }

  console.log('[CodeSign] Generating enterprise Authenticode Code Signing Certificate...');
  try {
    // 1. Generate RSA 2048 private key and self-signed certificate with Code Signing EKU
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', certKeyPath,
      '-out', certCrtPath,
      '-days', '1825',
      '-nodes',
      '-subj', `/CN=${DEFAULT_PUBLISHER_NAME}/O=MADAR/C=EG`,
      '-addext', 'extendedKeyUsage = codeSigning',
      '-addext', 'keyUsage = digitalSignature',
    ], { stdio: 'pipe' });

    // 2. Export PKCS#12 (.pfx) for Electron Builder / signtool
    execFileSync('openssl', [
      'pkcs12', '-export',
      '-out', pfxPath,
      '-inkey', certKeyPath,
      '-in', certCrtPath,
      '-password', `pass:${DEFAULT_CERT_PASSWORD}`,
    ], { stdio: 'pipe' });

    // 3. Export public DER certificate (.cer) for Windows Trusted Root import
    execFileSync('openssl', [
      'x509', '-in', certCrtPath,
      '-outform', 'DER',
      '-out', cerPath,
    ], { stdio: 'pipe' });

    console.log(`[CodeSign] Successfully generated PKCS#12 certificate: ${pfxPath}`);
    console.log(`[CodeSign] Public root certificate exported: ${cerPath}`);
    console.log(`[CodeSign] To trust this certificate on client Windows machines, run:`);
    console.log(`    certutil -addstore -f Root "${cerPath}"`);

    return { pfxPath, cerPath, password: DEFAULT_CERT_PASSWORD, publisherName: DEFAULT_PUBLISHER_NAME };
  } finally {
    if (existsSync(certKeyPath)) unlinkSync(certKeyPath);
    if (existsSync(certCrtPath)) unlinkSync(certCrtPath);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  ensureDesktopCertificate();
}
