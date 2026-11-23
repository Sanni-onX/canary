import QRCode from 'qrcode';
export async function GET(){
  const svg=await QRCode.toString('https://web-production-2863d083.up.railway.app/?mode=testnet&tab=Lifeboat',{type:'svg',margin:2,width:220});
  return new Response(svg,{headers:{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
}
