# Large atomic creation simulation — 21 November 2026

A discarded eth_call constructor combined creation of the registry, two drainable
drill contracts, the factory, a clone, and the complete alarm/rescue flow. Stages
through creation, real PQ binding and normal classical release succeeded, but
the combined final query returned the RPC error `rpc error: code = Internal
desc = out of gas`. Increasing the requested query gas did not resolve it.
We did not establish whether the cause was an RPC cap, execution context or
another chain-specific behavior; no such explanation is asserted as fact.

The bundle also passed in the local EVM with the explicitly test-only bound
verifier. It was **not** accepted as real-chain rescue evidence. Its temporary
diagnostic source was removed from shipping contract scripts after smaller,
actual deployment/transaction steps verified the full product on testnet.

The stronger evidence is now `docs/evidence/live-drill.json`: real deployments,
real factory PQ binding, real PQ governance queues, matured timelocks, a normal
classical transfer, retained-key drill drains, watcher-submitted alarm,
decoded `ClassicalFrozen` rejection, and real on-chain PQ rescue. The reproducible
`scripts/product-smoke.mjs` checks those actual receipts and final state read-only.

No mock verifier was deployed or used for those network transactions.
