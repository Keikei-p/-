// Entirely synthetic browser rehearsal. Every network request is intercepted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const page=await context.newPage();const errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='fixture.test')return route.fulfill({contentType:'text/html',body:fs.readFileSync('partner-workspace.html','utf8')});
   if(url.hostname==='www.gstatic.com'){
    let body='';
    if(url.pathname.endsWith('firebase-app.js'))body='export const initializeApp=()=>({});';
    else if(url.pathname.endsWith('firebase-functions.js'))body=`export const getFunctions=()=>({}); export const httpsCallable=()=>async()=>{throw {code:'functions/permission-denied'}};`;
    else if(url.pathname.endsWith('firebase-auth.js'))body=`
     const user={uid:'fixture',email:'fixture@example.test',emailVerified:!location.search.includes('unverified')};
     const auth={currentUser:user};let cb;export const getAuth=()=>auth;
     export const onAuthStateChanged=(a,f)=>{cb=f;queueMicrotask(()=>f(user))};
     export const getIdToken=async()=> 'synthetic';
     export const reload=async()=>{user.emailVerified=true};
     export const sendPasswordResetEmail=async()=>{}; export const sendEmailVerification=async()=>{};
     export const signOut=async()=>{auth.currentUser=null;await cb(null)};
     export const setPersistence=async()=>{}; export const browserSessionPersistence={};
     export const signInWithEmailAndPassword=async()=>{};
     export const createUserWithEmailAndPassword=async()=>{throw {code:'auth/email-already-in-use'}};
    `;
    return route.fulfill({contentType:'application/javascript',body});
   }
   remote.push(url.origin);return route.abort();
  });
  await page.goto('https://fixture.test/partner-workspace.html?preview=1');
  await page.locator('#countStaffRank .ranking-row').first().waitFor();
  assert.match(await page.locator('#ownerPreviewBanner').innerText(),/架空/);
  assert.equal(await page.locator('.ranking-champion-crown svg').count()>0,true);
  await page.screenshot({path:`evidence/partner-preview-${width}.png`,fullPage:true});
  for(const tab of ['Records','People','View','Missing','Invitations','Products','Account','Dashboard'])await page.locator('#tab'+tab).click();
  await page.locator('#tabRecords').click();assert.equal(await page.locator('#save').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto('https://fixture.test/partner-workspace.html?invite='+ 'a'.repeat(43)+'&unverified=1');
  await page.locator('#checkVerify').waitFor();assert.equal(await page.locator('#verify').isVisible(),true);
  await page.locator('#checkVerify').click();await page.locator('#inviteAccept').waitFor();
  await page.goto('https://fixture.test/partner-workspace.html');
  await page.getByText(/このアカウントには選択した会社の利用権限/).waitFor();
  assert.equal(await page.locator('#retrySession').isVisible(),true);
  await page.locator('#switchAccount').click();await page.locator('#loginBox').waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log(`PASS ${width}px: preview, champion, tabs, disabled writes, verification and permission recovery; zero real network calls`);
  await context.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
