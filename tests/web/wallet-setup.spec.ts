import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('saved backup restores after refresh, confirmation is usable, and mainnet refuses before wallet approval',async({page},info)=>{
 const owner='0x0000000000000000000000000000000000001234';
 await page.addInitScript(()=>{
  const tracked=window as unknown as {qorex:unknown;walletRequests:number};tracked.walletRequests=0;
  tracked.qorex={evm:{request:async()=> '0x2649'},native:{signDirect:async()=>{},enable:async()=>{tracked.walletRequests++;},getKey:async()=>{throw Error('Unexpected key request');}}};
 });
 await page.route('**/api/portfolio?*',route=>route.fulfill({json:{chainId:9800,owner,block:'100',balance:'1000000000000000000',warnings:[],assets:[],vaults:[],approvalScan:{from:'0',to:'100',exhaustive:false}}}));
 await page.route('**/api/protocol',route=>route.fulfill({status:502,json:{error:'Test fixture: protocol unavailable'}}));
 async function discover(){await page.getByLabel('Owner EVM address').fill(owner);await page.getByRole('button',{name:'Discover vaults & review assets'}).click();await page.getByRole('heading',{name:'QoreX vault transactions'}).waitFor();}
 await page.goto('/?mode=testnet&tab=Lifeboat');await discover();
 await page.getByLabel('Recovery backup password',{exact:true}).fill('Public test backup password!');
 await page.getByRole('button',{name:'Generate encrypted recovery backup',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save encrypted backup',exact:true}).click();
 const backup=await download;const bytes=await readFile((await backup.path())!);
 await page.reload();await discover();
 await page.getByLabel('Or restore an existing encrypted backup').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:bytes});
 const checkbox=page.getByRole('checkbox',{name:'I saved the encrypted backup file and its password separately.'});
 await expect(checkbox).not.toBeChecked();
 const dimensions=await checkbox.boundingBox();expect(dimensions!.width).toBe(20);expect(dimensions!.height).toBe(20);
 await page.getByText('I saved the encrypted backup file and its password separately.',{exact:true}).click();await expect(checkbox).toBeChecked();
 await checkbox.focus();await page.keyboard.press('Space');await expect(checkbox).not.toBeChecked();await page.keyboard.press('Space');
 await page.getByLabel('Recovery backup password',{exact:true}).fill('Public test backup password!');
 await page.getByRole('button',{name:'Create vault with QoreX',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'QoreX is not on Diana testnet'})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {walletRequests:number}).walletRequests)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`.artifacts/wallet-backup-network-${info.project.name}.png`,fullPage:true});
});
