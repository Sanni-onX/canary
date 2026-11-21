import { createPublicClient, http, isAddress, zeroAddress, type Address } from 'viem';
import manifest from '../../../../../deployments/testnet.json';
import { defaultTokens, erc20Abi, factoryAbi, vaultAbi } from '../../../lib/contracts';

export const dynamic = 'force-dynamic';
const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 15000, retryCount: 1 }) });
function addresses(value: string | null, maximum: number): Address[] {
  if (!value?.trim()) return [];
  const entries = [...new Set(value.split(',').map(item => item.trim().toLowerCase()))];
  if (entries.length > maximum || entries.some(item => !isAddress(item) || item === zeroAddress)) throw new Error('Invalid address list.');
  return entries as Address[];
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  let owner: Address, tokens: Address[], spenders: Address[];
  try {
    owner = url.searchParams.get('owner') as Address;
    if (!isAddress(owner) || owner === zeroAddress) throw new Error('Invalid owner.');
    tokens = [...new Set([...defaultTokens, ...addresses(url.searchParams.get('tokens'), 8)])];
    spenders = addresses(url.searchParams.get('spenders'), 8);
  } catch { return Response.json({ error: 'Enter valid EVM addresses; at most 8 custom tokens and 8 spenders.' }, { status: 400 }); }
  try {
    if (await client.getChainId() !== 9800) throw new Error('Wrong chain.');
    const block = await client.getBlock();
    const blockNumber = block.number!;
    const [balance, owned] = await Promise.all([
      client.getBalance({ address: owner, blockNumber }),
      client.readContract({ address: manifest.contracts.VaultFactory.address as Address, abi: factoryAbi, functionName: 'vaultsOf', args: [owner], blockNumber }),
    ]);
    const warnings: string[] = [];
    if (owned.length > 16) warnings.push('Showing the latest 16 vaults.');
    const vaults = await Promise.all(owned.slice(-16).map(async address => {
      const [vaultOwner, rescue, keyHash, nonce, locked, mode, policy, spent, nativeBalance, count] = await Promise.all([
        client.readContract({ address, abi: vaultAbi, functionName: 'owner', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'rescue', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'pqPkHash', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'pqNonce', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'locked', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'mode', blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'policies', args: [zeroAddress], blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'rollingSpent', args: [zeroAddress], blockNumber }),
        client.getBalance({ address, blockNumber }),
        client.readContract({ address, abi: vaultAbi, functionName: 'withdrawalCount', blockNumber }),
      ]);
      const start = count > 20n ? count - 20n : 0n;
      const pending = await Promise.all(Array.from({ length: Number(count - start) }, async (_, index) => {
        const id = start + BigInt(index);
        const [token, to, amount, createdAtBlock, readyAt, done] = await client.readContract({ address, abi: vaultAbi, functionName: 'pendingWithdrawals', args: [id], blockNumber });
        return { id: id.toString(), token, to, amount: amount.toString(), readyAt: readyAt.toString(), done,
          invalidated: createdAtBlock <= mode[1], ready: block.timestamp >= readyAt };
      }));
      return { address, owner: vaultOwner, rescue, keyHash, nonce: nonce.toString(), locked, alarm: mode[0], balance: nativeBalance.toString(),
        dailyLimit: policy[0].toString(), delay: policy[1].toString(), coolingOff: policy[2].toString(), spent: spent.toString(), pending,
        pendingTruncated: count > 20n };
    }));
    // Deliberately bounded event scan; a token list cannot discover every asset or allowance.
    const scanFrom = blockNumber > 8000n ? blockNumber - 8000n : 0n;
    const assets = await Promise.all(tokens.map(async token => {
      try {
        const [symbol, decimals, tokenBalance, vaultBalances] = await Promise.all([
          client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol', blockNumber }),
          client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals', blockNumber }),
          client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber }),
          Promise.all(vaults.map(async vault => ({ vault: vault.address,
            balance: (await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [vault.address], blockNumber })).toString() }))),
        ]);
        if (decimals > 36) throw new Error('Unsupported decimals.');
        const discovered = new Set<Address>(spenders);
        let completeWindow = true;
        for (let from = scanFrom; from <= blockNumber; from += 1000n) {
          try {
            const logs = await client.getContractEvents({ address: token, abi: erc20Abi, eventName: 'Approval', args: { owner },
              fromBlock: from, toBlock: from + 999n > blockNumber ? blockNumber : from + 999n });
            for (const log of logs) if (log.args.spender) discovered.add(log.args.spender);
          } catch { completeWindow = false; break; }
        }
        if (discovered.size > 24) warnings.push(`Approval review for ${token} was capped at 24 spenders. Add specific spenders to check them.`);
        const candidates = [...new Set([...spenders, ...discovered])].slice(0, 24);
        const approvals = await Promise.all(candidates.map(async spender => {
          const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender], blockNumber });
          return { spender, allowance: allowance.toString() };
        }));
        return { token, symbol: symbol.slice(0, 24), decimals, balance: tokenBalance.toString(), vaultBalances,
          approvals: approvals.filter(item => item.allowance !== '0'), completeWindow };
      } catch { warnings.push(`Could not read token ${token}; it has not been treated as a zero balance.`); return null; }
    }));
    return Response.json({ chainId: 9800, owner, block: blockNumber.toString(), timestamp: block.timestamp.toString(), balance: balance.toString(), vaults,
      assets: assets.filter(item => item !== null), warnings, approvalScan: { from: scanFrom.toString(), to: blockNumber.toString(), exhaustive: false },
      factory: manifest.contracts.VaultFactory.address }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Live wallet state could not be read. Nothing has been replaced with sample balances.' }, { status: 502 }); }
}
