import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData, hexToBytes, keccak256, zeroAddress, parseAbi } from 'viem';
import { verify, buildTypedDigest, withdrawalAction } from '../../packages/pq/src/index';
const vaultAbi = parseAbi(['function withdrawPQ(address,uint256,address,uint256,bytes,bytes)']);

const owner = '0x0000000000000000000000000000000000001234';
const address = '0x0000000000000000000000000000000000005678';
const rescue = '0x0000000000000000000000000000000000009876';
function portfolio(keyHash: string) {
  return { chainId: 9800, owner, block: '100', balance: '2000000000000000000', warnings: [], assets: [],
    approvalScan: { from: '0', to: '100', exhaustive: false }, vaults: [{ address, owner, rescue, keyHash, nonce: '4', locked: false,
      alarm: true, balance: '10000000000000000', dailyLimit: '100000000000000000', delay: '86400', coolingOff: '3600', spent: '0', pending: [], pendingTruncated: false }] };
}

test('encrypted backup recovers a real signing key and exports only a checked, nonce-bound rescue authorization', async ({ page }) => {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push({ url: request.url(), body: request.postDataJSON() }); });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Lifeboat' }).click();
  await page.getByLabel('Encryption password').fill('Canary recovery password 2026!');
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate key & download encrypted backup' }).click();
  const backupFile = await backupDownload;
  const backup = JSON.parse(await readFile((await backupFile.path())!, 'utf8'));
  await page.route('**/api/portfolio?*', route => route.fulfill({ json: portfolio(backup.publicKeyHash) }));
  await page.route('**/api/preflight', route => route.fulfill({ json: { success: true } }));
  await page.getByLabel('Environment').selectOption('testnet');
  await page.getByLabel('Owner EVM address').fill(owner);
  await page.getByRole('button', { name: 'Discover vaults & review assets' }).click();
  await page.getByRole('button', { name: 'Use encrypted backup saved on this device' }).click();
  await page.getByLabel('Backup password', { exact: true }).fill('Wrong password');
  await page.getByRole('button', { name: 'Unlock recovery key', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Could not unlock' })).toBeVisible();
  await page.getByLabel('Backup password', { exact: true }).fill('Canary recovery password 2026!');
  await page.getByRole('button', { name: 'Unlock recovery key', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'unlocked on this device' })).toBeVisible();
  const authorizationDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Sign & check rescue authorization' }).click();
  const authorizationFile = await authorizationDownload;
  const authorization = JSON.parse(await readFile((await authorizationFile.path())!, 'utf8'));
  const decoded = decodeFunctionData({ abi: vaultAbi, data: authorization.data });
  expect(decoded.functionName).toBe('withdrawPQ');
  if (decoded.functionName !== 'withdrawPQ') throw new Error('Wrong call.');
  const [token, amount, to, deadline, pk, signature] = decoded.args;
  expect(keccak256(pk)).toBe(backup.publicKeyHash);
  expect(to).toBe(rescue); expect(token).toBe(zeroAddress);
  const digest = buildTypedDigest({ vault: address, chainId: 9800n, nonce: 4n, deadline, action: withdrawalAction(token, amount, to) });
  expect(verify(hexToBytes(pk), hexToBytes(digest), hexToBytes(signature))).toBe(true);
  expect(verify(hexToBytes(pk), hexToBytes(buildTypedDigest({ vault: address, chainId: 9800n, nonce: 5n, deadline, action: withdrawalAction(token, amount, to) })), hexToBytes(signature))).toBe(false);
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toContain('/api/preflight');
  expect(JSON.stringify(posts)).not.toMatch(/secretKey|password|ciphertext|privateKey/);
  await page.getByRole('button', { name: 'Lock recovery key', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign & check rescue authorization' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('live reports match chain bindings and reject a report for another vault', async ({ page }) => {
  const keyHash = `0x${'12'.repeat(32)}`;
  const secondVault = '0x0000000000000000000000000000000000007777';
  const data = portfolio(keyHash);
  data.vaults.push({ ...data.vaults[0], address: secondVault });
  await page.route('**/api/portfolio?*', route => route.fulfill({ json: data }));
  await page.goto('/?mode=testnet');
  await page.getByRole('navigation').getByRole('button', { name: 'Lifeboat' }).click();
  await page.getByLabel('Owner EVM address').fill(owner);
  await page.getByRole('button', { name: 'Discover vaults & review assets' }).click();
  await expect(page.getByRole('heading', { name: 'Your live PQ-Wrap vault' })).toBeVisible();
  await page.getByRole('button', { name: 'Save migration record' }).click();
  const report = { version: 1, chainId: 9800, owner, vault: rescue, keyHash, updatedAt: new Date().toISOString(), receipts: [],
    snapshot: { rescue, dailyLimitWei: '100000000000000000', timelockSeconds: '86400', coolingOffSeconds: '3600', observedBlock: '100' } };
  await page.getByLabel('Restore a migration report').setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
  await expect(page.getByRole('status').filter({ hasText: 'does not match the live owner' })).toBeVisible();
  await page.getByLabel('Restore a migration report').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...report, vault: address, secretKey: 'must never be persisted' })) });
  await expect(page.getByRole('status').filter({ hasText: 'Report restored' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify(Object.values(localStorage)));
  expect(stored).not.toContain('secretKey'); expect(stored).not.toContain('must never');
  await page.getByLabel('Select protected vault').selectOption(secondVault);
  await page.getByRole('button', { name: 'Save migration record', exact: true }).click();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('canary-migration-v1:')).length)).toBe(2);
  await page.getByLabel('Select protected vault').selectOption(address);
  await expect(page.getByRole('button', { name: 'Restart migration record', exact: true })).toBeVisible();
});

test('read and preflight endpoints reject malformed or cross-origin requests before chain access', async ({ request }) => {
  expect((await request.get('/api/portfolio?owner=not-an-address')).status()).toBe(400);
  expect((await request.post('/api/preflight', { data: {}, headers: { origin: 'https://unrelated.example' } })).status()).toBe(403);
});

test('finite epochs show expiring/lapsed coverage and threshold margin without inventing a drain alarm', async ({ page }) => {
  const statuses = ['Covered', 'Expiring', 'Lapsed'];
  const fixture = () => ({ configured: true, chainId: 9800, network: 'qorechain-diana', block: '100', observedAt: new Date().toISOString(),
    bounds: 'Demo', alarm: false, registryReady: true, threshold: 2, toleranceBps: 100, contracts: {}, vault: null, drill: null,
    canaries: statuses.map((status, index) => ({ index, address: owner, baselineWei: '1000000000000000000', balanceWei: '1000000000000000000',
      retired: false, drained: false, coverage: { status, reason: 'Observed window state', remainingBlocks: status === 'Covered' ? '2000' : status === 'Expiring' ? '300' : '0', expiryHeight: '2100', openedHeight: '1' } })),
    coverage: { covered: statuses.filter(status => status !== 'Lapsed').length, expiring: statuses.filter(status => status === 'Expiring').length,
      lapsed: statuses.filter(status => status === 'Lapsed').length, unknown: 0, threshold: 2, margin: 1, desired: 3,
      tripFeasible: statuses.filter(status => status !== 'Lapsed').length >= 2, degraded: true, blockSeconds: 1, note: 'Finite epochs; no PQ-only renewal.' } });
  await page.route('**/api/protocol', route => route.fulfill({ json: fixture() }));
  await page.goto('/?mode=testnet');
  await expect(page.getByText('Coverage degraded', { exact: true })).toBeVisible();
  await expect(page.getByText('Expiring', { exact: true })).toBeVisible();
  await expect(page.getByText('Lapsed', { exact: true })).toHaveCount(1);
  statuses[1] = 'Lapsed';
  await page.getByRole('button', { name: 'Refresh', exact: false }).click();
  await expect(page.getByText('Lapsed', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Fewer than k intact canaries are covered.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On-chain alarm latched.' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Canary lab' }).click();
  await expect(page.getByRole('heading', { name: 'Prepare the next epoch' })).toBeVisible();
  await expect(page.getByText('No automatic renewal or key destruction runs here.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
