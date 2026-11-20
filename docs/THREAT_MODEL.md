# Threat model

This describes intended protections, not a finished or audited implementation.

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
- Always available PQ exit is a contract policy objective, conditional on chain
  availability, active verifier, gas, submission and a safe rescue destination.
- A plain classical rescue account can itself be attacked. Warn before binding.
- Malicious token behavior, rebasing and transfer fees are unsupported. Deposit
  balance checks do not prove that future token behavior will remain standard.
- No guarantee against compromised browsers, stolen PQ backups or signer bugs.

## Pending design review

Cooling-off reversals, bounded rolling accounting, relay availability, delayed
key rotation and alarm resets need precise semantics and invariant tests before
core contracts ship. See `ARCHITECTURE.md` for the open design decisions.
