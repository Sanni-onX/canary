import { toEvmAddress } from '@qorechain/evm';
import { OWNER, REST, CHAIN_ID } from '../../../lib/network';

export const dynamic = 'force-dynamic';

async function read(path: string) {
  const response = await fetch(`${REST}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Testnet query failed (${response.status})`);
  return response.json();
}

export async function GET() {
  try {
    const [balances, pqc, window] = await Promise.all([
      read(`/cosmos/bank/v1beta1/balances/${OWNER}`),
      read(`/qorechain/pqc/v1/account/${OWNER}`),
      read(`/qorechain/pqc/v1/evm_window/${OWNER}`),
    ]);
    return Response.json({
      observedAt: new Date().toISOString(), chainId: CHAIN_ID,
      nativeAddress: OWNER, canonicalEvmAddress: toEvmAddress(OWNER),
      balanceUqor: (balances.balances as { denom: string; amount: string }[])
        .find(coin => coin.denom === 'uqor')?.amount ?? '0',
      pqRegistered: pqc.found === true && pqc.account?.algorithm_id === 1
        && Buffer.from(pqc.account?.public_key ?? '', 'base64').byteLength === 2592,
      possessionProven: pqc.account?.possession_proven === true,
      window: { found: window.found === true, live: window.live === true,
        remainingBlocks: window.remaining_blocks ?? '0', allowedTargets: window.allowed_targets ?? [] },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Testnet could not be reached. Try the account check again.' }, { status: 502 });
  }
}
