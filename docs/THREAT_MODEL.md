# Threat model

This describes the implemented testnet prototype and its intended production
properties. It is not audited or production-ready. Real testnet proof is in
`docs/evidence/live-drill.json`; browser simulations remain separately labeled.

An attacker can derive classical private keys from exposed public keys,
front-run, submit transactions and race the watcher. ML-DSA-87 remains secure.
Assets are vault funds, alarm integrity and availability of the PQ rescue exit.

## Required properties

- Classical authority only tightens policy; loosening requires PQ and a delay.
- The PQ payload authorises an exit independently of the transaction sender.
- Alarm/history read failures deny classical fund release.
- Immutable implementation, no upgrade admin, no sweep or arbitrary execution.
- Prove possession of the vault's PQ key before trusting the binding.
- Preserve alarm history so reset cannot revive pre-alarm classical requests.

## Honest limits

- Drained bait accounts are a compromise alarm, not quantum attribution.
  Key retention, compromised setup and correlated operators can cause false
  alarms. Threshold voting does not establish independent ceremonies.
- Destruction of a classical key cannot be proved, especially in JavaScript.
- Transactions before detection/inclusion can cause loss. A balance top-up can
  mask a drain; polling every block cannot prevent this.
- Daily spend must be a true rolling bound. Timelocked pending requests also
  need analysis when showing worst-case pre-alarm loss.
- Native windows already constrain classical account transactions. Canary adds
  application policy; it must not imply that EVM transaction signatures are PQ.
- Drain coverage exists only during usable EVM windows. Renewal requires the
  account's classical **and** PQ keys; a PQ key alone cannot renew a destroyed-key
  canary. This build uses finite epochs, with coverage labels and k+1 monitoring.
  Lapse never trips or resets the balance alarm. See `CANARY_EPOCHS.md`.
- Canary addresses are public. An attacker can avoid the bait; the alarm cannot
  promise detection of every classical-key compromise elsewhere.
- Always available PQ exit is a contract policy objective, conditional on chain
  availability, active verifier, gas, submission and a safe rescue destination.
- A plain classical rescue account can itself be attacked. Warn before binding.
- Malicious token behavior, rebasing and transfer fees are unsupported. Deposit
  balance checks do not prove that future token behavior will remain standard.
- No guarantee against compromised browsers, stolen PQ backups or signer bugs.

## Pending design review

Cooling-off reversals, bounded rolling accounting, delayed key rotation and
alarm reset transitions are implemented and tested. External review is still
needed. The prototype registry has 16 lifetime slots including retired entries;
production rotation must address this. The demo's 2-of-3 keys are held by a
single local operator and its delays are intentionally short. Relay availability,
general-user live migration and secure public hosting remain open. Local
encrypted-backup recovery and replay-bound rescue preparation are implemented;
browser key handling remains conditional on a trustworthy device/frontend.
