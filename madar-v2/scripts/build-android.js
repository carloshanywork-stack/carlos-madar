import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { config as loadDotEnv } from 'dotenv';

const projectRoot = resolve(import.meta.dirname, '..');
loadDotEnv({ path: resolve(projectRoot, '.env') });
const syncOnly = process.argv.includes('--sync-only');
const releaseBuild = process.argv.includes('--release');
const artifactOnly = process.argv.includes('--artifact-only');
const liveReloadBuild = process.argv.includes('--live-reload');
const nativePlatformBuild = process.argv.includes('--native-platform');
const isWindows = process.platform === 'win32';
const versionProperties = Object.fromEntries(
  readFileSync(resolve(projectRoot, 'android/version.properties'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.split('=').map((part) => part.trim())),
);
const versionCode = Number(versionProperties.versionCode ?? 0);
const versionName = versionProperties.versionName ?? '';
if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
  throw new Error('android/version.properties must define a positive versionCode and a versionName.');
}

if (releaseBuild && liveReloadBuild) {
  throw new Error('Live reload is for local development only and cannot be used for a release APK.');
}
if (releaseBuild && !existsSync(resolve(projectRoot, 'android/key.properties'))) {
  throw new Error('Release signing is not configured. Copy android/key.properties.example to android/key.properties and fill it with the approved keystore values.');
}
process.env.MADAR_ANDROID_BUILD_TYPE = releaseBuild ? 'release' : 'debug';
// A stale .env or terminal variable must never make an ordinary APK point at localhost.
process.env.MADAR_REP_LIVE_RELOAD = liveReloadBuild ? 'true' : 'false';
// Android's bundled service-worker cache key must be reproducible for a version.
process.env.MADAR_BUILD_VERSION = `${versionName}-${versionCode}`;

const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
const sourceTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: projectRoot, encoding: 'utf8' }).trim());
if (releaseBuild && sourceTreeDirty) {
  throw new Error('Release APKs must be built from a clean, committed source tree. Preserve local edits and build from a clean checkout.');
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });
}

function assertAndroidToolchain() {
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java')
    : 'java';
  const javaVersion = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const versionOutput = `${javaVersion.stdout ?? ''}\n${javaVersion.stderr ?? ''}`;
  const versionMatch = versionOutput.match(/(?:version\s+"|openjdk\s+)(\d+)/i);
  if (javaVersion.error || javaVersion.status !== 0 || !versionMatch || Number(versionMatch[1]) < 21) {
    throw new Error('JDK 21+ was not found. Install a supported JDK and set JAVA_HOME before building the APK.');
  }

  const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidSdk || !existsSync(androidSdk)) {
    throw new Error('Android SDK was not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed Android SDK.');
  }
  if (!existsSync(join(androidSdk, 'platforms', 'android-34')) && !existsSync(join(androidSdk, 'platforms', 'android-36'))) {
    throw new Error('Android SDK platform 34 or 36 is missing. Install Android SDK Platform with sdkmanager or Android Studio.');
  }
  const buildToolsDirectory = join(androidSdk, 'build-tools');
  const hasBuildTools = existsSync(buildToolsDirectory)
    && readdirSync(buildToolsDirectory).some((version) => /^(?:34|35|36)\./.test(version));
  if (!hasBuildTools) {
    throw new Error('Android Build Tools 34+ are missing. Install Android SDK Build-Tools before building the APK.');
  }
  const localProperties = resolve(projectRoot, 'android', 'local.properties');
  if (!existsSync(localProperties)) {
    console.warn('android/local.properties is missing. Android Studio or sdkmanager normally creates it; see ANDROID_PACKAGING.md.');
  }
}

if (!nativePlatformBuild) {
  const viteEntrypoint = resolve(projectRoot, 'client/node_modules/vite/bin/vite.js');
  const clientDirectory = resolve(projectRoot, 'client');
  run(process.execPath, [viteEntrypoint, 'build'], { cwd: clientDirectory });
  run(process.execPath, [viteEntrypoint, 'build', '--mode', 'capacitor'], { cwd: clientDirectory });
  run(process.execPath, [resolve(projectRoot, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);
  run(process.execPath, [viteEntrypoint, 'build', '--mode', 'capacitor-manager'], { cwd: clientDirectory });
  const managerPublicSrc = resolve(projectRoot, 'public/manager');
  const managerAssetsDest = resolve(projectRoot, 'android/app/src/manager/assets/public');
  if (existsSync(managerPublicSrc)) {
    rmSync(managerAssetsDest, { recursive: true, force: true });
    cpSync(managerPublicSrc, managerAssetsDest, { recursive: true });
  }
}

if (!liveReloadBuild && !nativePlatformBuild) {
  const capacitorConfigPath = resolve(projectRoot, 'android/app/src/main/assets/capacitor.config.json');
  const capacitorConfig = JSON.parse(readFileSync(capacitorConfigPath, 'utf8'));
  if (capacitorConfig.server?.url) {
    throw new Error('Standalone Android build unexpectedly points the WebView at a server URL. Refusing to continue.');
  }
  const bundledAssets = resolve(projectRoot, 'android/app/src/main/assets/public');
  const containsLocalhostUrl = readdirSync(join(bundledAssets, 'assets'))
    .filter((filename) => filename.endsWith('.js'))
    .some((filename) => readFileSync(join(bundledAssets, 'assets', filename), 'utf8').includes('http://localhost:3000'));
  if (containsLocalhostUrl) {
    throw new Error('Standalone Android web assets contain http://localhost:3000. Refusing to continue.');
  }
}

if (!syncOnly) {
  const androidDirectory = resolve(projectRoot, nativePlatformBuild ? 'android/native-platform' : 'android');
  assertAndroidToolchain();
  const gradleWrapperJar = resolve(androidDirectory, 'gradle/wrapper/gradle-wrapper.jar');
  if (!existsSync(gradleWrapperJar)) throw new Error(`Gradle wrapper is missing: ${gradleWrapperJar}`);
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java')
    : 'java';
  const buildType = releaseBuild ? 'release' : 'debug';
  const task = `:app:assemble${releaseBuild ? 'Release' : 'Debug'}`;
  run(java, ['-classpath', gradleWrapperJar, 'org.gradle.wrapper.GradleWrapperMain', task, '--no-daemon', '--max-workers=1', '-Dorg.gradle.jvmargs=-Xmx1024m'], { cwd: androidDirectory });
  const builtApk = resolve(
    projectRoot,
    nativePlatformBuild
      ? `android/native-platform/app/build/outputs/apk/${buildType}/app-${buildType}.apk`
      : `android/app/build/outputs/apk/${buildType}/app-${buildType}.apk`,
  );
  if (!existsSync(builtApk)) throw new Error(`Gradle reported success but the APK is missing: ${builtApk}`);
  const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const buildTools = readdirSync(join(androidSdk, 'build-tools')).filter((version) => /^(?:34|35|36)\./.test(version)).sort().at(-1);
  const apksigner = join(androidSdk, 'build-tools', buildTools, isWindows ? 'apksigner.bat' : 'apksigner');
  if (!existsSync(apksigner)) throw new Error('Android Build Tools apksigner was not found; refusing to publish an unverifiable APK.');
  const signatureReport = execFileSync(apksigner, ['verify', '--verbose', '--print-certs', builtApk], {
    encoding: 'utf8',
    shell: isWindows,
  });
  const certificateMatch = signatureReport.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]{64,95})/i);
  if (!certificateMatch) throw new Error('The APK has no verifiable signing certificate; refusing to publish it.');
  const signerCertificateSha256 = certificateMatch[1].replaceAll(':', '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signerCertificateSha256)) throw new Error('The APK signing-certificate fingerprint is malformed.');
  const publishedApk = resolve(projectRoot, releaseBuild ? 'madar-rep-release.apk' : 'madar-rep.apk');
  const temporaryApk = resolve(projectRoot, `${releaseBuild ? '.madar-rep-release' : '.madar-rep'}-${process.pid}.apk.tmp`);
  if (!artifactOnly) try {
    copyFileSync(builtApk, temporaryApk);
    renameSync(temporaryApk, publishedApk);
  } finally {
    rmSync(temporaryApk, { force: true });
  }
  console.log(`${releaseBuild ? 'Release' : 'Debug'} APK: ${builtApk}`);
  if (!artifactOnly) console.log(`Published APK: ${publishedApk}`);
  const manifest = {
    sourceRevision, sourceTreeDirty, builtAt: new Date().toISOString(), versionCode, versionName,
    buildType, serverUrl: process.env.MADAR_REP_SERVER_URL || 'https://carlos-pc.tail852ef0.ts.net',
    artifactOnly, apkSha256: createHash('sha256').update(readFileSync(builtApk)).digest('hex'), signerCertificateSha256,
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(`${builtApk}.manifest.json`, manifestBytes, { mode: 0o600 });
  if (!artifactOnly) {
    const manifestPath = `${publishedApk}.manifest.json`;
    const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryManifest, manifestBytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporaryManifest, manifestPath);
    } finally {
      rmSync(temporaryManifest, { force: true });
    }
    const managerBuiltApk = resolve(projectRoot, `android/app/build/outputs/apk/manager/${buildType}/app-manager-${buildType}.apk`);
    if (existsSync(managerBuiltApk)) {
      const managerPublishedApk = resolve(projectRoot, releaseBuild ? 'madar-manager-release.apk' : 'madar-manager.apk');
      const managerApkBytes = readFileSync(managerBuiltApk);
      const managerManifest = {
        sourceRevision, sourceTreeDirty, builtAt: new Date().toISOString(), versionCode, versionName,
        buildType, serverUrl: process.env.MADAR_REP_SERVER_URL || 'https://carlos-pc.tail852ef0.ts.net',
        artifactOnly: true, apkSha256: createHash('sha256').update(managerApkBytes).digest('hex'), signerCertificateSha256,
      };
      const managerManifestBytes = `${JSON.stringify(managerManifest, null, 2)}\n`;
      writeFileSync(`${managerBuiltApk}.manifest.json`, managerManifestBytes, { mode: 0o600 });
      writeFileSync(`${managerPublishedApk}.manifest.json`, managerManifestBytes, { mode: 0o600 });
      try {
        writeFileSync(resolve(projectRoot, '..', releaseBuild ? 'madar-manager-release.apk.manifest.json' : 'madar-manager.apk.manifest.json'), managerManifestBytes, { mode: 0o600 });
        copyFileSync(publishedApk, resolve(projectRoot, '..', releaseBuild ? 'madar-rep-release.apk' : 'madar-rep.apk'));
        writeFileSync(resolve(projectRoot, '..', releaseBuild ? 'madar-rep-release.apk.manifest.json' : 'madar-rep.apk.manifest.json'), manifestBytes, { mode: 0o600 });
      } catch (ignored) {}
    }
  }
  console.log(`Android version: ${versionName} (versionCode ${versionCode})`);
}
