export default function ThreatModel() {
  return <section className="panel prose"><h2>Protection and limits</h2>
    <p>Canary limits classical authority inside a vault. A registry alarm freezes classical fund release; post-quantum authorization remains the route to the registered rescue address.</p>
    <h3>Rules enforced by the contracts</h3><ul><li>Classical policy changes only tighten protection.</li><li>Alarm and registry failures deny classical release.</li><li>PQ rescue remains authorized in normal, locked and alarm modes.</li><li>During an alarm, PQ withdrawals go only to the registered rescue address.</li><li>Pre-alarm queued withdrawals never revive after a reset.</li><li>Nonce, chain, vault, action and deadline bind each PQ authorization.</li><li>Policy loosening and key rotation require PQ approval and a delay.</li></ul>
    <h3>Coverage</h3><p>Canary permissions expire. Renewal requires both classical and PQ signatures, so destroyed classical keys cannot renew. Coverage uses finite epochs.</p>
    <p>Coverage below the threshold plus one spare is degraded. Expiry does not trigger or reset the alarm. Drill keys are retained; continuous detection and key destruction are unverified.</p>
    <h3>Limits</h3><p>A drain is not proof of a quantum computer. Operators can retain keys or setup can be compromised. An attacker can avoid public bait, race detection or top up accounts to hide loss. JavaScript cannot prove destruction.</p>
    <p>The daily cap does not bound matured large withdrawals. Keep pending requests under review. Recovery depends on chain availability, gas, inclusion, the verifier, a trustworthy device/frontend and a secure rescue address.</p>
    <p>Fee-on-transfer and rebasing tokens are unsupported. One balance-delta check cannot establish future token behavior. The revision-2 registry has 16 current slots with timelocked replacement; retired or replaced account addresses can never be reused within that registry.</p>
    <p>QCAI Stage 1 and Stage 2 each scored 72/100 with five findings; dispositions are documented. Independent security review and end-to-end QoreX approval verification remain pending.</p>
  </section>;
}
