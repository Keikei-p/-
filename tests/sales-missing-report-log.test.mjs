import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=html.indexOf("async function renderMissingReportLog(){");
const stop=html.indexOf("async function renderNotificationPreview()",start);
assert.ok(start>0&&stop>start,"Missing-report renderer must be inside the existing Owner app");
const script=html.slice(start,stop);
function fixture({partnerResponse,partnerError=false,ownError=false,owner=true,day="2026-10-30",quickPartners=[]}={}){
  let financeReads=0,partnerReads=0,quickReads=0;
  function node(){
    return {style:{display:"block"},textContent:"",children:[],
      append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items]}};
  }
  const missingReportsManagement=node(),missingReportsDate={value:day};
  const missingReportsList=node(),missingReportsStatus=node();
  const context={
    missingReportRequestGeneration:0,missingReportsManagement,missingReportsDate,
    missingReportsList,missingReportsStatus,
    currentUser:{uid:"hub-owner"},currentUserData:{companyId:"hub"},
    getTodayString:()=> "2026-10-31",
    isCurrentCompanyOwner:()=>owner,
    getDocsFromServer:async()=>{
      financeReads++;
      if(ownError)throw Error("internal_denied");
      return {forEach(callback){callback({data:()=>({
        companyId:"hub",date:day,uid:"staff",teamId:"A",totalCount:0,
        reportStatus:"none"
      })})}};
    },
    query:(...x)=>x,where:(...x)=>x,recordsCollectionQuery:()=>({}),
    getUnreportedTeamSummary:()=>[{teamName:"2班",reported:0,expected:1,
      missingNames:["未報告スタッフ"]}],
    readPartnerWorkDay:async()=>{
      partnerReads++;
      if(partnerError)throw Error("partner_denied");
      return {data:partnerResponse||{
        role:"hub",teamStatusComplete:true,registeredCompanies:[
          {partnerCompanyId:"done",name:"報告済み協力店",active:true},
          {partnerCompanyId:"missing",name:"未報告協力店",active:true},
          {partnerCompanyId:"pending",name:"承認待ち協力店",active:false}
        ],
        partners:[{partnerCompanyId:"done",name:"報告済み協力店",
          totalCount:0,counts:{NURO:0}}],
        teamReports:[
          {partnerCompanyId:"done",name:"報告済み協力店",teams:[
            {id:"A",name:"報告済み班",status:"submitted",staffCount:1,reportedStaffCount:1}]},
          {partnerCompanyId:"missing",name:"未報告協力店",teams:[
            {id:"B",name:"未報告班",status:"missing",staffCount:2,reportedStaffCount:0}]}
        ]
      }};
    },
    readPartnerQuickDay:async()=>{quickReads++;return {data:{role:"hub",partners:quickPartners}};},
    validatedPartnerRankingDay:(data)=>data.partners,
    document:{createElement:()=>node()}
  };
  vm.createContext(context);
  vm.runInContext(script,context);
  return {context,run:()=>vm.runInContext("renderMissingReportLog()",context),
    getReads:()=>({financeReads,partnerReads,quickReads}),
    text:()=>JSON.stringify(missingReportsList.children),
    status:()=>missingReportsStatus.textContent};
}
test("real missing-report tab uses dated one-day read, marks zero count as reported, lists missing only",async()=>{
  const f=fixture();
  await f.run();
  assert.deepEqual(f.getReads(),{financeReads:1,partnerReads:1,quickReads:1});
  assert.match(f.text(),/2班.*未報告/);
  assert.match(f.text(),/未報告協力店/);
  assert.doesNotMatch(f.text(),/報告済み協力店|承認待ち協力店/);
  assert.equal(f.status(),"未報告 2件");
});
test("partner API denial is an explicit unchecked state, NEVER zero missing",async()=>{
  const f=fixture({partnerError:true});
  await f.run();
  assert.match(f.text(),/協力店：照合できません/);
  assert.match(f.status(),/未確認 1項目/);
});
test("internal raw read denial is not masked by partner success",async()=>{
  const f=fixture({ownError:true});
  await f.run();
  assert.match(f.text(),/自社：照合できません/);
  assert.match(f.status(),/未確認 1項目/);
});
test("unverified partner response must not be reported as no missing",async()=>{
  const f=fixture({partnerResponse:{role:"partner",partners:[],registeredCompanies:[]}});
  await f.run();
  assert.match(f.text(),/協力店：照合できません/);
});
test("owner-only access and malformed dates never make a remote request",async()=>{
  for(const opt of [{owner:false},{day:"2026-12-01"},{day:"bad"}]){
    const f=fixture(opt);await f.run();
    assert.deepEqual(f.getReads(),{financeReads:0,partnerReads:0,quickReads:0});
  }
});
test("the new missing log never exposes finance values or mutates originals",()=>{
  assert.match(html,/id="quickMissingButton"/);
  assert.match(html,/id="missingReportsManagement"/);
  assert.match(html,/quickMissingButton\.style\.display=isCurrentCompanyOwner\(\)/);
  assert.match(script,/readPartnerWorkDay\(\{date,includeTeamStatus:true\}\)/);
  assert.doesNotMatch(script,/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/);
  assert.doesNotMatch(script,/(?:totalRevenue|unitPrice|revenuePerUnit|pricingOptions)/);
});

test("legacy company 0-count report avoids false team-missing classification",async()=>{
  const f=fixture({quickPartners:[{partnerCompanyId:"missing",totalCount:0}]});
  await f.run();
  assert.doesNotMatch(f.text(),/未報告協力店｜未報告班 未報告/);
  assert.match(f.text(),/未報告協力店｜未報告班 要確認/);
});
