# Canary contracts

Working Diana testnet prototype: CanaryRegistry, PQVault, immutable-clone
VaultFactory and timelocked PQGovernance. Addresses and receipts are in
[`deployments/testnet.json`](../deployments/testnet.json). No mock verifier is
deployed. PQAuth calls QoreChain's real ML-DSA-87 verifier at `0x0a01`.

From the repository root, install with `npm ci`, then run:

```sh
node scripts/forge.mjs build
node scripts/forge.mjs test
```

Pinned compiler: Solidity 0.8.28, Paris, optimizer 200, viaIR. OpenZeppelin 5.6.1
and forge-std 1.9.7 are pinned. The root launcher supports Windows.

Tests comprise 20 core unit/fuzz tests, 6 stateful invariants and 5 discovery
probe tests. Mocks under `test/mocks/` test authorization plumbing only; real
cryptographic verification is separately evidenced by actual testnet receipts.

This deployment uses short demonstration delays and retained-key drill canaries.
It is not audited or ready for real custody. Registry capacity is 16 lifetime
entries, including retired slots; production rotation remains unresolved. Read
the root README, threat model and audit status before changing security policy.

Deployment helpers use fresh local testnet accounts stored only in ignored
`.local/`. Never place personal wallet keys in source or chat. The archived
upstream Counter example is in `.starter/foundry/`.
