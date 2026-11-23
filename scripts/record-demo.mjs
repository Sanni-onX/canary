import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
await mkdir('.artifacts/demo',{recursive:true});
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:'.artifacts/demo',size:{width:1440,height:900}}});
const page=await context.newPage();const video=page.video();
async function caption(text,ms=5000){await page.evaluate(text=>{let el=document.getElementById('demo-caption');if(!el){el=document.createElement('div');el.id='demo-caption';el.style.cssText='position:fixed;bottom:12px;left:10%;width:80%;padding:16px;background:#10201ef2;color:#fff;border:1px solid #e4c662;border-radius:12px;z-index:999999;font:18px system-ui;text-align:center;pointer-events:none';document.body.appendChild(el);}el.textContent=text;},text);await page.waitForTimeout(ms);}
async function tab(name){await page.getByRole('navigation').getByRole('button',{name}).click();await page.evaluate(()=>window.scrollTo(0,0));}
try{
 await page.goto('https://web-production-2863d083.up.railway.app/');
 await caption('Canary: an early warning and a post-quantum way out. This first sequence is the clearly labelled browser simulation.',6000);
 await tab('Lifeboat');
 await page.getByLabel('Encryption password').fill('Demo backup password 2026!');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Generate key & download encrypted backup'}).click();await download;
 await page.getByLabel('Type I SAVED MY BACKUP').fill('I SAVED MY BACKUP');
 await caption('A real ML-DSA-87 key is encrypted locally. The backup and password remain on the user’s device.',5000);
 for(let step=0;step<8;step++){if(step===2)await page.getByLabel('Rescue EVM address').fill('0x000000000000000000000000000000000000b0a7');await page.locator('.wizard-actions .primary').click();await page.waitForTimeout(1000);}
 await page.getByRole('heading',{name:'Export migration report',exact:true}).waitFor();
 await caption('The wizard models policy, rescue, deposits and approval review. Asset movement in this sequence is simulated.',5000);
 await tab('My vault');await page.getByLabel('Amount in QOR',{exact:true}).fill('0.1');
 await page.getByRole('button',{name:'Try classical withdrawal',exact:true}).click();
 await caption('Normal mode permits limited classical spending. Larger withdrawals require an on-chain delay.',5000);
 await tab('Q-Day drill');await page.getByRole('button',{name:'Drain next canary'}).click();await page.getByRole('button',{name:'Drain next canary'}).click();
 await caption('Two simulated canary drains cross the threshold. A drain is a signal—not proof of a quantum computer.',5000);
 await page.getByRole('button',{name:'Run watcher check'}).click();await page.getByRole('button',{name:'Try classical withdrawal',exact:true}).click();
 await caption('The alarm latches. Classical fund release is blocked, including requests invalidated by the alarm.',5000);
 await page.getByLabel('Rescue amount in QOR').fill('0.5');await page.getByRole('button',{name:'Run PQ rescue simulation'}).click();
 await page.getByRole('status').filter({hasText:'PQ rescue completed'}).waitFor();
 await caption('A real browser ML-DSA-87 signature is verified. This asset rescue is simulated; separate real chain receipts are available.',6000);
 await page.getByLabel('Environment').selectOption('testnet');await tab('Overview');
 await page.getByRole('heading',{name:'Deployed contracts'}).waitFor({timeout:60000});
 await caption('Live Diana deployment: verified contracts, real PQ withdrawals and a hosted bot that submitted a real alarm transaction.',6000);
 await page.getByRole('heading',{name:'Canary coverage',exact:true}).scrollIntoViewIfNeeded();
 await caption('Coverage is finite. The dashboard exposes expiry and replacement deadlines. Local PQ governance approves fresh canary epochs.',7000);
 await tab('Threat model');
 await caption('Honest limits: public bait can be avoided, destruction cannot be proven, and coverage needs maintenance. Actual QoreX wallet approval is still awaiting verification.',8000);
}finally{await context.close();await browser.close();}
console.log(await video.path());
