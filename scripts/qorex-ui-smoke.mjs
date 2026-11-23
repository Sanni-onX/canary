import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('https://web-production-2863d083.up.railway.app/?mode=testnet&tab=Lifeboat');
  await page.getByLabel('Owner EVM address').fill('0xd81213Ed37038293c30aD1e8f196a0E8Fb74D464');
  await page.getByRole('button',{name:'Discover vaults & review assets'}).click();
  await page.getByRole('heading',{name:'QoreX vault transactions'}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Deposit with QoreX',exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign & submit PQ rescue with QoreX',exact:true}).waitFor();
  await page.getByRole('button',{name:'Deposit with QoreX',exact:true}).click();
  await page.getByText('Open Canary in QoreX or install/update the QoreX extension.',{exact:true}).waitFor();
  console.log(JSON.stringify({liveUi:true,ownerVaultDiscovered:true,nativeActionsVisible:true,noWalletRefused:true,actualQorexApprovalTested:false}));
}finally{await browser.close();}
