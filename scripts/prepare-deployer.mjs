import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toHex } from 'viem';
await import('./preload-sdk.mjs');
const { unifiedAccountFromSeed, generatePqcRecoveryCode } = await import('@qorechain/sdk');
const directory = new URL('../.local/', import.meta.url);
await mkdir(directory, { recursive: true });
const path = new URL('deployer.json', directory);
let seed, code;
try {
  const stored = JSON.parse(await readFile(path, 'utf8'));
  seed = Uint8Array.from(Buffer.from(stored.classicalSeedHex.slice(2), 'hex'));
  code = stored.pqcRecoveryCode;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  seed = Uint8Array.from(randomBytes(32)); code = generatePqcRecoveryCode();
  await writeFile(path, JSON.stringify({ testnetOnly: true, classicalSeedHex: toHex(seed), pqcRecoveryCode: code }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
try {
  const account = unifiedAccountFromSeed(seed, { recoveryCode: code });
  const config = { network: 'qorechain-diana', evmChainId: 9800, nativeAddress: account.cosmos,
    evmAddress: account.evm, fundingRequestQor: '5', note: 'Fresh local testnet-only deployer. Secrets stay in ignored .local/. No user wallet keys used.' };
  await writeFile(new URL('../docs/evidence/deployer-public.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
  console.log(JSON.stringify(config, null, 2));
  account.pqc.secretKey.fill(0);
} finally { seed.fill(0); }
