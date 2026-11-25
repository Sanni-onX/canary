import { test, expect } from '@playwright/test';

test('dashboard presents canaries and a vault, with honest environment separation', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'An early warning. A way out.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Canary 0/ })).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'PQ-Wrap vault' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/canary-overview-${info.project.name}.png`, fullPage: true });
  await page.route('**/api/protocol', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Live data unavailable; no simulation fallback.' }) }));
  await page.getByLabel('Environment').selectOption('testnet');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Live data unavailable; no simulation fallback.');
  await expect(page.getByRole('heading', { name: /Canary 0/ })).toHaveCount(0);
});

test('Q-Day drill latches alarm, blocks classical release and verifies a real PQ signature locally', async ({ page }, info) => {
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Q-Day drill' }).click();
  await page.getByRole('button', { name: 'Drain next canary' }).click();
  await page.getByRole('button', { name: 'Drain next canary' }).click();
  await page.getByRole('button', { name: 'Run watcher check' }).click();
  await expect(page.getByText('ALARM LATCHED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try classical withdrawal' }).click();
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Classical withdrawal blocked' })).toBeVisible();
  await page.getByLabel('Rescue amount in QOR').fill('0.5');
  await page.getByRole('button', { name: 'Run PQ rescue simulation' }).click();
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'PQ rescue completed' })).toBeVisible();
  await expect(page.getByText('Real ML-DSA-87 signature verified in this browser.', { exact: false })).toBeVisible();
  await expect(page.getByText('12.00 QOR', { exact: true })).toBeVisible();
  expect(posts).toEqual([]);
  await page.screenshot({ path: `.artifacts/canary-drill-${info.project.name}.png`, fullPage: true });
});

test('above-budget requests wait, can be cancelled, and never survive an alarm', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'My vault' }).click();
  await page.getByLabel('Amount in QOR').fill('2');
  await page.getByRole('button', { name: 'Queue above-limit withdrawal' }).click();
  await expect(page.getByText('Waiting · 24-hour timelock')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await page.getByRole('navigation').getByRole('button', { name: 'Q-Day drill' }).click();
  await page.getByRole('button', { name: 'Drain next canary' }).click();
  await page.getByRole('button', { name: 'Drain next canary' }).click();
  await page.getByRole('button', { name: 'Run watcher check' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'My vault' }).click();
  await page.getByRole('button', { name: 'Advance simulation 24h' }).click();
  await expect(page.getByText('Permanently invalidated by alarm')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
});

test('Lifeboat requires a real encrypted backup and explicit confirmation before migration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Lifeboat' }).click();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('Download the encrypted backup');
  await page.getByLabel('Encryption password').fill('Canary test password 2026!');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate key & download encrypted backup' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^canary-pq-backup-.*\.json$/);
  await expect(page.getByRole('button', { name: 'Encrypted backup downloaded' })).toBeVisible();
  await page.getByLabel('Type I SAVED MY BACKUP').fill('I SAVED MY BACKUP');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Choose your policy', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('QoreX connection never requests a private key or silently sends a transaction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect QoreX' }).click();
  await expect(page.getByRole('dialog', {name:'Connect QoreX'})).toBeVisible();
  await page.getByRole('button', { name: 'Browser extension', exact:false }).click();
  await expect(page.getByRole('status')).toContainText('QoreX extension');
  await expect(page.getByRole('textbox', { name: /private key|seed phrase/i })).toHaveCount(0);
});

test('QoreX chooser opens without invoking the extension and keeps mobile choice separate', async ({page},info)=>{
  await page.addInitScript(()=>{
    const tracked=window as unknown as {qorex:unknown;extensionConnections:number};
    tracked.extensionConnections=0;
    tracked.qorex={native:{enable:async()=>{tracked.extensionConnections++;},getKey:async()=>({bech32Address:'qor1wlxxvzrqpmcrqkqhc2la7jgs7yce58mrjpr86z'}),signDirect:async()=>{throw new Error('Connection must not sign a transaction');}}};
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Connect QoreX'}).click();
  await expect(page.getByRole('dialog',{name:'Connect QoreX'})).toBeVisible();
  await page.screenshot({path:`.artifacts/wallet-chooser-${info.project.name}.png`});
  await page.getByRole('button',{name:'Mobile wallet',exact:false}).click();
  await expect(page.getByRole('status')).toContainText('Mobile QR pairing is not available');
  expect(await page.evaluate(()=>(window as unknown as {extensionConnections:number}).extensionConnections)).toBe(0);
  await page.getByRole('button',{name:'Back to connection options'}).click();
  await page.getByRole('button',{name:'Browser extension',exact:false}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('QoreX connected on testnet');
  expect(await page.evaluate(()=>(window as unknown as {extensionConnections:number}).extensionConnections)).toBe(1);
  await page.getByRole('button',{name:/qor1wlxxv/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
