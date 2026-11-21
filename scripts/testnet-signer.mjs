import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
await import('./preload-sdk.mjs');
const { unifiedAccountFromSeed, EthNativeSigner, openEvmWindowMsg, fetchPqcStatus, isRegisteredPqcKey,
  signProofOfPossession, buildRegisterPqcKeyMsg } = await import('@qorechain/sdk');
const { StargateClient } = await import('@cosmjs/stargate');
const REST = 'https://api-testnet.qore.host';
const RPC = 'https://evm-testnet.qore.host';

export async function testnetSigner(localOverride) {
  const chain = defineChain({ id: 9800, name: 'QoreChain Diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const client = createPublicClient({ chain, transport: http(RPC, { timeout: 20000 }) });
  if (await client.getChainId() !== 9800) throw new Error('Testnet only');
  const local = localOverride ?? JSON.parse(await readFile(new URL('../.local/deployer.json', import.meta.url), 'utf8'));
  const seed = Uint8Array.from(Buffer.from(local.classicalSeedHex.slice(2), 'hex'));
  const unified = unifiedAccountFromSeed(seed, { recoveryCode: local.pqcRecoveryCode }); seed.fill(0);
  const account = privateKeyToAccount(local.classicalSeedHex);
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  async function nativeBroadcast(mode, messages) {
    const response = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${unified.cosmos}`, { signal: AbortSignal.timeout(20000) });
    const body = await response.json(); const base = body.account?.base_account ?? body.account;
    if (!response.ok || base?.sequence === undefined) throw new Error('Native account query failed');
    const transport = await StargateClient.connect('https://rpc-testnet.qore.host');
    try {
      const signer = new EthNativeSigner(unified, { signMode: mode, rest: REST });
      const result = await signer.signAndBroadcast(transport, { chainId: 'qorechain-diana', accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence),
        fee: { amount: [{ denom: 'uqor', amount: '100000' }], gas: '800000' },
        messages });
      if (result.code !== undefined && result.code !== 0) throw new Error(`Native transaction failed: ${result.code}`);
      return result.transactionHash;
    } finally { transport.disconnect(); }
  }
  async function openWindow(targets, limits = {}) {
    return nativeBroadcast('hybrid', [openEvmWindowMsg({ sender: unified.cosmos, blocks: 1800n, maxTxs: 20n,
      maxValue: 2000000n, allowedTargets: targets, ...limits })]);
  }
  async function ensurePqc() {
    const status = await fetchPqcStatus({ rest: REST, address: unified.cosmos });
    if (status.registered) {
      if (!isRegisteredPqcKey(status, unified.pqc.publicKey)) throw new Error('Unexpected existing PQ key.');
      return null;
    }
    const proof = signProofOfPossession({ chainId: 'qorechain-diana', account: unified.cosmos, keypair: unified.pqc });
    return nativeBroadcast('classical', [buildRegisterPqcKeyMsg(unified.cosmos, { pqcKeypair: unified.pqc, proofOfPossession: proof })]);
  }
  return { client, wallet, account, nativeAddress: unified.cosmos, openWindow, ensurePqc, dispose: () => unified.pqc.secretKey.fill(0) };
}
