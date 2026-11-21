import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir(new URL('../docs/images/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:3000');
  await page.getByRole('heading', { name: 'The canary network' }).waitFor();
  await page.screenshot({ path: 'docs/images/cover.png' });
  await page.screenshot({ path: 'docs/images/overview.png', fullPage: true });
  await page.goto('http://127.0.0.1:3000/?mode=testnet');
  await page.getByRole('heading', { name: 'On-chain alarm latched.' }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'docs/images/live-dashboard.png', fullPage: true });
  console.log('Captured product overview, 1600×900 cover and real testnet dashboard.');
} finally { await browser.close(); }
