import { createPublicClient, http, isAddress, type Address } from 'viem';
import manifest from '../../../../../deployments/testnet-v2.json';
import { factoryAbi, vaultEvents } from '../../../lib/contracts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get('owner');
  if (!owner || !isAddress(owner)) return Response.json({ error: 'Invalid owner address.' }, { status: 400 });
  try {
    const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 12000, retryCount: 0 }) });
    if (await client.getChainId() !== 9800) throw new Error('Wrong chain.');
    const [block, owned] = await Promise.all([client.getBlockNumber(), client.readContract({ address: manifest.contracts.VaultFactory.address as Address,
      abi: factoryAbi, functionName: 'vaultsOf', args: [owner] })]);
    const vaults = owned.slice(-16);
    const from = block > 8000n ? block - 8000n : 0n;
    const windows = Array.from({ length: Number((block - from) / 1000n) + 1 }, (_, index) => {
      const start = from + BigInt(index) * 1000n;
      return { start, end: start + 999n > block ? block : start + 999n };
    });
    let completeWindow = true;
    const results = vaults.length ? await Promise.all(windows.map(async window => {
      try {
        return await client.getLogs({ address: vaults, events: vaultEvents, strict: true, fromBlock: window.start, toBlock: window.end });
      } catch { completeWindow = false; return []; }
    })) : [];
    const all = results.flat().sort((a, b) => a.blockNumber === b.blockNumber ? Number(b.logIndex - a.logIndex) : a.blockNumber > b.blockNumber ? -1 : 1);
    const events = all.slice(0, 100).map(event => ({ vault: event.address, name: event.eventName, hash: event.transactionHash,
      block: event.blockNumber.toString(), logIndex: event.logIndex, args: JSON.parse(JSON.stringify(event.args, (_, value) => typeof value === 'bigint' ? value.toString() : value)) }));
    return Response.json({ chainId: 9800, owner, from: from.toString(), to: block.toString(), completeWindow,
      truncated: all.length > 100 || owned.length > 16, events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Could not read activity. No simulated events were substituted.' }, { status: 502 }); }
}
