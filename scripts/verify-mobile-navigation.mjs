import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
const url = process.env.XINYU_TEST_URL || 'http://127.0.0.1:5174';
const cases = [
  { name: 'portrait', width: 390, height: 844, top: 24, bottom: 24 },
  { name: 'small-screen', width: 320, height: 568, top: 24, bottom: 24 },
  { name: 'landscape', width: 740, height: 360, top: 0, bottom: 24 },
];

try {
  await mkdir('verification', { recursive: true });
  for (const size of cases) {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await expect(page.locator('.empty-state')).toBeVisible();
    await page.evaluate(({ top, bottom }) => {
      document.documentElement.style.setProperty('--safe-area-inset-top', `${top}px`);
      document.documentElement.style.setProperty('--safe-area-inset-bottom', `${bottom}px`);
    }, size);
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    const settings = page.locator('.sidebar-bottom').getByRole('button', { name: '偏好设置' });
    await expect(settings).toBeInViewport({ ratio: 1 });
    await expect(settings).toBeVisible();
    await expect.poll(() => settings.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    })).toBe(true);
    const settingsBounds = await settings.boundingBox();
    expect(settingsBounds.y + settingsBounds.height).toBeLessThanOrEqual(size.height - size.bottom);
    await page.screenshot({ path: `verification/mobile-nav-${size.name}.png` });
    await settings.click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
    await expect(page.locator('h1')).toContainText('偏好设置');

    await page.getByRole('button', { name: '返回全部表情', exact: true }).click();
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.evaluate(async () => {
      const { db } = await import('/src/lib/library.ts');
      await db.collections.bulkPut(Array.from({ length: 35 }, (_, index) => ({
        id: `nav-test-${index}`, name: `收藏夹 ${index + 1}`, color: '#6e9d7d', createdAt: Date.now(), updatedAt: Date.now(),
      })));
    });
    await expect(page.locator('.collections .nav-button')).toHaveCount(35);
    await expect(settings).toBeInViewport({ ratio: 1 });
    const scrollable = page.locator('.sidebar-scroll');
    expect(await scrollable.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await scrollable.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const sync = page.locator('.sidebar-tools').getByRole('button', { name: '导入与同步', exact: true });
    await expect(sync).toBeInViewport({ ratio: 1 });
    await expect(settings).toBeInViewport({ ratio: 1 });
    await sync.click();
    await expect(page.locator('h1')).toContainText('导入与同步');
    await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
    expect(errors).toEqual([]);
    console.log(`PASS: ${size.name} ${size.width}x${size.height}; safe areas, settings hit target, drawer closes, 35 collections scroll without hiding settings.`);
    await context.close();
  }
} finally {
  await browser.close();
}
