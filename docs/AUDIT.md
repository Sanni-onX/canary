# Audit status

QCAI Stage 1 was completed on 2026-11-21. The original report is preserved in
`docs/audit/2026-11-21-stage-1.pdf`: score 72/100, medium risk, five findings.
Contracts are not ready for custody. Stage 2 remains pending.

## Stage 1 finding dispositions

The report contains brief recommendations without exploit traces. Its line
numbers do not consistently match the individual source files; dispositions
therefore refer to the named functions in the submitted revision-2 source.

| Finding | Disposition | Source evidence |
| --- | --- | --- |
| HIGH: missing reentrancy guard on withdrawPQ | False positive; no contract change | `PQVault.withdrawPQ` already declares `external nonReentrant`. |
| MEDIUM: rolling spend overflow | No change: checked arithmetic already used | Solidity 0.8.28 checks `total += entry.amount`; there is no unchecked block. Classical releases also enforce `used <= limit` and `amount <= limit - used` before recording spend. |
| MEDIUM: vault creation front-running | False positive under current authority model | `createVault` requires `owner == msg.sender`; the PQ binding includes owner, chain, factory, initial policy, rescue, key hash and the owner's creation nonce. Another sender cannot consume that owner's nonce by copying the transaction arguments. |
| LOW: unbounded canary loop | False positive; bounded by design | `MAX_CANARIES = 16`; insertion refuses a seventeenth slot. Epoch replacement reuses a slot rather than growing the array. |
| INFO: missing ERC-165 | No change: no required discoverable interface | The vault does not claim ERC-165 or NFT receiver interface support. QOR/ERC-20 custody does not require implementing IERC165. Adding an interface declaration without a consumer requirement adds no protection. |

Validation on 2026-11-21: all 27 core and rotation tests passed, including
`testReentrancyCannotUseAnOtherwiseValidNextPQAuthorization`,
`testFactoryRequiresOwnerAndProofAndInitializationIsOneTime`,
`testRollingTransferStorageBoundFailsClosed`,
`testFuzzClassicalAuthorityNeverExceedsRollingBudget` (256 runs), and
`testRepeatedEpochRotationKeepsSixteenSlotsAndReadiness`.
These are source-based dispositions, not a claim that the score establishes
security. The second QCAI review remains required to close this workflow.

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

Current revision-2 source has 41 Foundry tests (24 core, 5 rotation, 7 invariants,
5 probes). The expanded invariants each passed 256 campaigns of 500 calls,
including random epoch rotation. Replacement/retirement cannot erase a threshold
breach before watcher inclusion, and reused historical addresses are refused.
The hosted app remains on revision 1. Revision 2 deployed on 23 November; all
four executable runtimes match the compiled source, recorded separately in
`audit/deployment-evidence-v2.json` and `deployments/testnet-v2.json`. The new
registry has not yet been activated with canaries. Revision-1 evidence remains
archived separately under `audit/revision1/`.

PQ backup/domain tests,
watcher integration and desktop/mobile product tests passed. Slither 0.11.5
completed on revision 2 with 37 findings; every finding ID has a disposition and regression
reference in `audit/slither.md`. Raw JSON and exact source hashes are retained.
The high arbitrary-send finding is reviewed as authorized withdrawal plumbing,
not silently suppressed. New unauthorized-release and full-precision drain-floor
fuzz tests passed. Solhint 6.2.5 reports zero errors/eight reviewed warnings.

The flattened, compiling QCAI input and hash are in `audit/qcai/`. The user
completed Stage 1 with the Ethereum setting and supplied the original report.
Its findings and dispositions appear above. Local static reports remain
separate evidence from QCAI.

The Stage 2 packet is ready in `audit/qcai/STAGE2-RESPONSE.md`. Its bundle adds
defense explanations; executable contract behavior is unchanged. Two new
targeted regressions passed, making 29 core/rotation tests on 23 November.

Outstanding: QCAI Stage 2, independent review, production delay bounds,
revision-2 canary activation and wallet-backed end-user flows. Drill account
keys were deliberately retained; no destruction ceremony is claimed.
