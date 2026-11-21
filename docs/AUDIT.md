# Audit status

No external audit has been run. Contracts are not ready for custody.

Follow https://build.qorechain.io/faq using the same EVM/Solidity setting for
both QCAI stages. EVM quantum readiness showing Not scored is expected.

Store dated Stage 1 and Stage 2 PDFs in `docs/audit/`, preserve raw outputs in
`audit/`, and map **every** Stage 1 finding here to a fix and named regression
test, or a justified false positive/no-change disposition. Link this page from
the README and the project's How it's made field.

## Current PQ verification surface

The deployed factory, vault and governance call the real `pqcVerify` through
`PQAuth.sol`. Authorizations bind chain, contract, action, nonce and deadline;
factory binding also includes owner, rescue and policy. Governance enforces
distinct guardian indexes and a timelock. Key rotation requires new-key proof
of possession. No mock verifier was deployed.

`docs/evidence/live-drill.json` records actual normal withdrawal, two canary
drains, watcher alarm and real PQ rescue. The blocked classical attempt was a
decoded preflight rejection, not a broadcast transaction. Local mocks test
authorization plumbing; they do not prove ML-DSA cryptography.

`audit/deployment-evidence.json` archives actual deployed bytecode and creation
inputs. Executable runtime comparison passed for governance, registry, factory
and vault implementation, excluding compiler metadata and declared immutable
slots only. This is not explorer verification or an external audit.

Current revision-2 source has 39 Foundry tests (22 core, 5 rotation, 7 invariants,
5 probes). The expanded invariants each passed 256 campaigns of 500 calls,
including random epoch rotation. Replacement/retirement cannot erase a threshold
breach before watcher inclusion, and reused historical addresses are refused.
The active deployment remains revision 1; its reports are archived separately
under `audit/revision1/` and its source commit is pinned in the manifest.

PQ backup/domain tests,
watcher integration and desktop/mobile product tests passed. Slither 0.11.5
completed on revision 2 with 37 findings; every finding ID has a disposition and regression
reference in `audit/slither.md`. Raw JSON and exact source hashes are retained.
The high arbitrary-send finding is reviewed as authorized withdrawal plumbing,
not silently suppressed. New unauthorized-release and full-precision drain-floor
fuzz tests passed. Solhint 6.2.5 reports zero errors/eight reviewed warnings.

The flattened, compiling QCAI input and hash are in `audit/qcai/`. The external
site is signed in on testnet. After explicit human approval to share code only,
the complete revision-2 bundle (85,017 characters) was entered with the Ethereum
(EVM/Solidity) setting. The Confirm Security Audit dialog displays 150 QOR.
Its final confirmation is left to the human. No completed external audit,
payment or report is claimed. These local reports are not QCAI.

Outstanding: both QCAI stages, independent review, production delay bounds,
revision-2 rotation deployment and wallet-backed end-user flows. Drill account
keys were deliberately retained; no destruction ceremony is claimed.
