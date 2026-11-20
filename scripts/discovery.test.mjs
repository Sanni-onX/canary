import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mldsa87 } from '@qorechain/pqc';
import { compileProbe, decodeVerdict } from './discovery.mjs';

test('inactive or malformed verifier output fails closed', () => {
  for (const data of ['0x', '0x01', `0x${'0'.repeat(63)}2`, 'junk']) {
    assert.throws(() => decodeVerdict(data));
  }
  assert.equal(decodeVerdict(`0x${'0'.repeat(63)}1`), true);
  assert.equal(decodeVerdict(`0x${'0'.repeat(64)}`), false);
});

test('published ML-DSA-87 backend rejects altered message and key', () => {
  const { publicKey, secretKey } = mldsa87.keygen();
  try {
    const message = new TextEncoder().encode('Canary discovery');
    const sig = mldsa87.sign(secretKey, message);
    assert.equal(publicKey.length, 2592);
    assert.equal(sig.length, 4627);
    assert.equal(mldsa87.verify(publicKey, message, sig), true);
    assert.equal(mldsa87.verify(publicKey, new Uint8Array([1]), sig), false);
    assert.equal(mldsa87.verify(new Uint8Array(2592), message, sig), false);
    assert.equal(mldsa87.verify(publicKey, message, sig.slice(1)), false);
  } finally { secretKey.fill(0); }
});

test('Solidity discovery probes compile with pinned solc', async () => {
  assert.ok((await compileProbe()).length > 0);
});

const vectors = JSON.parse(await readFile(new URL('../docs/evidence/ml-dsa-87.upstream.json', import.meta.url), 'utf8'));
for (const [index, vector] of vectors.cases.entries()) {
  test(`upstream public ML-DSA-87 known-answer vector ${index + 1}`, () => {
    // All values are published upstream test material, never funded wallet keys.
    const bytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));
    const pair = mldsa87.keygen(bytes(vector.seed));
    try {
      assert.deepEqual(pair.publicKey, bytes(vector.publicKey));
      assert.deepEqual(pair.secretKey, bytes(vector.secretKey));
      const signature = mldsa87.sign(pair.secretKey, bytes(vector.message));
      assert.deepEqual(signature, bytes(vector.signature));
      assert.equal(mldsa87.verify(pair.publicKey, bytes(vector.message), signature), true);
    } finally { pair.secretKey.fill(0); }
  });
}
