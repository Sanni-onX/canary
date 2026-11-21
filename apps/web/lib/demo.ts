export type Demo = {
  balances: number[]; alarm: boolean; alarmBlock: number | null; block: number;
  vaultBalance: number; spent: number; dailyLimit: number; locked: boolean;
  pending: { amount: number; ready: boolean; cancelled: boolean; invalidated: boolean }[];
  pqNonce: number; activity: { id: number; title: string; detail: string; tone: 'good' | 'warn' | 'neutral' }[];
};
export const initialDemo = (): Demo => ({
  balances: [1, 1, 1, 1, 1, 1], alarm: false, alarmBlock: null, block: 10456000,
  vaultBalance: 12.5, spent: 0.12, dailyLimit: 0.5, locked: false,
  pending: [], pqNonce: 0,
  activity: [{ id: 1, title: 'Simulation ready', detail: 'Six sample canaries · threshold 2 of 6 · no on-chain activity', tone: 'neutral' }],
});
export type Action = { type: 'drain' } | { type: 'trip' } | { type: 'withdraw'; amount: number }
  | { type: 'pq'; amount: number } | { type: 'deposit'; amount: number }
  | { type: 'lock' } | { type: 'tighten' } | { type: 'request'; amount: number }
  | { type: 'advance' } | { type: 'cancel'; index: number } | { type: 'execute'; index: number }
  | { type: 'reset' };
function log(state: Demo, title: string, detail: string, tone: 'good' | 'warn' | 'neutral' = 'neutral'): Demo {
  return { ...state, activity: [{ id: (state.activity[0]?.id ?? 0) + 1, title, detail, tone }, ...state.activity].slice(0, 40) };
}
export function reduceDemo(state: Demo, action: Action): Demo {
  if (action.type === 'reset') return initialDemo();
  const next = { ...state, block: state.block + 1 };
  const frozen = state.alarm || state.locked || state.balances.filter(b => b < 0.99).length >= 2;
  switch (action.type) {
    case 'drain': {
      const index = state.balances.findIndex(b => b > 0);
      if (index < 0) return state;
      return log({ ...next, balances: state.balances.map((b, i) => i === index ? 0 : b) }, `Canary 0${index + 1} drained`, 'Simulated compromised classical key · watcher observation pending', 'warn');
    }
    case 'trip':
      if (state.alarm) return state;
      if (state.balances.filter(b => b < 0.99).length < 2) return log(next, 'Threshold not reached', 'At least two canaries must lose more than 1% of their baseline.');
      return log({ ...next, alarm: true, alarmBlock: next.block, pending: state.pending.map(p => ({ ...p, invalidated: true })) }, 'Alarm latched', 'Classical releases frozen. Funds remain in the vault. PQ rescue remains available.', 'warn');
    case 'withdraw':
      if (frozen) return log(next, 'Classical withdrawal blocked', 'ClassicalFrozen · alarm, drained canaries or vault lockdown', 'warn');
      if (action.amount <= 0 || action.amount > state.vaultBalance || state.spent + action.amount > state.dailyLimit) return log(next, 'Classical withdrawal blocked', 'The amount exceeds your remaining rolling daily budget or vault balance.', 'warn');
      return log({ ...next, vaultBalance: state.vaultBalance - action.amount, spent: state.spent + action.amount }, 'Classical withdrawal completed', `${action.amount} QOR · local simulation`, 'good');
    case 'pq':
      if (action.amount <= 0 || action.amount > state.vaultBalance) return log(next, 'PQ rescue refused', 'Enter an amount within the vault balance.', 'warn');
      return log({ ...next, vaultBalance: state.vaultBalance - action.amount, pqNonce: state.pqNonce + 1 }, 'PQ rescue completed', `${action.amount} QOR to the simulated registered rescue address · browser signature verified locally`, 'good');
    case 'deposit':
      if (action.amount <= 0 || action.amount > 100) return log(next, 'Deposit refused', 'Choose a simulation amount between 0 and 100 QOR.', 'warn');
      return log({ ...next, vaultBalance: state.vaultBalance + action.amount }, 'Deposit completed', `${action.amount} QOR · local simulation`, 'good');
    case 'lock': return log({ ...next, locked: true }, 'Vault locked', 'Classical authority can tighten protection. Unlocking requires PQ approval and a delay.', 'good');
    case 'tighten': return log({ ...next, dailyLimit: Math.min(state.dailyLimit, 0.25) }, 'Policy tightened', 'Daily limit reduced to 0.25 QOR. Raising it requires PQ approval plus a timelock.', 'good');
    case 'request':
      if (frozen || action.amount <= 0 || action.amount > state.vaultBalance || action.amount <= Math.max(0, state.dailyLimit - state.spent)) return log(next, 'Request refused', 'Only an above-budget transfer within the vault balance can enter the classical timelock.', 'warn');
      return log({ ...next, pending: [...state.pending, { amount: action.amount, ready: false, cancelled: false, invalidated: false }] }, 'Withdrawal queued', `${action.amount} QOR · 24-hour delay · invalidated by an alarm`);
    case 'advance': return log({ ...next, spent: 0, pending: state.pending.map(p => ({ ...p, ready: true })) }, 'Simulation advanced 24 hours', 'Rolling allowance restored; existing requests matured. An alarm never resets automatically.');
    case 'cancel': return log({ ...next, pending: state.pending.map((p, i) => i === action.index ? { ...p, cancelled: true } : p) }, 'Withdrawal cancelled', 'No assets released.', 'good');
    case 'execute': {
      const p = state.pending[action.index];
      if (!p || frozen || p.cancelled || p.invalidated || !p.ready || p.amount > state.vaultBalance) return log(next, 'Queued withdrawal blocked', 'Request is not executable, or classical authority is frozen.', 'warn');
      return log({ ...next, vaultBalance: state.vaultBalance - p.amount, spent: state.spent + p.amount,
        pending: state.pending.map((p, i) => i === action.index ? { ...p, cancelled: true } : p) }, 'Queued withdrawal completed', `${p.amount} QOR · local simulation`, 'good');
    }
  }
}
