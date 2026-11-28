// Offline headless UI QA. Actual form functions/CSS, fictional APIs, no accounts.
const {readFileSync}=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {KEYS}=require('../functions-partner-workspace/service.cjs');
const html=readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return html.slice(i,j);};
const source=section('function partnerUsesVerifiedOwnerCatalog(','function renderPartnerPrivateProductCatalog(')+
 section('const PARTNER_NURO_CB_TIERS=','function partnerInlineRender(){')+
 section('function partnerSavedCountReadbackState(','function partnerCountSaveFailureMessage(')+
 section('function partnerIndividualCatalog(','// Hub Owner-only partner count correction.');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try{for(const width of [375,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});let blocked=0;
  await page.route('**/*',r=>{blocked++;return r.abort();});
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await page.addScriptTag({content:`
   const pInline=id=>document.getElementById(id);let partnerInlineBusy=false;
   const legacyKeys=${JSON.stringify(KEYS)};
   const legacyCounts=Object.fromEntries(legacyKeys.map(k=>[k,k==='SB光・AIR'?35:k==='つばさ・HTB'?86:0]));
   const ownerProducts=[{id:'light',name:'SB光新規'},{id:'air',name:'SBAIR'},{id:'energy',name:'つばさ電気'},{id:'htb',name:'HTB'}];
   let partnerInlineData={role:'owner',date:'2026-11-24',companyName:'架空協力店',
    sharedCatalogMode:'owner-products-count-only-v1',sharedCatalogVerified:true,ownerProducts,
    categories:legacyKeys,enabledCategories:['SB光・AIR','つばさ・HTB'],privateProducts:[],
    teams:[{id:'team',name:'検証班',active:true}],staff:[{id:'staff',name:'架空担当',teamId:'team',active:true}],
    records:[{staffId:'staff',version:1,counts:legacyCounts,totalCount:121,
     ownerProductCounts:{light:0,air:0,energy:0,htb:0},ownerProductTotalCount:0,
     privateCounts:{},privateTotalCount:0,workLocation:'',teamIdSnapshot:'team'}]};
   let partnerInlineEditingStaffId='',partnerInlineWorkspaceCompany='';window.__calls=[];
   const partnerInlineIdentity=()=> 'fictional-partner',partnerInlinePayload=x=>x;
   const partnerMainValidId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]+$/.test(id);
   const partnerInlineRun=async fn=>{try{window.__result=await fn();}catch(e){window.__failure=e.message;}};
   const partnerMainCountSubmit=async data=>{window.__calls.push(JSON.parse(JSON.stringify(data)));
    partnerInlineData.records=[{...partnerInlineData.records[0],version:2,
     ownerProductCounts:data.ownerProductCounts,ownerProductTotalCount:14}];
    return {data:{saved:true,date:partnerInlineData.date,staffId:'staff',version:2}};};
   const partnerMainCountRead=async()=>({data:structuredClone(partnerInlineData)});
  `+source+`
   document.querySelectorAll('body > *').forEach(n=>n.style.display='none');
   let node=pInline('partnerPanelRecord');
   while(node&&node!==document.body){node.hidden=false;node.style.display='block';node=node.parentElement;}
   pInline('appScreen').dataset.partnerCountOnly='true';
   pInline('pInlineStaff').replaceChildren(new Option('架空担当','staff'));pInline('pInlineStaff').value='staff';
   pInline('pInlineDate').value=partnerInlineData.date;partnerInlineRenderCounts();
  `});
  assert.equal(await page.locator('#pInlineCountFields input[data-owner-product-id]').count(),4);
  const text=await page.locator('#pInlineCountFields').innerText();
  for(const label of ['SB光新規','SBAIR','つばさ電気','HTB','35件','86件'])assert(text.includes(label));
  for(const [id,n] of Object.entries({light:2,air:3,energy:4,htb:5}))
   await page.locator('input[data-owner-product-id="'+id+'"]').fill(String(n));
  const box=await page.locator('#pInlineCountFields').evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth}));
  assert(box.width<=width&&box.scroll<=box.width+1,JSON.stringify({width,box}));
  await page.locator('#pInlineSave').click();await page.waitForFunction(()=>window.__result||window.__failure);
  const result=await page.evaluate(()=>({result:window.__result,error:window.__failure,calls:window.__calls}));
  assert(!result.error,result.error);assert.match(result.result,/実績を修正できました/);
  assert.deepEqual(result.calls[0].ownerProductCounts,{light:2,air:3,energy:4,htb:5});
  assert(Object.values(result.calls[0].counts).every(n=>n===0));
  console.log(JSON.stringify({width,inputs:4,savedCount:14,retainedHistory:121,externalRequestsBlocked:blocked,realAccounts:false}));
  if(width===375&&process.env.NICO_QA_SCREENSHOT)
   await page.locator('#partnerPanelRecord').screenshot({path:process.env.NICO_QA_SCREENSHOT});
  await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
