import {test,expect} from '@playwright/test';
const owner='0x0000000000000000000000000000000000001234';
const vault='0x0000000000000000000000000000000000005678';
function protocol(){return {configured:true,block:'100',observedAt:new Date().toISOString(),alarm:true,registryReady:true,threshold:2,toleranceBps:100,contracts:{},vault:null,drill:null,canaries:[],coverage:{covered:0,expiring:0,lapsed:3,unknown:0,threshold:2,margin:1,desired:3,tripFeasible:false,degraded:true,blockSeconds:1,note:''}};}
test.beforeEach(async({page})=>{await page.route('**/api/protocol',route=>route.fulfill({json:protocol()}));});

test('public app opens protocol state without simulation controls or duplicated canary details',async({page},info)=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Classical withdrawals frozen'})).toBeVisible();
 await expect(page.getByLabel('Environment')).toHaveCount(0);
 await expect(page.getByText(/Local simulation|Live testnet|no real funds/i)).toHaveCount(0);
 await expect(page.getByRole('heading',{name:/Canary [0-9]/})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'QoreX network setup'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Coverage degraded'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`.artifacts/canary-overview-${info.project.name}.png`,fullPage:true});
 await page.route('**/api/protocol',route=>route.fulfill({status:502,json:{error:'Protocol unavailable'}}));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('main').getByRole('alert')).toHaveText('Protocol unavailable');
 await expect(page.getByRole('heading',{name:'Coverage unknown'})).toBeVisible();
});

test('creation, vault management, activity and wallet settings have distinct controls',async({page},info)=>{
 await page.route('**/api/portfolio?*',route=>route.fulfill({json:{chainId:9800,owner,block:'100',balance:'1000000000000000000',warnings:[],assets:[],approvalScan:{from:'0',to:'100',exhaustive:false},vaults:[{address:vault,owner,rescue:owner,keyHash:`0x${'12'.repeat(32)}`,nonce:'0',locked:false,alarm:true,balance:'0',dailyLimit:'10000000000000000',delay:'86400',coolingOff:'3600',spent:'0',pending:[],pendingTruncated:false}]}}));
 await page.route('https://evm-testnet.qore.host/**',async route=>{const rpc=route.request().postDataJSON();await route.fulfill({json:{jsonrpc:'2.0',id:rpc.id,result:`0x${'0'.repeat(64)}`}});});
 await page.route('**/api/activity?*',route=>route.fulfill({json:{from:'0',to:'100',completeWindow:true,truncated:false,events:[]}}));
 await page.goto('/?tab=Lifeboat');
 await page.getByLabel('Owner EVM address').fill(owner);
 await page.getByRole('button',{name:'Discover vaults & review assets'}).click();
 await page.getByText('Create another vault',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Create vault with QoreX',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Wallet assets & approvals'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Vault policy controls'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Withdraw within daily limit'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Recover with your PQ backup'})).toHaveCount(0);
 await page.screenshot({path:`.artifacts/canary-lifeboat-${info.project.name}.png`,fullPage:true});
 await page.getByRole('navigation').getByRole('button',{name:'My vault',exact:true}).click();
 await expect(page.getByRole('button',{name:'Create vault with QoreX',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Wallet assets & approvals'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Migration record'})).toHaveCount(0);
 await page.getByText('Change withdrawal policy',{exact:true}).click();
 await expect(page.getByRole('heading',{name:'Vault policy controls'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Recover with your PQ backup'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Withdraw within daily limit'})).toBeVisible();
 await page.screenshot({path:`.artifacts/canary-vault-${info.project.name}.png`,fullPage:true});
 await page.getByRole('navigation').getByRole('button',{name:'Activity',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Decoded on-chain activity'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Vault policy controls'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Deposit with QoreX'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'QoreX network setup'})).toHaveCount(0);
 await page.getByRole('navigation').getByRole('button',{name:'Wallet',exact:true}).click();
 await expect(page.getByRole('heading',{name:'QoreX network setup'})).toBeVisible();
});

test('QoreX connection never requests a private key or silently sends a transaction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect QoreX' }).click();
  await expect(page.getByRole('dialog', {name:'Connect QoreX'})).toBeVisible();
  await page.getByRole('button', { name: 'Browser extension', exact:false }).click();
  await expect(page.getByRole('status')).toContainText('QoreX extension');
  await expect(page.getByRole('textbox', { name: /private key|seed phrase/i })).toHaveCount(0);
});

test('QoreX chooser opens without invoking the extension and keeps mobile choice separate', async ({page},info)=>{
  await page.addInitScript(()=>{
    const tracked=window as unknown as {qorex:unknown;extensionConnections:number};
    tracked.extensionConnections=0;
    tracked.qorex={native:{enable:async()=>{tracked.extensionConnections++;},getKey:async()=>({bech32Address:'qor1wlxxvzrqpmcrqkqhc2la7jgs7yce58mrjpr86z'}),signDirect:async()=>{throw new Error('Connection must not sign a transaction');}}};
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Connect QoreX'}).click();
  await expect(page.getByRole('dialog',{name:'Connect QoreX'})).toBeVisible();
  await page.screenshot({path:`.artifacts/wallet-chooser-${info.project.name}.png`});
  await page.getByRole('button',{name:'Mobile wallet',exact:false}).click();
  await expect(page.getByRole('status')).toContainText('Mobile QR pairing is not available');
  expect(await page.evaluate(()=>(window as unknown as {extensionConnections:number}).extensionConnections)).toBe(0);
  await page.getByRole('button',{name:'Back to connection options'}).click();
  await page.getByRole('button',{name:'Browser extension',exact:false}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('QoreX connected on Diana');
  expect(await page.evaluate(()=>(window as unknown as {extensionConnections:number}).extensionConnections)).toBe(1);
  await page.getByRole('button',{name:/qor1wlxxv/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('QoreX coin60 public account connects on mainnet with a persistent signing restriction',async({page},info)=>{
 await page.addInitScript(()=>{
  const tracked=window as unknown as {qorex:unknown;connectedChains:string[]};tracked.connectedChains=[];
  tracked.qorex={evm:{request:async()=> '0x2649'},native:{enable:async(chain:string)=>{tracked.connectedChains.push(chain);},getKey:async()=>({bech32Address:'qor1z84y95u0t2zmm3a46f5pmy2k2qtcxdp502m5r3'}),signDirect:async()=>{throw Error('Public connection must not sign');}}};
 });
 await page.goto('/');await page.getByRole('button',{name:'Connect QoreX'}).click();await page.getByRole('button',{name:'Browser extension',exact:false}).click();
 await expect(page.getByRole('status')).toContainText('QoreX account connected');
 await expect(page.getByRole('button',{name:/qor1z84y/})).toBeVisible();
 await expect(page.getByRole('note',{name:'QoreX network'})).toContainText('Wallet network: Mainnet.');
 await page.getByRole('navigation').getByRole('button',{name:'Lifeboat'}).click();
 await expect(page.getByRole('note',{name:'QoreX network'})).toContainText('signing is blocked');
 expect(await page.evaluate(()=>(window as unknown as {connectedChains:string[]}).connectedChains)).toEqual(['qorechain-vladi']);
 await page.screenshot({path:`.artifacts/qorex-mainnet-connected-${info.project.name}.png`});
});
