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
limit 4,294,967,295. These initial probe measurements precede the receipts below.

## Deployed prototype — 21 November 2026

| Actual transaction | Gas used |
| --- | ---: |
| PQGovernance deployment | 808,568 |
| CanaryRegistry deployment | 667,747 |
| VaultFactory deployment (includes implementation) | 2,953,541 |
| Native vault deposit during drill | 75,000 |
| Normal classical vault withdrawal | 301,384 |
| Classical canary drain, each | 21,000 |
| Watcher alarm latch | 122,443 |
| PQ vault rescue during alarm | 750,000 |

Sources: `deployments/testnet.json` and `docs/evidence/live-drill.json` contain
receipt hashes. Effective gas price was 112,500,000,000 wei for the recorded
drill. These are actual receipt values, not estimates of verifier cost alone.
The blocked post-alarm classical attempt was rejected during preflight and
incurred no transaction fee. Last recorded deployer balance after setup/drill:
2.0122231625 test QOR of the 5 test QOR funded; this is a dated observation,
not a live balance. Native PQ registration/window fees are separate from EVM gas.
