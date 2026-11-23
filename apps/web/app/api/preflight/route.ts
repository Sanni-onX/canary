import { createPublicClient, http, isAddress, decodeFunctionData, zeroAddress, type Address, type Hex } from 'viem';
import manifest from '../../../../../deployments/testnet-v2.json';
import { factoryAbi, vaultAbi, erc20Abi } from '../../../lib/contracts';

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Same-origin requests only.' }, { status: 403 });
  const text = await request.text();
  if (text.length > 32000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  try {
    const body = JSON.parse(text);
    const { owner, to, data, value, vault } = body;
    if (body.chainId !== 9800 || !isAddress(owner) || !isAddress(to) || !isAddress(vault)
      || typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data)
      || typeof value !== 'string' || !/^\d{1,78}$/.test(value)) throw new Error('Invalid transaction.');
    const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 15000, retryCount: 0 }) });
    if (await client.getChainId() !== 9800) throw new Error('Wrong chain.');
    const vaults = await client.readContract({ address: manifest.contracts.VaultFactory.address as Address, abi: factoryAbi,
      functionName: 'vaultsOf', args: [owner as Address] });
    if (!vaults.some(address => address.toLowerCase() === vault.toLowerCase())) throw new Error('Vault is not bound to this owner.');
    if (to.toLowerCase() === vault.toLowerCase()) {
      if (data !== '0x') {
        const decoded = decodeFunctionData({ abi: vaultAbi, data: data as Hex });
        if (!['withdrawPQ', 'withdrawClassical', 'requestWithdrawal', 'executeWithdrawal', 'cancelWithdrawal', 'depositToken', 'lock'].includes(decoded.functionName)
          || value !== '0') throw new Error('Unsupported call.');
      } else if (BigInt(value) === 0n) throw new Error('Empty transaction.');
    } else {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: data as Hex });
      if (decoded.functionName !== 'approve' || value !== '0') throw new Error('Only approval review is supported for token targets.');
      const [spender, allowance] = decoded.args;
      if (allowance !== 0n && spender.toLowerCase() !== vault.toLowerCase()) throw new Error('Approval must be zero or for the selected vault.');
      if (to === zeroAddress) throw new Error('Invalid token.');
    }
    await client.call({ account: owner as Address, to: to as Address, data: data as Hex, value: BigInt(value), gas: 2000000n });
    return Response.json({ success: true, checkedAt: new Date().toISOString(), warning: 'Simulation passed. No transaction was sent; state can change before inclusion.' });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : 'Simulation failed.';
    return Response.json({ success: false, error: detail }, { status: 422 });
  }
}
