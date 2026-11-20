import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import solc from 'solc';
import { mldsa87 } from '@qorechain/pqc';
import { encodeAbiParameters, encodeFunctionData, decodeAbiParameters, toHex } from 'viem';

export const RPC = 'https://evm-testnet.qore.host';
export const REST = 'https://api-testnet.qore.host';
export const VERIFY = '0x0000000000000000000000000000000000000a01';
export const abi = [{ type: 'function', name: 'pqcVerify', stateMutability: 'view',
  inputs: ['pubkey', 'signature', 'message'].map(name => ({ name, type: 'bytes' })),
  outputs: [{ name: 'valid', type: 'bool' }] }];

export function decodeVerdict(data) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(data)) throw new Error('Verifier returned malformed or empty data');
  const value = BigInt(data);
  if (value !== 0n && value !== 1n) throw new Error('Verifier returned a non-boolean word');
  return value === 1n;
}

export async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  if (body.result === undefined) throw new Error(`${method}: missing result`);
  return body.result;
}

export async function compileProbe() {
  const paths = ['DiscoveryCall.sol', 'DiscoveryProbe.sol', 'interfaces/IQorePQC.sol'];
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path,
    { content: await readFile(new URL(`../contracts/src/${path}`, import.meta.url), 'utf8') }])));
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (output.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return output.contracts['DiscoveryCall.sol'].DiscoveryCall.evm.bytecode.object;
}

export async function main() {
  const report = { observedAt: new Date().toISOString(), network: 'qorechain-diana', rpc: RPC,
    broadcast: false, compiler: solc.version(), checks: {} };
  const keypair = mldsa87.keygen(); // Ephemeral probe key, never funded, stored or logged.
  try {
    const chainId = await rpc('eth_chainId', []);
    if (BigInt(chainId) !== 9800n) throw new Error(`Refusing unexpected chain ${chainId}`);
    const res = await fetch(`${REST}/cosmos/evm/vm/v1/params`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`params: HTTP ${res.status}`);
    const params = await res.json();
    report.checks.precompiles = params.params.active_static_precompiles;
    if (!report.checks.precompiles.some(a => a.toLowerCase() === VERIFY)) throw new Error('PQC precompile inactive');
    const block = await rpc('eth_getBlockByNumber', ['latest', true]);
    const tag = block.number;
    report.block = BigInt(tag).toString();
    report.blockGasLimit = BigInt(block.gasLimit).toString();
    const target = process.env.CANARY_TEST_ADDRESS || block.transactions[0]?.from || VERIFY;
    const message = new TextEncoder().encode('Canary Phase 0 discovery: not a transaction or authorisation');
    const sig = mldsa87.sign(keypair.secretKey, message);
    const args = [toHex(keypair.publicKey), toHex(sig), toHex(message)];
    const data = encodeFunctionData({ abi, functionName: 'pqcVerify', args });
    report.checks.validSignature = decodeVerdict(await rpc('eth_call', [{ to: VERIFY, data }, tag]));
    args[2] = toHex(new TextEncoder().encode('Canary tampered message'));
    report.checks.tamperedSignature = decodeVerdict(await rpc('eth_call', [{ to: VERIFY,
      data: encodeFunctionData({ abi, functionName: 'pqcVerify', args }) }, tag]));
    if (!report.checks.validSignature || report.checks.tamperedSignature) throw new Error('A2 signature checks failed');
    const creation = await compileProbe();
    const encoded = encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }],
      [target, toHex(keypair.publicKey), toHex(sig), toHex(message)]);
    const result = await rpc('eth_call', [{ data: `0x${creation}${encoded.slice(2)}`, gas: '0x989680' }, tag]);
    const [balance, valid, gas] = decodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }], result);
    const expected = BigInt(await rpc('eth_getBalance', [target, tag]));
    if (balance !== expected || !valid) throw new Error('A1/A2 Solidity probe mismatch');
    report.checks.solidityProbe = { target, nativeBalance: balance.toString(), rpcBalance: expected.toString(), valid,
      verifierCallGas: gas.toString(), method: 'eth_call contract creation; no persistent deployment' };
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    keypair.secretKey.fill(0); // Best-effort JS memory wipe; no proof of destruction.
    await mkdir(new URL('../docs/evidence/', import.meta.url), { recursive: true });
    await writeFile(new URL('../docs/evidence/discovery.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
