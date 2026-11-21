import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseAbi, decodeFunctionData, encodeFunctionResult, toHex, zeroAddress } from 'viem';

const registry = '0x0000000000000000000000000000000000000b17'; // Test RPC fixture only.
const abi = parseAbi(['function canaryCount() view returns(uint256)', 'function thresholdK() view returns(uint256)',
  'function toleranceBps() view returns(uint256)', 'function alarmed() view returns(bool)',
  'function canaries(uint256) view returns(address,uint256,bytes32,uint64,bool)']);

test('once mode persists snapshots and requests submission without claiming an alarm or using a key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canary-watcher-test-'));
  const database = join(directory, 'watcher.sqlite');
  const methods = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); methods.push(body.method);
    let result;
    if (body.method === 'eth_chainId') result = '0x2648';
    else if (body.method === 'eth_getCode') result = '0x6000';
    else if (body.method === 'eth_getBalance') result = '0x0';
    else if (body.method === 'eth_getBlockByNumber') result = {
      number: '0x64', timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))), hash: `0x${'11'.repeat(32)}`,
      parentHash: `0x${'22'.repeat(32)}`, gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [],
      miner: zeroAddress, nonce: '0x0000000000000000', baseFeePerGas: '0x174876e800',
    };
    else if (body.method === 'eth_call') {
      const { functionName } = decodeFunctionData({ abi, data: body.params[0].data });
      const values = { canaryCount: 2n, thresholdK: 2n, toleranceBps: 100n, alarmed: false,
        canaries: [zeroAddress, 10000n, `0x${'33'.repeat(32)}`, 1n, false] };
      result = encodeFunctionResult({ abi, functionName, result: values[functionName] });
    } else throw new Error(`Unexpected RPC ${body.method}`);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const child = spawn(process.execPath, ['--import', 'tsx', 'services/watcher/src/index.ts', '--once'], {
      cwd: new URL('../../../', import.meta.url), env: { ...process.env, CANARY_REGISTRY_ADDRESS: registry,
        QORE_EVM_RPC_URL: `http://127.0.0.1:${port}`, WATCHER_DB: database, WATCHER_PRIVATE_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, output);
    assert.match(output, /submission_needed/);
    assert.doesNotMatch(output, /alarm_tripped/);
    assert.equal(methods.includes('eth_sendRawTransaction'), false);
    const db = new DatabaseSync(database);
    try {
      assert.equal(db.prepare('SELECT count(*) AS n FROM snapshots').get().n, 2);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key='last_block'").get().value, '100');
      assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE kind='submission_needed'").get().n, 1);
    } finally { db.close(); }
  } finally {
    await new Promise(resolve => server.close(resolve));
    // A fresh mkdtemp directory created by this test only; no user paths accepted.
    const resolved = await realpath(directory);
    assert.equal(dirname(resolved).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
    assert.match(basename(resolved), /^canary-watcher-test-/);
    await rm(resolved, { recursive: true, force: true });
  }
});
