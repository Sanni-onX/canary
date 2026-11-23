import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base = 'https://web-production-2863d083.up.railway.app';
const manifest = JSON.parse(await readFile(new URL('../deployments/testnet-v2.json', import.meta.url)));
const protocol = await fetch(`${base}/api/protocol`).then(r => { assert.equal(r.status, 200); return r.json(); });
assert.equal(protocol.contracts.CanaryRegistry.address.toLowerCase(), manifest.contracts.CanaryRegistry.address.toLowerCase());
assert.equal(protocol.registryReady, true);
assert.equal(protocol.canaries.length, 3);
const watcher = await fetch('https://watcher-production-64b80e30.up.railway.app/health').then(r => { assert.equal(r.status, 200); return r.json(); });
assert.equal(watcher.registry.toLowerCase(), manifest.contracts.CanaryRegistry.address.toLowerCase());
assert.equal(watcher.healthy, true);
const source = await fetch(`${base}/api/audit-source`).then(r => { assert.equal(r.status, 200); return r.text(); });
const expected = JSON.parse(await readFile(new URL('../audit/qcai/input.json', import.meta.url)));
assert.equal(createHash('sha256').update(source).digest('hex'), expected.sha256);
const result = { observedAt: new Date().toISOString(), base, protocolRevision: 2,
  registry: watcher.registry, registryReady: protocol.registryReady, canaries: protocol.canaries.length,
  coverage: watcher.coverage, watcherHealthy: watcher.healthy, submitterConfigured: watcher.submitterConfigured,
  auditSourceSha256: expected.sha256, checks: ['live revision-2 registry', 'three registered canaries', 'healthy watcher', 'exact Stage 2 source hash'] };
await writeFile(new URL('../docs/evidence/release-smoke.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
