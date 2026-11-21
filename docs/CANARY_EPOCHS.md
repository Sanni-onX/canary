# Finite canary coverage epochs — verified 21 November 2026

## Chain constraints

The current window reference explicitly requires the account's **classical plus
ML-DSA-87** hybrid signature for opening/replacing a window. These management
messages must be the owner's top-level messages; authz grants are forbidden.
A retained PQ key alone therefore cannot renew an ordinary EVM window after
the classical key is destroyed. A separate renew-only guardian credential for
this action has not been documented or proven. We do not invent one.

Window limits are 1–17,280 blocks and 1–1,000 transactions, with a positive
value/maximum-fee budget. Duration is block-based; 72 hours is not an accepted
window length on the observed Diana cadence. A new window **replaces** the old
one; these are not independently overlapping leases on one account.

Stored opening/expiry heights, remaining blocks/transactions/value and recipient
scope are public chain state via
`GET /qorechain/pqc/v1/evm_window/{qor1_address}`. No Solidity getter for this
native state is assumed. Saved public observations are in
`docs/evidence/canary-window-coverage.json`. All three original drill windows
had expired at that observation. The prior alarm and rescue receipts remain
valid historical evidence; they do not establish current detection coverage.

Sources:

- https://docs.qorechain.io/developer-guide/evm-window-reference/
- Installed `@qorechain/evm@0.14.0` window bounds, builders and parser.
- https://docs.qorechain.io/developer-guide/post-quantum-signing/

## Selected fallback

The human proposed renewable PQ leases if supported, otherwise finite epochs.
The classical-signature requirement rules out that lease proposal as described,
so this build uses **finite coverage epochs**. No renewal service or burned-key
live demonstration is claimed. Existing drill keys are deliberately retained.
Hidden/Merkle canaries and external-chain signals remain roadmap ideas.

## Coverage model

The same `@canary/coverage` logic runs in the web API and watcher:

- Covered: a live window, enough transaction/value capacity and native balance,
  and a verified permitted EOA recipient make a modeled native drain possible.
- Expiring: the same conditions, with at most 600 blocks remaining.
- Lapsed: window closed/expired/exhausted, or modeled balance/value budget is
  insufficient. This is deliberately conservative; it is not proof that every
  possible attack path is impossible.
- Unknown: RPC/scope/fee data unavailable or a contract-only recipient path was
  not verified. Never promoted to Covered.
- Retired: excluded by governance. Already drained canaries are also excluded
  from **future** coverage counts, independently of their window status.

Budget uses a 21,000-gas plain native transfer and twice the observed gas price.
It accounts for the balance decrease needed to cross the registry's exact
tolerance floor, gas costs, and the remaining uqor window budget. This is a
conservative model, not a guarantee of mempool admission or transaction inclusion.
Coverage is checked off-chain and does not alter immutable registry semantics.

The safety target is **k + 1** intact covered canaries. Below that target the UI
and watcher report coverage degraded; below k they also report that the current
coverage cannot establish detectability of a fresh threshold event. Expiry
alone never submits `checkAndTrip`, never invents a drain and never resets an
alarm. A real historical drain still counts after its window expires.

UI countdowns estimate time using the most recent 60 blocks. Exact expiry block
is shown; stale reads older than 45 seconds become Unknown in the UI. Watcher
status includes opening/expiry blocks, a fresh-read heartbeat, coverage counts
and per-canary epochs; transition alerts persist in SQLite.

## Next-epoch ceremony and rollout

Prepare, fund, PQ-register and expose fresh accounts; open their finite windows
while both keys still exist. Record exact scope, capacities and receipts. Queue
governance additions **before** destruction and leave enough overlap between
different accounts' epochs for the governance delay. Observe coverage, then
attest the actual destruction procedure without claiming it is provable.

There is a further production constraint: this immutable registry has **16
lifetime slots**, including retired entries. It cannot provide indefinite
epoch rotation. A reviewed replacement/rotation design and a new deployment
are required before a sustained production service. Migration of existing vaults
to another immutable registry cannot be silently performed by an administrator.
The current release remains a bounded testnet prototype.
