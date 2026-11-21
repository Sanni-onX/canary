# Finite-epoch ceremony tool

This is the script fallback for Canary Lab. It uses fresh local **testnet-only**
accounts, never a personal wallet export. Private material stays in ignored
`.local/ceremonies/`; public records are under `docs/evidence/ceremonies/`.

```powershell
node scripts/canary-ceremony.mjs prepare
node scripts/canary-ceremony.mjs status <id>
```

Prepare generates one unfunded account and prints its public record only. It
sends no transaction. Fund that address separately if you choose to continue;
the exposure command requires at least 0.35 test QOR for PQ registration,
window fees and the remaining bait balance. Never send real funds.

```powershell
node scripts/canary-ceremony.mjs expose <id> --send
```

This explicit action registers its PQ key, opens a 7,200-block native-only
window with two transactions and a 200,000-uqor maximum-value/fee budget, scoped
to its own address and the demo operator's address, then makes one zero-value
self-transaction. That exposes the classical public key. It saves actual
receipts and an **unsigned** `addCanary` governance proposal. If receipt tracking
is interrupted, `status` reconciles the saved pending hash; exposure refuses to
send another transaction while that hash is unresolved.

Review the public evidence, obtain the guardian quorum and execute the registry
addition after its timelock. The tool does not automate governance approval.
The currently active registry is revision 1, with 16 lifetime slots. Revision-2
replacement proposals must wait for its separate reviewed deployment.

Only after the registered canary matches the confirmed exposure and has at
least 600 live blocks remaining can this deliberate irreversible step run:

```powershell
node scripts/canary-ceremony.mjs attest-destruction <id> --confirm-destruction
```

It removes **only** that tool-generated account's local key file after checking
its resolved path, identity and live chain evidence. The attestation says local
file removal, not proven destruction: JavaScript/OS memory, other copies, SSD
erasure and backups are not verifiable. Both account keys become unavailable
through this tool; the window cannot be renewed. Prepare the next epoch early.

Validation so far: syntax check and fresh unfunded preparation/public status.
No funding, exposure, governance addition or deletion has been run with this
new helper. Earlier testnet drill receipts came from the separate retained-key
drill scripts. This helper is not a claim of a completed burned-key ceremony.
