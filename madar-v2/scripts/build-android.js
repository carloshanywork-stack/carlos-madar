import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { config as loadDotEnv } from 'dotenv';
import { assertReleaseProgression, inspectApkArtifact, readApkIdentity } from './android-artifact.js';

const projectRoot = resolve(import.meta.dirname, '..');
loadDotEnv({ path: resolve(projectRoot, '.env') });
const syncOnly = process.argv.includes('--sync-only');
const releaseBuild = process.argv.includes('--release');
const artifactOnly = process.argv.includes('--artifact-only');
const liveReloadBuild = process.argv.includes('--live-reload');
const nativePlatformBuild = process.argv.includes('--native-platform');
const managerBuild = process.argv.includes('--manager');
if (managerBuild && nativePlatformBuild) throw new Error('Choose either --manager or --native-platform.');
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
  if (managerBuild && !existsSync(join(managerPublicSrc, 'index.html'))) {
    throw new Error('Manager build did not generate its bundled application entry point.');
  }
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
  const flavor = nativePlatformBuild ? '' : managerBuild ? 'Manager' : 'Rep';
  const task = `:app:assemble${flavor}${releaseBuild ? 'Release' : 'Debug'}`;
  run(java, ['-classpath', gradleWrapperJar, 'org.gradle.wrapper.GradleWrapperMain', task, '--no-daemon', '--max-workers=1', '-Dorg.gradle.jvmargs=-Xmx1024m'], { cwd: androidDirectory });
  const builtApk = resolve(
    projectRoot,
    nativePlatformBuild
      ? `android/native-platform/app/build/outputs/apk/${buildType}/app-${buildType}.apk`
      : `android/app/build/outputs/apk/${flavor.toLowerCase()}/${buildType}/app-${flavor.toLowerCase()}-${buildType}.apk`,
  );
  if (!existsSync(builtApk)) throw new Error(`Gradle reported success but the APK is missing: ${builtApk}`);
  const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const buildTools = readdirSync(join(androidSdk, 'build-tools')).filter((version) => /^(?:34|35|36)\./.test(version)).sort().at(-1);
  const buildToolsDirectory = join(androidSdk, 'build-tools', buildTools);
  const nativeDebug = nativePlatformBuild && !releaseBuild;
  const identity = inspectApkArtifact(builtApk, buildToolsDirectory, {
    applicationId: managerBuild ? 'com.madar.system.app' : nativeDebug ? 'com.madar.rep.app.debug' : 'com.madar.rep.app',
    versionCode, versionName: nativeDebug ? `${versionName}-debug` : versionName, release: releaseBuild,
  });
  const artifactName = managerBuild
    ? (releaseBuild ? 'madar-manager-release.apk' : 'madar-manager.apk')
    : (releaseBuild ? 'madar-rep-release.apk' : 'madar-rep.apk');
  const publishedApk = resolve(projectRoot, artifactName);
  const publishedManifest = `${publishedApk}.manifest.json`;
  if (!artifactOnly && releaseBuild) {
    const existing = existsSync(publishedApk) ? readApkIdentity(publishedApk, buildToolsDirectory) : null;
    const existingManifest = existsSync(publishedManifest) ? JSON.parse(readFileSync(publishedManifest, 'utf8')) : null;
    assertReleaseProgression(identity, existing, existingManifest);
  }
  const manifest = {
    sourceRevision, sourceTreeDirty, builtAt: new Date().toISOString(), ...identity,
    buildType, serverUrl: process.env.MADAR_REP_SERVER_URL || 'https://carlos-pc.tail852ef0.ts.net',
    artifactOnly,
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(`${builtApk}.manifest.json`, manifestBytes, { mode: 0o600 });
  if (!artifactOnly) {
    const temporaryApk = `${publishedApk}.${process.pid}.tmp`;
    const temporaryManifest = `${publishedManifest}.${process.pid}.tmp`;
    try {
      copyFileSync(builtApk, temporaryApk);
      writeFileSync(temporaryManifest, manifestBytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporaryApk, publishedApk);
      renameSync(temporaryManifest, publishedManifest);
    } finally {
      rmSync(temporaryApk, { force: true });
      rmSync(temporaryManifest, { force: true });
    }
    console.log(`Published APK: ${publishedApk}`);
  }
  console.log(`${releaseBuild ? 'Release' : 'Debug'} APK: ${builtApk}`);
  console.log(`Android version: ${versionName} (versionCode ${versionCode})`);
}
