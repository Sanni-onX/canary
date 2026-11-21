import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeypair, sign, verify, hashPublicKey, encryptKeyBlob, decryptKeyBlob, buildTypedDigest, withdrawalAction } from '../src/index.js';
import { zeroAddress, hexToBytes } from 'viem';

test('encrypted backup roundtrips a real signing key and rejects wrong password/tampering', async () => {
  const key = generateKeypair();
  let restored;
  try {
    const blob = await encryptKeyBlob(key, 'Strong test password 2026');
    assert.equal(blob.ciphertext.length, 7504);
    assert.notDeepEqual(blob.ciphertext.slice(0, 32), Array.from(key.secretKey.slice(0, 32)));
    restored = await decryptKeyBlob(blob, 'Strong test password 2026');
    assert.equal(hashPublicKey(restored.publicKey), hashPublicKey(key.publicKey));
    const message = new TextEncoder().encode('Recovered backup can sign');
    assert.equal(verify(key.publicKey, message, sign(restored, message)), true);
    await assert.rejects(decryptKeyBlob(blob, 'Wrong test password 2026'));
    const damaged = structuredClone(blob); damaged.ciphertext[17] ^= 1;
    await assert.rejects(decryptKeyBlob(damaged, 'Strong test password 2026'));
    const rebound = structuredClone(blob); rebound.publicKeyHash = `0x${'00'.repeat(32)}`;
    await assert.rejects(decryptKeyBlob(rebound, 'Strong test password 2026'));
  } finally { key.secretKey.fill(0); restored?.secretKey.fill(0); }
});

test('backup rejects weak passwords and malformed key material', async () => {
  const key = generateKeypair();
  try {
    await assert.rejects(encryptKeyBlob(key, 'short'));
    await assert.rejects(encryptKeyBlob({ publicKey: key.publicKey.slice(1), secretKey: key.secretKey }, 'Strong test password 2026'));
  } finally { key.secretKey.fill(0); }
});

test('digest-bound signatures do not replay across chain, vault, nonce, recipient or action', () => {
  const key = generateKeypair();
  try {
    const input = { vault: '0x000000000000000000000000000000000000beef' as const, chainId: 9800n, nonce: 7n, deadline: 2000000000n,
      action: withdrawalAction(zeroAddress, 1000000000000000000n, '0x000000000000000000000000000000000000cafe') };
    const digest = buildTypedDigest(input);
    const signature = sign(key, hexToBytes(digest));
    assert.equal(verify(key.publicKey, hexToBytes(digest), signature), true);
    for (const change of [{ chainId: 9801n }, { vault: zeroAddress }, { nonce: 8n }, { deadline: 2000000001n },
      { action: withdrawalAction(zeroAddress, 1000000000000000000n, zeroAddress) }]) {
      assert.equal(verify(key.publicKey, hexToBytes(buildTypedDigest({ ...input, ...change })), signature), false);
    }
  } finally { key.secretKey.fill(0); }
});
