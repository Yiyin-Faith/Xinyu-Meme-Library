import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const gradle = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
if (!existsSync(`android/${gradle}`)) {
  console.error('Android 工程不存在，请先运行 npm run android:sync');
  process.exit(1);
}
const env = { ...process.env };
const buildTimeout = Number(env.PUFF_GRADLE_TIMEOUT || 600000);
if (!Number.isFinite(buildTimeout) || buildTimeout < 60000) throw new Error('PUFF_GRADLE_TIMEOUT must be at least 60000 milliseconds');
const signingEnv = {
  keystore: env.PUFF_ANDROID_KEYSTORE,
  keyAlias: env.PUFF_ANDROID_KEY_ALIAS,
  keystorePassword: env.PUFF_ANDROID_KEYSTORE_PASSWORD,
  keyPassword: env.PUFF_ANDROID_KEY_PASSWORD,
};
const signingEnvValues = Object.values(signingEnv);
const hasConfiguredSigning = signingEnvValues.every(Boolean);
const hasPartialSigning = signingEnvValues.some(Boolean) && !hasConfiguredSigning;
if (hasPartialSigning) {
  throw new Error('Android release signing must provide PUFF_ANDROID_KEYSTORE, PUFF_ANDROID_KEY_ALIAS, PUFF_ANDROID_KEYSTORE_PASSWORD, and PUFF_ANDROID_KEY_PASSWORD together.');
}
const allowDebugSigning = env.PUFF_ANDROID_ALLOW_DEBUG_SIGNING === '1';
const debugKeystore = path.join(os.homedir(), '.android', 'debug.keystore');
let signingConfig;
if (hasConfiguredSigning) {
  if (!existsSync(signingEnv.keystore)) throw new Error(`Configured Android keystore does not exist: ${signingEnv.keystore}`);
  signingConfig = { ...signingEnv, source: 'configured release keystore' };
} else if (allowDebugSigning && existsSync(debugKeystore)) {
  signingConfig = {
    keystore: debugKeystore,
    keyAlias: 'androiddebugkey',
    keystorePassword: 'android',
    keyPassword: 'android',
    source: 'explicit local debug keystore',
  };
} else {
  const hint = 'Set the four PUFF_ANDROID_KEYSTORE* / PUFF_ANDROID_KEY_* variables. For a non-distribution local test only, set PUFF_ANDROID_ALLOW_DEBUG_SIGNING=1 and provide ~/.android/debug.keystore.';
  if (env.PUFF_ANDROID_REQUIRE_SIGNING === '1') throw new Error(`Fixed Android release signing is required. ${hint}`);
  throw new Error(`Android release APK is not signed by default. ${hint}`);
}
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.resolve('.tools/android-sdk');
if (existsSync(sdk)) {
  env.ANDROID_HOME = sdk;
  const escaped = sdk.replaceAll('\\', '/').replace(/[^\x20-\x7E]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync('android/local.properties', `sdk.dir=${escaped}\n`);
}
if (!env.JAVA_HOME) {
  const jdks = path.join(os.homedir(), '.gradle/jdks');
  if (existsSync(jdks)) {
    const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';
    const java21 = readdirSync(jdks).find((name) => name.includes('-21-') && existsSync(path.join(jdks, name, 'bin', javaExecutable)));
    if (java21) env.JAVA_HOME = path.join(jdks, java21);
  }
}
const args = ['assembleRelease', '--console=plain', '--no-daemon', '--max-workers=2', '-Dorg.gradle.internal.http.connectionTimeout=15000', '-Dorg.gradle.internal.http.socketTimeout=15000', '-Dhttps.protocols=TLSv1.2', '-Djdk.tls.client.protocols=TLSv1.2', '-Dhttps.proxyType=HTTP'];
if (env.PUFF_GRADLE_OFFLINE === '1') args.push('--offline');
if (env.PUFF_GRADLE_PROXY) {
  const proxy = new URL(env.PUFF_GRADLE_PROXY);
  if (!/^[a-zA-Z0-9.-]+$/.test(proxy.hostname)) throw new Error('Invalid proxy hostname');
  const proxyArgs = [`-Dhttp.proxyHost=${proxy.hostname}`, `-Dhttp.proxyPort=${proxy.port || '80'}`, `-Dhttps.proxyHost=${proxy.hostname}`, `-Dhttps.proxyPort=${proxy.port || '80'}`];
  args.push(...proxyArgs);
  // The wrapper downloads Gradle before task arguments are read, so it needs the same proxy settings.
  env.JAVA_TOOL_OPTIONS = [env.JAVA_TOOL_OPTIONS, ...proxyArgs].filter(Boolean).join(' ');
}
const command = process.platform === 'win32' ? gradle : 'bash';
const commandArgs = process.platform === 'win32' ? args : [gradle, ...args];
const result = spawnSync(command, commandArgs, { cwd: 'android', stdio: 'inherit', shell: process.platform === 'win32', env, timeout: buildTimeout, killSignal: 'SIGTERM' });
if (result.status === 0) {
  mkdirSync('release/Android', { recursive: true });
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const apkPath = `release/Android/Xinyu-Meme-Library-${version}-Android.apk`;
  const unsignedPath = `${apkPath}.unsigned`;
  copyFileSync('android/app/build/outputs/apk/release/app-release-unsigned.apk', unsignedPath);
  const sdkRoot = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.resolve('.tools/android-sdk');
  const buildToolsRoot = path.join(sdkRoot, 'build-tools');
  const signerName = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner';
  const signerVersion = existsSync(buildToolsRoot) ? readdirSync(buildToolsRoot).sort().reverse().find((name) => existsSync(path.join(buildToolsRoot, name, signerName))) : undefined;
  if (!signerVersion) throw new Error('Android Build Tools apksigner was not found; refusing to publish an unsigned APK.');
  const signer = path.join(buildToolsRoot, signerVersion, signerName);
  const signedPath = `${apkPath}.signed`;
  const signingArgs = ['sign', '--ks', signingConfig.keystore, '--ks-key-alias', signingConfig.keyAlias, '--ks-pass', `pass:${signingConfig.keystorePassword}`, '--key-pass', `pass:${signingConfig.keyPassword}`, '--out', signedPath, unsignedPath];
  const signing = spawnSync(process.platform === 'win32' ? signer : 'bash', process.platform === 'win32' ? signingArgs : [signer, ...signingArgs], { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (signing.status !== 0) process.exit(signing.status ?? 1);
  rmSync(unsignedPath, { force: true });
  rmSync(apkPath, { force: true });
  renameSync(signedPath, apkPath);
  const verification = spawnSync(process.platform === 'win32' ? signer : 'bash', process.platform === 'win32' ? ['verify', '--verbose', '--print-certs', apkPath] : [signer, 'verify', '--verbose', '--print-certs', apkPath], { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (verification.status !== 0) process.exit(verification.status ?? 1);
  console.log(`APK signed and verified with ${signingConfig.source}.`);
  console.log(`APK: ${apkPath}`);
}
process.exit(result.status ?? 1);
