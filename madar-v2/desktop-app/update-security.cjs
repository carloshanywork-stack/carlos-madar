const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const script = `
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $env:MADAR_UPDATE_VERIFY_PATH
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
  throw 'Installer Authenticode signature is missing or not trusted by Windows.'
}
$certificate = $signature.SignerCertificate
$publisher = $env:MADAR_UPDATE_VERIFY_PUBLISHER
if ($publisher.Contains('=')) {
  if ($certificate.Subject -cne $publisher) { throw 'Installer signer does not match the configured publisher.' }
} else {
  $name = $certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($name -cne $publisher) { throw 'Installer signer does not match the configured publisher.' }
}
`;
const encodedScript = Buffer.from(script, 'utf16le').toString('base64');

function readUpdateChannel(runtimeConfig, embeddedConfig) {
  const publisher = runtimeConfig.publisherName?.trim();
  if (runtimeConfig.releaseBuild !== true || !publisher
      || !Array.isArray(embeddedConfig?.publisherName) || embeddedConfig.publisherName.length !== 1 || embeddedConfig.publisherName[0] !== publisher
      || embeddedConfig.provider !== 'generic' || embeddedConfig.url !== runtimeConfig.updateUrl) {
    throw new Error('The packaged Windows update publisher and channel must match.');
  }
  const url = new URL(embeddedConfig.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('The packaged Windows update channel must use HTTPS.');
  }
  return { publisher, url: url.href };
}

async function verifyWindowsInstaller(path, publisher, execute = run) {
  try {
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
      env: { ...process.env, MADAR_UPDATE_VERIFY_PATH: path, MADAR_UPDATE_VERIFY_PUBLISHER: publisher },
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 64 * 1024,
    });
    return null;
  } catch {
    return 'Windows could not verify Authenticode trust and the expected MADAR publisher.';
  }
}

module.exports = { readUpdateChannel, verifyWindowsInstaller };
