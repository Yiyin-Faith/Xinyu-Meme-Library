import { _electron as electron, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const testHome = path.join(os.tmpdir(), `puff-desktop-test-${Date.now()}`);
const launchTimeout = Number(env.PUFF_TEST_TIMEOUT || 15000);
const app = await electron.launch({
  executablePath: env.PUFF_TEST_EXE || path.resolve('node_modules/electron/dist/electron.exe'),
  args: env.PUFF_TEST_EXE ? [`--user-data-dir=${testHome}`] : [path.resolve('.'), `--user-data-dir=${testHome}`], env, timeout: launchTimeout,
});
const watchdog = setTimeout(() => { console.error('Desktop test deadline exceeded'); process.exit(1); }, 50000);
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('.meme-card')).toHaveCount(6);
  await page.waitForFunction(() => [...document.querySelectorAll('.meme-card img')].every((img) => img.complete && img.naturalWidth));
  console.log('PASS: native window renders six images; no server.');
  await page.getByRole('button', { name: '新建收藏夹', exact: true }).first().click();
  await page.getByLabel('收藏夹名称').fill('客户端验证');
  await page.getByRole('button', { name: '创建收藏夹', exact: true }).click();
  await expect(page.locator('h1')).toContainText('客户端验证');
  await page.getByRole('button', { name: '全部表情', exact: false }).first().click();
  await page.getByRole('button', { name: '复制 猫猫探头', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('图片已复制');
  const clipboard = await app.evaluate(({ clipboard }) => ({ empty: clipboard.readImage().isEmpty(), size: clipboard.readImage().getSize() }));
  if (clipboard.empty || !clipboard.size.width) throw new Error('Native clipboard image is empty');
  console.log('PASS: create collection, copy SVG sample as PNG; system clipboard contains image.');
  await page.locator('#global-search').fill('猫猫'); await expect(page.locator('.meme-card')).toHaveCount(1);
  await page.getByRole('button', { name: '查看 猫猫探头', exact: true }).click();
  await page.locator('.edit-fields textarea').fill('来自桌面客户端的备注');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('表情信息已保存');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.meme-card')).toHaveCount(6);
  await page.locator('#global-search').fill('来自桌面'); await expect(page.locator('.meme-card')).toHaveCount(1);
  await page.locator('#global-search').fill('');
  const backupPath = path.join(testHome, 'roundtrip.puff.zip');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, backupPath);
  await page.getByRole('button', { name: '导入 / 同步', exact: true }).click();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('完整备份');
  await page.getByRole('button', { name: '导入 / 同步', exact: true }).click();
  await page.locator('.backup-option input[type=file]').setInputFiles(backupPath);
  await expect(page.locator('.toast')).toContainText('恢复完成');
  console.log('PASS: search, edit persistence, export and restore complete archive without duplicates.');
  await mkdir('verification', { recursive: true });
  await page.screenshot({ path: 'verification/windows-client.png', fullPage: true });
  const info = await page.evaluate(() => window.puffDesktop.info());
  await page.evaluate(() => window.puffDesktop.close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
  console.log('PASS: closing hides to tray, window can reopen.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ version: info.version, globalShortcutRegistered: info.shortcut, errors }));
} finally { clearTimeout(watchdog); await app.close(); }
