// Isolated UI exercise: all network requests are intercepted; no live accounts/data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start);return html.slice(start,end);};
const inline=section('// NICO partner: same Firebase email sign-in','/* =====================================================\n   Auth状態');
const invite=section('let directPartnerInviteCompanies=[];','document.getElementById("partnerInviteCopyButton").onclick');
const fixture=`
let currentUser={uid:'h',emailVerified:true,email:'h@example.test'};
let currentCompanyData={ownerUid:'h',companyKind:'internal'},currentUserData={accessKind:'internal'};
const auth={currentUser};
const appScreen=document.getElementById('appScreen'),authScreen=document.getElementById('authScreen');
const verificationScreen=document.getElementById('verificationScreen'),companySetupScreen=document.getElementById('companySetupScreen');
const userName=document.getElementById('userName'),userEmail=document.getElementById('userEmail'),userRole=document.getElementById('userRole'),loginStatus=document.getElementById('loginStatus'),databaseStatus=document.getElementById('databaseStatus');
const stopRealtimeListeners=()=>{},showSuccess=m=>window.__message=m,showError=m=>{throw Error(m)};
const isCurrentCompanyOwner=()=>true;
window.__calls=[];window.__snap={role:'leader',companyName:'検証協力店',teamId:'a',categories:['NURO'],teams:[{id:'a',name:'1班',active:true}],staff:[{id:'l',name:'検証リーダー',kind:'account',role:'leader',uid:'l',teamId:'a',active:true}],records:[]};
const readPartnerWorkDay=async()=>({data:currentUser.uid==='h'?{role:'hub',registeredCompanies:[{partnerCompanyId:'partner',name:'検証協力店',active:true,teams:[{id:'a',name:'1班'}]}]}:structuredClone(window.__snap)});
const partnerInlineManage=async data=>{window.__calls.push(data);if(data.action==='addTeam')window.__snap.teams.push({id:'b',name:data.name,active:true});if(data.action==='moveStaff')window.__snap.staff.find(x=>x.id===data.staffId).teamId=data.teamId;return {data:{token:'T'.repeat(43)}}};
const partnerInlineSave=async data=>{window.__calls.push(data);window.__snap.records=[{staffId:data.staffId,counts:data.counts,totalCount:data.counts.NURO,version:data.expectedVersion+1,teamIdSnapshot:'b'}];return {data:{version:data.expectedVersion+1}}};
const partnerInlineAccept=async data=>{window.__calls.push(data);return {data:{joined:true,partnerCompanyId:'partner',secondaryMembership:false}}};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const page=await context.newPage();let unexpected=0;
  await page.route('**/*',route=>{
   if(route.request().isNavigationRequest()&&new URL(route.request().url()).hostname==='isolated.test')
    return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
   unexpected++;return route.abort();
  });
  await page.goto('https://isolated.test/?partnerStaffInvite='+'T'.repeat(43));
  await page.addScriptTag({content:fixture+inline.replaceAll('location.replace(url.href)','window.__nextUrl=url.href')+invite});
  await page.evaluate(async()=>{
   document.getElementById('companyInviteControls').style.display='block';
   document.getElementById('partnerInviteInline').hidden=false;
   appScreen.style.display='block';authScreen.style.display='none';
   for(let el=document.getElementById('partnerInviteInline');el&&el!==document.body;el=el.parentElement){
    el.hidden=false;el.style.display='block';
   }
   await loadDirectPartnerInviteCompanies();
  });
  await page.selectOption('#partnerInviteRole','member');
  await page.fill('#partnerInviteEmail','member@example.test');
  // Invoke the same DOM handler even if an unrelated management tab is closed.
  await page.evaluate(()=>document.getElementById('partnerInviteCreateButton').click());
  await page.waitForFunction(()=>!document.getElementById('partnerInviteResult').hidden);
  const created=await page.evaluate(()=>window.__calls[0]);
  assert.deepEqual(created,{action:'hubCreateInvite',partnerCompanyId:'partner',teamId:'a',role:'member',email:'member@example.test'});
  assert.match(await page.inputValue('#partnerInviteLinkOutput'),/partnerStaffInvite=/);
  await page.evaluate(async()=>{
   currentUser={uid:'l',emailVerified:true,email:'l@example.test',displayName:'検証リーダー'};auth.currentUser=currentUser;
   await showPartnerInviteAtMain(currentUser,partnerMainPendingInvite());
   document.getElementById('pMainInviteName').value='検証リーダー';
   document.getElementById('pMainAcceptInvite').click();
  });
  await page.waitForFunction(()=>window.__nextUrl);
  assert.equal(await page.evaluate(()=>window.__calls.at(-1).transferCurrentCompany),false);
  await page.evaluate(()=>openSameAppPartnerWorkspace(auth.currentUser));
  await page.fill('#pInlineTeamName','2班');await page.click('#pInlineAddTeam');
  await page.waitForFunction(()=>window.__snap.teams.length===2&&!partnerInlineBusy);
  await page.selectOption('#pInlineManageTeam','b');await page.click('#pInlineMove');
  await page.waitForFunction(()=>window.__snap.staff[0].teamId==='b'&&!partnerInlineBusy);
  await page.fill('#pInlineInviteEmail','next@example.test');await page.selectOption('#pInlineInviteRole','leader');
  await page.click('#pInlineCreateInvite');
  await page.waitForFunction(()=>!document.getElementById('pInlineInviteResult').hidden&&!partnerInlineBusy);
  await page.fill('input[data-count-key="NURO"]','3');await page.click('#pInlineSave');
  await page.waitForFunction(()=>window.__snap.records.length===1&&!partnerInlineBusy);
  assert.match(await page.textContent('#pInlineRanking'),/3件/);
  assert.equal(await page.locator('#pInlineOwnerTeam').isVisible(),true);
  assert.equal(await page.locator('#companyInviteControls').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const dir=process.env.BROWSER_EVIDENCE_DIR;
  if(dir)await page.screenshot({path:path.join(dir,'direct-role-'+width+'.png'),fullPage:true});
  await page.evaluate(()=>{window.__snap.role='member';partnerInlineData=window.__snap;partnerInlineRender();});
  assert.equal(await page.locator('#pInlineOwnerTeam').isVisible(),false);
  assert.equal(await page.locator('#pInlineMemberForms').isVisible(),false);
  // Fonts/images are blocked too; no request is sent to a production service.
  console.log('PASS synthetic browser '+width+'px; blocked ancillary requests='+unexpected);
  await context.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
