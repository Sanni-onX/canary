import { mkdir, writeFile } from 'node:fs/promises';
import { toEvmAddress, toQorAddress } from '@qorechain/evm';
import { REST, rpc } from './discovery.mjs';

const input = process.argv[2];
if (!input) throw new Error('Pass a public qor1 or 0x address, never a private key');
const evm = input.startsWith('qor1') ? toEvmAddress(input) : input;
const native = toQorAddress(evm);
const routes = {
  balances: `/cosmos/bank/v1beta1/balances/${native}`,
  pqc: `/qorechain/pqc/v1/account/${native}`,
  window: `/qorechain/pqc/v1/evm_window/${native}`,
  abstractAccount: `/qorechain/abstractaccount/v1/accounts/${native}`,
  abstractConfig: '/qorechain/abstractaccount/v1/config',
};
const outcomes = await Promise.allSettled(Object.entries(routes).map(async ([name, route]) => {
  const res = await fetch(`${REST}${route}`, { signal: AbortSignal.timeout(20000) });
  return [name, { httpStatus: res.status, body: await res.json() }];
}));
const report = { observedAt: new Date().toISOString(), network: 'qorechain-diana',
  nativeAddress: native, evmAddress: evm, broadcast: false, reads: {} };
for (const [index, outcome] of outcomes.entries()) {
  if (outcome.status === 'fulfilled') report.reads[outcome.value[0]] = outcome.value[1];
  else report.reads[Object.keys(routes)[index]] = { error: outcome.reason.message };
}
if (BigInt(await rpc('eth_chainId', [])) !== 9800n) throw new Error('Unexpected EVM chain');
report.evmBalanceWei = BigInt(await rpc('eth_getBalance', [evm, 'latest'])).toString();
await mkdir(new URL('../docs/evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/evidence/account.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
