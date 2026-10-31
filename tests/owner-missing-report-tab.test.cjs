"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const start=html.indexOf("// One-day, read-only log.");
const end=html.indexOf("async function renderNotificationPreview() {",start);
assert.ok(start>0&&end>start,"missing log logic must exist as isolated module portion");
const code=html.slice(start,end);
const UI=(options={})=>{
  const list={children:[],replaceChildren(){this.children=[]},append(x){this.children.push(x)}};
  const status={textContent:""},date={value:"2026-10-31"};
  const makeNode=()=>({textContent:"",style:{},children:[],append(...x){this.children.push(...x)}});
  let readDate=null, rawReads=0;
  const context={
    document:{createElement:makeNode},
    missingReportsList:list,missingReportsStatus:status,missingReportsDate:date,
    missingReportsManagement:{style:{display:"block"}},
    missingReportRequestGeneration:0,
    getTodayString:()=> "2026-11-01",
    isCurrentCompanyOwner:()=>options.owner!==false,
    currentUser:{uid:"owner"},currentUserData:{companyId:"internal"},
    recordsCollectionQuery:()=>{rawReads++;return "internal-records"},
    where:(key,op,val)=>{readDate=val;assert.equal(key,"date");assert.equal(op,"==");return {key,op,val}},
    query:(collection,filter)=>{assert.equal(collection,"internal-records");return filter},
    getDocsFromServer:async filter=>{
      if(options.internalError)throw Error("no internal access");
      return {forEach(fn){for(const row of options.records||[]){
        fn({data:()=>row});}}};
    },
    getUnreportedTeamSummary:(d,rows)=>{
      assert.equal(d,"2026-10-31");
      assert.equal(rows.length,(options.records||[]).length);
      assert.equal(rows[0]?.totalRevenue,undefined,"do not pass money into missing-report calculation");
      return options.missingInternal||[];
    },
    readPartnerQuickDay:async({date})=>{
      assert.equal(date,"2026-10-31");
      if(options.quickError)throw Error("legacy offline");
      return {data:{role:"hub",partners:options.quickPartners||[]}};
    },
    validatedPartnerRankingDay:(x)=>x.partners,
    readPartnerWorkDay:async({date,includeTeamStatus})=>{
      assert.equal(includeTeamStatus,true);
      assert.equal(date,"2026-10-31");
      if(options.partnerError)throw Error("partner offline");
      return {data:options.partner??{role:"hub",teamStatusComplete:true,
        registeredCompanies:[],partners:[],teamReports:[]}};
    }
  };
  const render=vm.runInNewContext("let missingReportRequestGeneration=0;"+code+"\nrenderMissingReportLog",context);
  return {render,list,status,date,getReadDate:()=>readDate,getRawReads:()=>rawReads};
};
test("own team and active partner omission appear as dated log; 0件 counts as submitted",async()=>{
 const app=UI({
  records:[{companyId:"internal",uid:"u",date:"2026-10-31",teamId:"A",
    totalCount:0,totalRevenue:999999,reportStatus:"no_result"}],
  missingInternal:[{teamName:"2班",reported:0,expected:1,missingNames:["田中"]}],
  partner:{role:"hub",teamStatusComplete:true,registeredCompanies:[
   {partnerCompanyId:"p1",name:"協力店A",active:true},
   {partnerCompanyId:"p2",name:"協力店B",active:true},
   {partnerCompanyId:"pending",name:"未承認",active:false}
  ],partners:[{partnerCompanyId:"p2",totalCount:0}],
  teamReports:[
   {partnerCompanyId:"p1",name:"協力店A",teams:[
    {id:"a",name:"1班",status:"missing",staffCount:1,reportedStaffCount:0}]},
   {partnerCompanyId:"p2",name:"協力店B",teams:[
    {id:"b",name:"2班",status:"submitted",staffCount:1,reportedStaffCount:1}]}
  ]}
 });
 await app.render();
 assert.equal(app.getReadDate(),"2026-10-31");
 assert.equal(app.list.children.length,2);
 const titles=app.list.children.map(x=>x.children[0].textContent);
 assert.ok(titles.some(x=>x.includes("2026-10-31")&&x.includes("自社：2班 未報告")));
 assert.ok(titles.some(x=>x.includes("協力店：協力店A｜1班 未報告")));
 assert.ok(!titles.some(x=>x.includes("協力店B")||x.includes("未承認")));
 assert.match(app.status.textContent,/未報告 2件/);
 assert.doesNotMatch(JSON.stringify(app.list),/999999|totalRevenue/);
});
test("no permission or future date never fetches records or partner",async()=>{
 const denied=UI({owner:false});
 await denied.render();
 assert.equal(denied.getRawReads(),0);
 assert.match(denied.status.textContent,/Owner/);
 const future=UI();
 future.date.value="2026-11-02";
 await future.render();
 assert.equal(future.getRawReads(),0);
 assert.match(future.status.textContent,/過去の日付/);
});
test("failed sources show unknown status, not a false all-reported signal",async()=>{
 const app=UI({internalError:true,partnerError:true});
 await app.render();
 assert.equal(app.list.children.length,2);
 assert.match(app.status.textContent,/未確認 2項目/);
 for(const c of app.list.children)assert.match(c.children[0].textContent,/照合できません/);
 assert.ok(!app.status.textContent.includes("未報告はありません"));
});
test("malicious cross-company original stops internal log without rendering money",async()=>{
 const app=UI({records:[{companyId:"different",date:"2026-10-31",totalRevenue:9999}]});
 await app.render();
 assert.equal(app.list.children.length,1);
 assert.match(app.list.children[0].children[0].textContent,/自社：照合できません/);
});
test("visible menu remains Owner-only and partner data uses only count-only callable",()=>{
 for(const tag of ["quickMissingButton","missingReportsManagement","missingReportsDate","missingReportsList"])
   assert.ok(html.includes('id="'+tag+'"'));
 assert.match(html,/quickMissingButton\.style\.display=isCurrentCompanyOwner\(\)/);
 assert.match(code,/readPartnerWorkDay\(\{date,includeTeamStatus:true\}\)/);
 assert.doesNotMatch(code,/getDocs\(.*products|totalRevenue|revenuePerUnit|pricingOptions|deleteDoc|updateDoc|setDoc/);
 assert.match(html,/id="countGrid"|partnerCountFunctions/);
});
