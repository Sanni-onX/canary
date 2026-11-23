import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto('https://web-production-2863d083.up.railway.app/?mode=testnet&tab=Lifeboat');
 await page.getByLabel('Owner EVM address').fill('0xd81213Ed37038293c30aD1e8f196a0E8Fb74D464');
 await page.getByRole('button',{name:'Discover vaults & review assets'}).click();
 await page.getByRole('heading',{name:'Token migration & delayed withdrawals'}).waitFor({timeout:60000});
 await page.getByRole('heading',{name:'Vault policy controls'}).waitFor();
 await page.getByLabel('Amount',{exact:true}).fill('0.0000000000000000000000000000000000001');
 await page.getByRole('button',{name:'Approve exact token amount',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Enter an exact decimal amount'}).waitFor();
 console.log(JSON.stringify({tokenControlsVisible:true,policyControlsVisible:true,excessPrecisionRefused:true,actualWalletApprovalTested:false}));
}finally{await browser.close();}
