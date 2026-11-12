import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { config as loadDotEnv } from 'dotenv';

const projectRoot = resolve(import.meta.dirname, '..');
loadDotEnv({ path: resolve(projectRoot, '.env') });
const syncOnly = process.argv.includes('--sync-only');
const releaseBuild = process.argv.includes('--release');
const artifactOnly = process.argv.includes('--artifact-only');
const liveReloadBuild = process.argv.includes('--live-reload');
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
  if (!existsSync(join(androidSdk, 'platforms', 'android-36'))) {
    throw new Error('Android SDK platform 36 is missing. Install Android SDK Platform 36 with sdkmanager or Android Studio.');
  }
  const buildToolsDirectory = join(androidSdk, 'build-tools');
  const hasBuildTools36 = existsSync(buildToolsDirectory)
    && readdirSync(buildToolsDirectory).some((version) => /^36\./.test(version));
  if (!hasBuildTools36) {
    throw new Error('Android Build Tools 36 are missing. Install Android SDK Build-Tools 36 before building the APK.');
  }
  const localProperties = resolve(projectRoot, 'android', 'local.properties');
  if (!existsSync(localProperties)) {
    console.warn('android/local.properties is missing. Android Studio or sdkmanager normally creates it; see ANDROID_PACKAGING.md.');
  }
}

const viteEntrypoint = resolve(projectRoot, 'client/node_modules/vite/bin/vite.js');
const clientDirectory = resolve(projectRoot, 'client');
run(process.execPath, [viteEntrypoint, 'build'], { cwd: clientDirectory });
run(process.execPath, [viteEntrypoint, 'build', '--mode', 'capacitor'], { cwd: clientDirectory });
run(process.execPath, [resolve(projectRoot, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android']);

if (!liveReloadBuild) {
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
  const androidDirectory = resolve(projectRoot, 'android');
  assertAndroidToolchain();
  const gradleWrapperJar = resolve(androidDirectory, 'gradle/wrapper/gradle-wrapper.jar');
  if (!existsSync(gradleWrapperJar)) throw new Error(`Gradle wrapper is missing: ${gradleWrapperJar}`);
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java')
    : 'java';
  const buildType = releaseBuild ? 'release' : 'debug';
  const task = `:app:assemble${releaseBuild ? 'Release' : 'Debug'}`;
  run(java, ['-classpath', gradleWrapperJar, 'org.gradle.wrapper.GradleWrapperMain', task, '--no-daemon', '--max-workers=1', '-Dorg.gradle.jvmargs=-Xmx1024m'], { cwd: androidDirectory });
  const builtApk = resolve(projectRoot, `android/app/build/outputs/apk/${buildType}/app-${buildType}.apk`);
  if (!existsSync(builtApk)) throw new Error(`Gradle reported success but the APK is missing: ${builtApk}`);
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
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  const sourceTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: projectRoot, encoding: 'utf8' }).trim());
  const manifest = {
    sourceRevision, sourceTreeDirty, builtAt: new Date().toISOString(), versionCode, versionName,
    buildType, serverUrl: process.env.MADAR_REP_SERVER_URL || 'https://carlos-pc.tail852ef0.ts.net',
    artifactOnly, apkSha256: createHash('sha256').update(readFileSync(builtApk)).digest('hex'),
  };
  writeFileSync(`${builtApk}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Android version: ${versionName} (versionCode ${versionCode})`);
}
