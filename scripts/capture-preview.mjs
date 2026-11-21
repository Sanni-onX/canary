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
  await page.goto('http://127.0.0.1:3000/?mode=testnet&tab=Canary%20lab');
  await page.getByRole('heading', { name: 'Prepare the next epoch' }).waitFor({ timeout: 30000 });
  await page.getByText('Coverage degraded', { exact: true }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'docs/images/canary-epochs.png', fullPage: true });
  await page.goto('http://127.0.0.1:3000/?mode=testnet&tab=Lifeboat');
  await page.getByLabel('Owner EVM address').fill('0xd81213Ed37038293c30aD1e8f196a0E8Fb74D464');
  await page.getByRole('button', { name: 'Discover vaults & review assets' }).click();
  await page.getByRole('heading', { name: 'Your live PQ-Wrap vault' }).waitFor({ timeout: 45000 });
  await page.screenshot({ path: 'docs/images/live-recovery.png', fullPage: true });
  console.log('Captured overview, cover, live dashboard, epoch coverage and live recovery workspace.');
} finally { await browser.close(); }
