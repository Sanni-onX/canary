import { test, expect } from '@playwright/test';

test('real browser ML-DSA keygen/sign/verify works without a transaction or key upload', async ({ page }, testInfo) => {
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Test browser signing' }).click();
  await expect(page.getByText('Passed · real ML-DSA-87 key generation, signing and verification')).toBeVisible();
  expect(posts).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/discovery-${testInfo.project.name}.png`, fullPage: true });
});

test('without QoreX the page explains the mobile connection requirement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect QoreX' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('HTTPS page inside the QoreX mobile');
});

test('public account errors are visible and do not pretend that checks passed', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ status: 502,
    contentType: 'application/json', body: JSON.stringify({ error: 'Testnet is unavailable' }) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Check account' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Testnet is unavailable');
  await expect(page.getByText('Ready for a live check')).toBeVisible();
});

test('wallet account mismatch is refused before any signing call', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'qorex', { value: { native: {
      capabilities: ['signAndBroadcast'], enable: async () => {},
      getKey: async () => ({ bech32Address: 'qor1different' }),
      signDirect: () => { throw new Error('Signing must never be called'); },
      signAndBroadcast: () => { throw new Error('Signing must never be called'); },
    } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect QoreX' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('differs from the project wallet');
});

test('connection requests only testnet access and never signs', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__canaryCalls', { value: calls });
    Object.defineProperty(window, 'qorex', { value: { native: {
      capabilities: ['signAndBroadcast'],
      enable: async (chain: string) => { calls.push(`enable:${chain}`); },
      getKey: async (chain: string) => {
        calls.push(`getKey:${chain}`);
        return { bech32Address: 'qor1wlxxvzrqpmcrqkqhc2la7jgs7yce58mrjpr86z' };
      },
      signDirect: () => { calls.push('UNEXPECTED_SIGN'); throw new Error('No signing'); },
      signAndBroadcast: () => { calls.push('UNEXPECTED_BROADCAST'); throw new Error('No signing'); },
    } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect QoreX' }).click();
  await expect(page.getByText('Native signing: available')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __canaryCalls: string[] }).__canaryCalls))
    .toEqual(['enable:qorechain-diana', 'getKey:qorechain-diana']);
});
