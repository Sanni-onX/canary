import { isAddress, type Address, type Hex } from 'viem';

export type MigrationRecord = { version: 1; chainId: 9800; owner: Address; vault: Address;
  keyHash: Hex; updatedAt: string; receipts: { hash: Hex; purpose: string }[];
  snapshot: { rescue: Address; dailyLimitWei: string; timelockSeconds: string; coolingOffSeconds: string; observedBlock: string } };

export function parseMigrationRecord(input: unknown): MigrationRecord {
  if (!input || typeof input !== 'object') throw new Error('Invalid migration report.');
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || value.chainId !== 9800 || !isAddress(value.owner as string) || !isAddress(value.vault as string)
    || typeof value.keyHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(value.keyHash)
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !Array.isArray(value.receipts) || value.receipts.length > 100) throw new Error('Invalid migration report.');
  const receipts = value.receipts.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid receipt.');
    const receipt = item as Record<string, unknown>;
    if (typeof receipt.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(receipt.hash)
      || typeof receipt.purpose !== 'string' || receipt.purpose.length > 100) throw new Error('Invalid receipt.');
    return { hash: receipt.hash as Hex, purpose: receipt.purpose };
  });
  const snapshot = value.snapshot as Record<string, unknown> | undefined;
  if (!snapshot || !isAddress(snapshot.rescue as string) || ['dailyLimitWei', 'timelockSeconds', 'coolingOffSeconds', 'observedBlock']
    .some(field => typeof snapshot[field] !== 'string' || !/^\d{1,78}$/.test(snapshot[field] as string))) throw new Error('Invalid policy snapshot.');
  // Construct a fresh allowlisted object: an imported file cannot smuggle key material into storage.
  return { version: 1, chainId: 9800, owner: value.owner as Address, vault: value.vault as Address,
    keyHash: value.keyHash as Hex, updatedAt: value.updatedAt, receipts,
    snapshot: { rescue: snapshot.rescue as Address, dailyLimitWei: snapshot.dailyLimitWei as string, timelockSeconds: snapshot.timelockSeconds as string,
      coolingOffSeconds: snapshot.coolingOffSeconds as string, observedBlock: snapshot.observedBlock as string } };
}

export function migrationStorageKey(owner: Address, vault: Address) { return `canary-migration-v1:${owner.toLowerCase()}:${vault.toLowerCase()}`; }
