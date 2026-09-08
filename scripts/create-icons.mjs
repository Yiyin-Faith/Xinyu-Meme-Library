import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1208/chrome-win64/chrome.exe`, headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const svg = await readFile('public/icon.svg', 'utf8');
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
  const png = await page.screenshot({ omitBackground: true });
  await writeFile('public/icon.png', png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  await writeFile('public/icon.ico', Buffer.concat([header, png]));
  await mkdir('electron', { recursive: true });
  await writeFile('electron/icon.png', png);
  for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    await page.setViewportSize({ width: size, height: size });
    const data = await page.screenshot({ omitBackground: true });
    for (const file of ['ic_launcher.png', 'ic_launcher_round.png']) await writeFile(`android/app/src/main/res/mipmap-${density}/${file}`, data);
    await page.setViewportSize({ width: Math.round(size * 2.25), height: Math.round(size * 2.25) });
    await page.setContent(`<style>html,body{margin:0;background:transparent;width:100%;height:100%;display:grid;place-items:center}svg{display:block;width:60%;height:60%}</style>${svg}`);
    await writeFile(`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`, await page.screenshot({ omitBackground: true }));
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
  }
  console.log('Windows and Android icons generated.');
} finally { await browser.close(); }
