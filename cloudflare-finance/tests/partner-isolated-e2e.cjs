const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage();
 const source=fs.readFileSync(require('node:path').join(__dirname,'../preview/partner.html'),'utf8');
 let records=[],posts=[],denied=false,external=0,hold=false,release=null;
 const fixture=()=>({policy:{isPartner:true,teamId:'A',canViewRevenue:false,canViewUnitPrice:false},members:[{uid:'fixture',name:'Fixture Person',teamId:'A'}],products:[{id:'sim',name:'Fixture SIM',planIds:['plan_0'],cashbackPlans:[{planId:'cb_0',cashback:0}]}],records});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='isolated.test')return route.fulfill({contentType:'text/html',body:source.replace('const PARTNER_GATEWAY_URL = "";','const PARTNER_GATEWAY_URL = "https://gateway.test";')});
  if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:url.pathname.endsWith('firebase-app.js')?'export const initializeApp=()=>({});':`const user={email:'fixture@example.test',emailVerified:true,getIdToken:async()=> 'fixture-only'};export const getAuth=()=>({currentUser:user});export const signInWithEmailAndPassword=async()=>{};export const signOut=async()=>{};export const onAuthStateChanged=(auth,callback)=>{window.__fixtureAuthCallback=callback;queueMicrotask(()=>callback(user));};`});
  if(url.hostname==='gateway.test'){
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'}});
   if(denied)return route.fulfill({status:403,contentType:'application/json',body:'{}'});
   if(req.method()==='POST'){
    const body=req.postDataJSON();posts.push(body);
    records=[{id:'fixture-record',uid:body.uid,teamId:'A',date:body.date,memberNameSnapshot:'Fixture Person',totalCount:body.entries[0]?.count||0,reportStatus:body.reportStatus,recordVersion:'2026-10-27T00:00:00Z',results:{item_0:{productId:'sim',planId:'cb_0',count:body.entries[0]?.count||0}}}];
    return route.fulfill({contentType:'application/json',body:'{"saved":true}'});
   }
   if(hold)await new Promise(resolve=>{release=resolve;});
   return route.fulfill({contentType:'application/json',body:JSON.stringify(fixture())});
  }
  external++;return route.abort();
 });
 await page.goto('https://isolated.test/');
 await page.locator('#productRows input').waitFor();
 assert.equal(await page.locator('#teamCount').innerText(),'0');
 assert.match(await page.locator('#productRows label').first().innerText(),/CB 0円/);
 console.log('PASS isolated partner dashboard renders at mobile viewport');
 await page.locator('#productRows input').fill('2');
 await page.locator('#saveButton').click();
 await page.waitForFunction(()=>document.querySelector('#teamCount').textContent==='2');
 assert.equal(posts.length,1);assert(!JSON.stringify(posts[0]).match(/revenue|cashback|totalCount|companyId/));
 console.log('PASS count create sends only authorized count intent to mock API');
 await page.locator('#productRows input').fill('3');
 await page.locator('#saveButton').click();
 await page.waitForFunction(()=>document.querySelector('#teamCount').textContent==='3');
 assert.equal(posts[1].recordId,'fixture-record');assert.equal(posts[1].expectedRecordUpdateTime,'2026-10-27T00:00:00Z');
 console.log('PASS correction keeps record ID and expected server version');
 denied=true;await page.locator('#reloadButton').click();
 await page.waitForFunction(()=>document.querySelector('#message').classList.contains('error'));
 assert.equal(await page.locator('#saveButton').isDisabled(),true);
 console.log('PASS forbidden refresh disables further saves');
 assert.equal(await page.locator('#recordList').innerText(),'');assert.equal(await page.locator('#member').innerText(),'');console.log('PASS forbidden refresh clears prior member identities and counts');
 denied=false;hold=true;await page.locator('#reloadButton').click();
 while(!release)await new Promise(resolve=>setTimeout(resolve,10));
 await page.evaluate(()=>window.__fixtureAuthCallback(null));
 const response=page.waitForResponse('https://gateway.test/v1/partner-dashboard');
 release();await response;await page.waitForTimeout(100);
 assert.equal(await page.locator('#appPanel').isHidden(),true);
 assert.equal(await page.locator('#recordList').innerText(),'');
 console.log('PASS late response from previous auth session cannot restore data');
 assert.equal(external,0);console.log('PASS all browser requests intercepted; no live network or credentials');
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
