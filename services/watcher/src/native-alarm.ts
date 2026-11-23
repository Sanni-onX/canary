import {encodeFunctionData,parseAbi,hexToBytes} from 'viem';
export function hasNativeAlarmBot(){return Boolean(process.env.WATCHER_NATIVE_ACCOUNT);}
export async function nativeAlarmBotAddress(){
  if(!process.env.WATCHER_NATIVE_ACCOUNT)return null;
  await import('@cosmjs/crypto');
  const {unifiedAccountFromSeed}=await import('@qorechain/sdk');
  const data=JSON.parse(process.env.WATCHER_NATIVE_ACCOUNT);
  if(data.testnetAlarmBot!==true||!/^0x[0-9a-fA-F]{64}$/.test(data.classicalSeedHex)||typeof data.pqcRecoveryCode!=='string')throw new Error('Invalid dedicated alarm bot configuration');
  const seed=hexToBytes(data.classicalSeedHex);
  const account=unifiedAccountFromSeed(seed,{recoveryCode:data.pqcRecoveryCode});seed.fill(0);
  try{return {native:account.cosmos,evm:account.evm};}finally{account.pqc.secretKey.fill(0);}
}
export async function submitNativeAlarm(registry:`0x${string}`){
  await import('@cosmjs/crypto');
  const {unifiedAccountFromSeed,EthNativeSigner,msg,fetchPqcStatus,isRegisteredPqcKey}=await import('@qorechain/sdk');
  const {StargateClient}=await import('@cosmjs/stargate');
  await nativeAlarmBotAddress(); // Validate isolated testnet bot configuration first.
  const data=JSON.parse(process.env.WATCHER_NATIVE_ACCOUNT!);
  const seed=hexToBytes(data.classicalSeedHex);
  const account=unifiedAccountFromSeed(seed,{recoveryCode:data.pqcRecoveryCode});seed.fill(0);
  const transport=await StargateClient.connect('https://rpc-testnet.qore.host');
  try{
    if(await transport.getChainId()!=='qorechain-diana')throw new Error('Native alarm bot refuses non-testnet chain');
    const status=await fetchPqcStatus({rest:'https://api-testnet.qore.host',address:account.cosmos});
    if(!status.registered||!isRegisteredPqcKey(status,account.pqc.publicKey))throw new Error('Alarm bot PQ registration missing or mismatched');
    const state=await transport.getAccount(account.cosmos);if(!state)throw new Error('Alarm bot needs test QOR funding');
    const balance=await transport.getBalance(account.cosmos,'uqor');
    if(BigInt(balance.amount)<100000n)throw new Error('Alarm bot needs at least 0.1 test QOR for submission');
    const call=msg.crossvm.crossVmCall({sender:account.cosmos,sourceVm:'cosmwasm',targetVm:'evm',targetContract:registry,
      payload:hexToBytes(encodeFunctionData({abi:parseAbi(['function checkAndTrip() returns(bool)']),functionName:'checkAndTrip'})),funds:[],async:false,asyncGasLimit:'0',asyncMaxFactor:'0'});
    const signer=new EthNativeSigner(account,{signMode:'hybrid',rest:'https://api-testnet.qore.host'});
    const result=await signer.signAndBroadcast(transport,{chainId:'qorechain-diana',accountNumber:BigInt(state.accountNumber),sequence:BigInt(state.sequence),fee:{amount:[{denom:'uqor',amount:'100000'}],gas:'800000'},messages:[call]});
    if(result.code!==undefined&&result.code!==0)throw new Error(`Native alarm submission failed (code ${result.code})`);
    return result.transactionHash;
  }finally{transport.disconnect();account.pqc.secretKey.fill(0);}
}
