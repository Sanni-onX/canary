import { parseAbi } from 'viem';

export const factoryAbi = parseAbi([
  'function vaultsOf(address) view returns(address[])',
  'function bindingDigest(address,bytes32,address,(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff)) view returns(bytes32)',
  'function createVault(address,bytes32,address,(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff),bytes,bytes) returns(address)',
]);
export const vaultAbi = parseAbi([
  'function owner() view returns(address)', 'function rescue() view returns(address)', 'function pqPkHash() view returns(bytes32)',
  'function registry() view returns(address)', 'function pqNonce() view returns(uint256)', 'function locked() view returns(bool)',
  'function mode() view returns(bool alarm,uint256 lastBlock)', 'function rollingSpent(address) view returns(uint256)',
  'function policies(address) view returns(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff)',
  'function withdrawalCount() view returns(uint256)',
  'function pendingWithdrawals(uint256) view returns(address token,address to,uint256 amount,uint256 createdAtBlock,uint256 readyAt,bool done)',
  'function depositToken(address,uint256)', 'function withdrawClassical(address,uint256,address)',
  'function requestWithdrawal(address,uint256,address) returns(uint256)', 'function executeWithdrawal(uint256)',
  'function cancelWithdrawal(uint256)', 'function lock()',
  'function tighten(address,(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff))',
  'function announceLoosen(address,(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff),address,bool,uint256,bytes,bytes) returns(uint256)',
  'function applyLoosen(uint256)', 'function changeCount() view returns(uint256)',
  'function authorizationDigest(bytes32,uint256,uint256) view returns(bytes32)',
  'function pendingChanges(uint256) view returns(address token,(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff) policy,address rescue,bytes32 newKey,bytes32 authorizingKey,bool unlock,uint256 readyAt,bool done)',
  'function withdrawPQ(address,uint256,address,uint256,bytes,bytes)',
]);
export const erc20Abi = parseAbi([
  'function symbol() view returns(string)', 'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
]);
export const vaultEvents = parseAbi([
  'event Deposited(address indexed token,address indexed sender,uint256 amount)',
  'event Withdrawn(address indexed token,address indexed to,uint256 amount,bool postQuantum)',
  'event WithdrawalRequested(uint256 indexed id,address token,address to,uint256 amount,uint256 readyAt)',
  'event WithdrawalCancelled(uint256 indexed id)',
  'event PolicyTightened(address indexed token,uint256 dailyLimit,uint64 delay,uint64 coolingOff)',
  'event Locked()', 'event ChangeAnnounced(uint256 indexed id,uint256 readyAt,bytes32 newKey)',
  'event ChangeApplied(uint256 indexed id)',
]);
// Official Diana fUSD address, verified against the fest FAQ on 21 November.
export const defaultTokens = ['0x97143B771D34ddb9130b807b135Ae675A5a963CA'] as const;
