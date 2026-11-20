# Gas evidence

## Phase 0 — 20 November 2026

| Measurement | Gas | Evidence / limits |
| --- | ---: | --- |
| Solidity call to the real `pqcVerify`, warm verifier address | 106,662 | `docs/evidence/initial-discovery.json`, block 10,455,150; balance read of the verifier address warmed it before verification. |
| Solidity call to the real `pqcVerify`, cold verifier address | 109,162 | `docs/evidence/discovery.json`, block 10,455,926; balance read of the user's funded address instead. |

Both use a fresh real ML-DSA-87 signature over a 60-byte message and include
external probe call, ABI copying and return overhead measured with `gasleft()`.
The 2,500-gas difference matches warm versus cold address access. Use the cold
measurement for preliminary budgeting, not the initial warm-address figure.

The probe ran with `eth_call` contract creation. This is measured execution, not
a paid transaction receipt. It excludes transaction intrinsic calldata gas,
deployment, vault state updates and governance batch costs. The documentation's
precompile schedule (25,000 + 8 per ABI input byte) is a different scope from
this outer-call measurement. The native hybrid signature fee is also separate.

Compiler: solc 0.8.28, Paris, optimizer 200. The live node reported block gas
limit 4,294,967,295. No vault or governance path gas has been measured yet.
