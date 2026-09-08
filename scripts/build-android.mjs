import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (!existsSync(`android/${gradle}`) && !existsSync('android/gradlew')) {
  console.error('Android 工程不存在，请先运行 npm run android:sync');
  process.exit(1);
}
const env = { ...process.env };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.resolve('.tools/android-sdk');
if (existsSync(sdk)) {
  env.ANDROID_HOME = sdk;
  const escaped = sdk.replaceAll('\\', '/').replace(/[^\x20-\x7E]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  writeFileSync('android/local.properties', `sdk.dir=${escaped}\n`);
}
if (!env.JAVA_HOME) {
  const jdks = path.join(os.homedir(), '.gradle/jdks');
  if (existsSync(jdks)) {
    const java21 = readdirSync(jdks).find((name) => name.includes('-21-') && existsSync(path.join(jdks, name, 'bin/java.exe')));
    if (java21) env.JAVA_HOME = path.join(jdks, java21);
  }
}
const args = ['assembleDebug', '--console=plain', '--no-daemon', '--max-workers=2', '-Dorg.gradle.internal.http.connectionTimeout=15000', '-Dorg.gradle.internal.http.socketTimeout=15000', '-Dhttps.protocols=TLSv1.2', '-Djdk.tls.client.protocols=TLSv1.2', '-Dhttps.proxyType=HTTP'];
if (env.PUFF_GRADLE_OFFLINE === '1') args.push('--offline');
if (env.PUFF_GRADLE_PROXY) {
  const proxy = new URL(env.PUFF_GRADLE_PROXY);
  if (!/^[a-zA-Z0-9.-]+$/.test(proxy.hostname)) throw new Error('Invalid proxy hostname');
  args.push(`-Dhttp.proxyHost=${proxy.hostname}`, `-Dhttp.proxyPort=${proxy.port || '80'}`, `-Dhttps.proxyHost=${proxy.hostname}`, `-Dhttps.proxyPort=${proxy.port || '80'}`);
}
const result = spawnSync(gradle, args, { cwd: 'android', stdio: 'inherit', shell: process.platform === 'win32', env, timeout: 120000, killSignal: 'SIGTERM' });
if (result.status === 0) {
  mkdirSync('release', { recursive: true });
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const apkPath = `release/Xinyu-Meme-Library-${version}-Android-debug.apk`;
  copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk', apkPath);
  console.log(`APK: ${apkPath}`);
}
process.exit(result.status ?? 1);
