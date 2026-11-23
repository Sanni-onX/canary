export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get('hash');
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) return Response.json({error:'Invalid hash'}, {status:400});
  try {
    const response = await fetch(`https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${hash}`, {cache:'no-store', signal:AbortSignal.timeout(15000)});
    if (response.status === 404) return Response.json({confirmed:false}, {status:404});
    if (!response.ok) throw new Error('Receipt query failed');
    const body = await response.json(); const tx = body.tx_response;
    if (!tx || tx.txhash?.toUpperCase() !== hash.toUpperCase() || !/^\d+$/.test(tx.height) || BigInt(tx.height) <= 0n || !Number.isInteger(tx.code)) throw new Error('Invalid receipt');
    return Response.json({confirmed:true, hash:tx.txhash, height:tx.height, code:tx.code}, {headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Receipt verification unavailable'}, {status:502}); }
}
