import { writeFile } from 'node:fs/promises';
import { toEvmAddress, toQorAddress } from '@qorechain/evm';
import { REST } from './discovery.mjs';

const input = process.argv[2];
if (!input) throw new Error('Pass a public wallet address');
const account = toQorAddress(input.startsWith('qor1') ? toEvmAddress(input) : input);
// Exact Cosmos SDK v0.53 route/query documented in @qorechain/sdk's searchTxs.
// Use REST directly to avoid the current SDK/CosmJS CJS/ESM import cycle on Node 22.13.
const query = new URLSearchParams({ query: `message.sender='${account}'`, limit: '20', order_by: 'ORDER_BY_DESC' });
const response = await fetch(`${REST}/cosmos/tx/v1beta1/txs?${query}`, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Transaction search failed: HTTP ${response.status}`);
const result = await response.json();
const report = { observedAt: new Date().toISOString(), network: 'qorechain-diana', account,
  broadcast: false, note: 'Existing account history, not a Canary-initiated transaction',
  transactions: (result.tx_responses ?? []).map(tx => ({
    hash: tx.txhash, height: tx.height, code: tx.code,
    events: tx.events,
  })) };
await writeFile(new URL('../docs/evidence/account-transactions.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
