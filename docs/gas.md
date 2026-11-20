# Gas evidence

## Phase 0 — 20 November 2026

| Measurement | Gas | Evidence / limits |
| --- | ---: | --- |
| Solidity call to the real `pqcVerify` | 106,662 | `docs/evidence/discovery.json`, testnet block 10,455,150, fresh ML-DSA-87 key/signature, 60-byte message. Includes external probe call, ABI copying and return overhead measured with `gasleft()`. |

The probe ran with `eth_call` contract creation. This is measured execution, not
a paid transaction receipt. It excludes transaction intrinsic calldata gas,
deployment, vault state updates and governance batch costs. The documentation's
precompile schedule (25,000 + 8 per ABI input byte) is a different scope from
this outer-call measurement. The native hybrid signature fee is also separate.

Compiler: solc 0.8.28, Paris, optimizer 200. The live node reported block gas
limit 4,294,967,295. No vault or governance path gas has been measured yet.
