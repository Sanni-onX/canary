import { mldsa87 } from '@qorechain/pqc';
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from 'viem';

export type Keypair = { publicKey: Uint8Array; secretKey: Uint8Array };
export const generateKeypair = (): Keypair => mldsa87.keygen();
export const sign = (key: Keypair, message: Uint8Array): Uint8Array => mldsa87.sign(key.secretKey, message);
export const verify = (pk: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean => mldsa87.verify(pk, message, signature);
export const hashPublicKey = (pk: Uint8Array): Hex => keccak256(pk);

export function withdrawalAction(token: Address, amount: bigint, to: Address): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('string, address, uint256, address'), ['CANARY_WITHDRAW_V1', token, amount, to]));
}
export function buildTypedDigest(input: { vault: Address; chainId: bigint; nonce: bigint; deadline: bigint; action: Hex }): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('string, uint256, address, uint256, uint256, bytes32'),
    ['CANARY_VAULT_V1', input.chainId, input.vault, input.nonce, input.deadline, input.action]));
}

export type EncryptedKeyBlob = { version: 1; algorithm: 'ML-DSA-87'; kdf: 'PBKDF2-SHA256'; iterations: 310000;
  salt: number[]; iv: number[]; ciphertext: number[]; publicKeyHash: Hex };

function arrayBuffer(value: Uint8Array): ArrayBuffer { return Uint8Array.from(value).buffer; }
async function encryptionKey(password: string, salt: Uint8Array, usage: 'encrypt' | 'decrypt') {
  const material = await crypto.subtle.importKey('raw', arrayBuffer(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: arrayBuffer(salt), iterations: 310000 },
    material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function encryptKeyBlob(keys: Keypair, password: string): Promise<EncryptedKeyBlob> {
  if (keys.publicKey.length !== 2592 || keys.secretKey.length !== 4896) throw new Error('Invalid ML-DSA-87 key size.');
  if (password.length < 12) throw new Error('Use a backup password of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new Uint8Array(2592 + 4896);
  plaintext.set(keys.publicKey); plaintext.set(keys.secretKey, 2592);
  const keyHash = hashPublicKey(keys.publicKey);
  try {
    const key = await encryptionKey(password, salt, 'encrypt');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: arrayBuffer(new TextEncoder().encode(keyHash)) }, key, arrayBuffer(plaintext));
    return { version: 1, algorithm: 'ML-DSA-87', kdf: 'PBKDF2-SHA256', iterations: 310000,
      salt: Array.from(salt), iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)), publicKeyHash: keyHash };
  } finally { plaintext.fill(0); }
}

export async function decryptKeyBlob(blob: EncryptedKeyBlob, password: string): Promise<Keypair> {
  if (blob.version !== 1 || blob.algorithm !== 'ML-DSA-87' || blob.kdf !== 'PBKDF2-SHA256' || blob.iterations !== 310000
    || blob.salt.length !== 16 || blob.iv.length !== 12 || blob.ciphertext.length !== 7504) throw new Error('Unsupported or damaged backup.');
  const key = await encryptionKey(password, Uint8Array.from(blob.salt), 'decrypt');
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(Uint8Array.from(blob.iv)),
    additionalData: arrayBuffer(new TextEncoder().encode(blob.publicKeyHash)) }, key, arrayBuffer(Uint8Array.from(blob.ciphertext))));
  try {
    const keys = { publicKey: plaintext.slice(0, 2592), secretKey: plaintext.slice(2592) };
    if (hashPublicKey(keys.publicKey) !== blob.publicKeyHash) { keys.secretKey.fill(0); throw new Error('Backup public key mismatch.'); }
    return keys;
  } finally { plaintext.fill(0); }
}

/** Store encrypted material only. No signing key is placed into localStorage or sent to a server. */
export async function storeEncryptedBackup(blob: EncryptedKeyBlob): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('canary-keys', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('encrypted');
    request.onerror = () => reject(new Error('Encrypted key storage is unavailable. Keep the downloaded backup.'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('encrypted', 'readwrite');
      tx.objectStore('encrypted').put(blob, blob.publicKeyHash);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(new Error('Encrypted key could not be stored.')); };
    };
  });
}
