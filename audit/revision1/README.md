# Revision-1 local analysis archive

These reports analyzed the original deployed contract sources, pinned to commit
`287b799` in `deployments/testnet.json`. They were retained at client checkpoint
`bdc821c` before revision-2 slot rotation changed registry code. Source hashes
are in `analysis-input.json`. They are engineering scans, not external audits.

Root `audit/slither.json`, `slither.md`, `analysis-input.json` and `qcai/` refer
to current revision-2 source after regeneration. The old deployed runtime
comparison in `audit/deployment-evidence.json` remains historical revision-1
evidence; compiling revision 2 and comparing it to revision 1 should fail for
the changed registry. Do not overwrite that distinction or claim an upgrade.
