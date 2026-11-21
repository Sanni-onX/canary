import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import solc from 'solc';

const root = fileURLToPath(new URL('../', import.meta.url));
// Canonicalize real filesystem paths before flattening. Forge 1.7.1's flattener
// duplicates OZ's IERC20 re-export under aliases, producing a type-invalid bundle.
const seen = new Set(), sections = [];
async function visit(path) {
  const canonical = await realpath(path);
  if (seen.has(canonical)) return;
  seen.add(canonical);
  const content = await readFile(canonical, 'utf8');
  const imports = [...content.matchAll(/^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/gm)];
  for (const match of imports) {
    if (/\bas\b|\*/.test(match[1])) throw new Error('Audit flattener does not support aliased imports.');
    const dependency = match[2].startsWith('@openzeppelin/') ? resolve(root, 'node_modules', match[2]) : resolve(dirname(canonical), match[2]);
    await visit(dependency);
  }
  const body = content.replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];\s*/gm, '')
    .replace(/^\/\/ SPDX-License-Identifier:.*$/gm, '').replace(/^pragma solidity[^;]+;\s*/gm, '');
  if (/^import\s/m.test(body)) throw new Error('Unsupported import syntax.');
  sections.push(`// Source: ${relative(root, canonical).replaceAll('\\', '/')}\n${body.trim()}\n`);
}
await visit(resolve(root, 'contracts/audit/CanaryBundle.sol'));
const source = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.28;\n\n' + sections.join('\n');
const compilation = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Canary.flattened.sol': { content: source } }, settings: {
  optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi'] } },
} })));
const errors = (compilation.errors ?? []).filter(error => error.severity === 'error');
if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
await mkdir(new URL('../audit/qcai/', import.meta.url), { recursive: true });
await writeFile(new URL('../audit/qcai/Canary.flattened.sol', import.meta.url), source);
await writeFile(new URL('../audit/qcai/source.json', import.meta.url), JSON.stringify({ source }) + '\n');
const hash = createHash('sha256').update(source).digest('hex');
await writeFile(new URL('../audit/qcai/input.json', import.meta.url), JSON.stringify({ preparedAt: new Date().toISOString(),
  setting: 'Ethereum (EVM/Solidity)', file: 'Canary.flattened.sol', sha256: hash, bytes: Buffer.byteLength(source),
  contracts: ['CanaryRegistry', 'PQAuth', 'PQGovernance', 'PQVault', 'VaultFactory'], compiledSuccessfully: true,
  stage1Report: null, stage2Report: null, note: 'Prepared source, not a completed QCAI audit. Use the same setting for both stages.' }, null, 2) + '\n');
console.log(JSON.stringify({ prepared: true, bytes: Buffer.byteLength(source), sha256: hash, compiledSuccessfully: true, root }));
