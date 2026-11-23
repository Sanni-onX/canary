import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {decryptKeyBlob} from '../packages/pq/src/index.ts';
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage();
 await page.goto('https://web-production-2863d083.up.railway.app/?mode=testnet&tab=Lifeboat');
 await page.getByLabel('Owner EVM address').fill('0xd81213Ed37038293c30aD1e8f196a0E8Fb74D464');
 await page.getByRole('button',{name:'Discover vaults & review assets'}).click();
 await page.getByLabel('Recovery backup password',{exact:true}).fill('test-only-passphrase-12345');
 await page.getByRole('button',{name:'Generate encrypted recovery backup',exact:true}).click();
 await page.getByRole('button',{name:'Save encrypted backup',exact:true}).waitFor({timeout:30000});
 const downloaded=page.waitForEvent('download');
 await page.getByRole('button',{name:'Save encrypted backup',exact:true}).click();
 const file=await downloaded;
 await mkdir('.local',{recursive:true});await file.saveAs('.local/backup-ui-test.json');
 const backup=JSON.parse(await readFile('.local/backup-ui-test.json','utf8'));
 const pair=await decryptKeyBlob(backup,'test-only-passphrase-12345');
 pair.secretKey.fill(0);
 console.log(JSON.stringify({generated:true,downloaded:true,decrypted:true,privateKeyLogged:false}));
}finally{await browser.close();}
