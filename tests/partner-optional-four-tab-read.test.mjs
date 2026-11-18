import test from "node:test";
import assert from "node:assert/strict";
import {createPartnerTabPublicationStore} from "../functions-partner-tabs/partner-tab-publication-store.mjs";
import {readPublishedPartnerOptionalTab} from "../functions-partner-tabs/partner-optional-tab-reader.mjs";
const DATE="2026-11-18", HUB="hub1", PARTNER="partner1";
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=(n,category="NURO")=>Object.fromEntries(KEYS.map(k=>[k,k===category?n:0]));
const member=(uid,role,teamId)=>({uid,companyId:PARTNER,active:true,
 companyRole:role==="owner"?"owner":"member",role,teamId:role==="owner"?null:teamId,
 accessKind:"partner",memberType:"cooperator",canViewRevenue:false,
 canViewUnitPrice:false,email:uid+"@example.com"});
const actor=uid=>({uid,email:uid+"@example.com",emailVerified:true});
const paths={
 company:"companies/"+PARTNER,
 hub:"companies/"+HUB,
 policy:"companies/"+HUB+"/partnerTabPublication/shared",
 owner:"pOwner",user:"pMember"
};
const blocked=fn=>assert.rejects(fn,/(?:PARTNER_TAB_PUBLICATION_NOT_AUTHORIZED_OR_UNVERIFIED|PARTNER_OPTIONAL_COUNT_ACCESS_UNVERIFIED)/);
function env({selection=["report","daily","history","goal"],published=true,asMember=false}={}){
 const principal=asMember?paths.user:paths.owner;
 const data=new Map();
 data.set(paths.hub,{active:true,companyKind:"internal",ownerUid:"hOwner"});
 data.set(paths.company,{active:true,companyKind:"partner",hubCompanyId:HUB,
  ownerUid:paths.owner,name:"協力店A"});
 data.set("partnerRelations/"+PARTNER,{active:true,countSharingApproved:true,
  partnerCompanyId:PARTNER,hubCompanyId:HUB});
 data.set("users/"+paths.owner,member(paths.owner,"owner",null));
 data.set("users/"+paths.user,member(paths.user,"member","t1"));
 data.set(paths.company+"/members/"+paths.owner,member(paths.owner,"owner",null));
 data.set(paths.company+"/members/"+paths.user,member(paths.user,"member","t1"));
 data.set(paths.policy,{schema:"nico-partner-tabs-v1",hubCompanyId:HUB,
  ownerUid:"hOwner",version:1,published,tabs:selection});
 data.set(paths.company+"/partnerWorkStaff/s1",{companyId:PARTNER,kind:"account",
  name:"担当A",active:true,uid:paths.user,teamId:"t1"});
 data.set(paths.company+"/partnerWorkStaff/s2",{companyId:PARTNER,kind:"managed",
  name:"担当B",active:true,uid:null,teamId:"t2"});
 for(const [staffId,n,category] of [["s1",5,"NURO"],["s2",3,"SBMNP"]]){
  const key=DATE+"__"+staffId;
  data.set(paths.company+"/partnerWorkEntries/"+key,{
   staffId,companyId:PARTNER,hubCompanyId:HUB,date:DATE,counts:counts(n,category),
   totalCount:n,version:1,staffNameSnapshot:staffId==="s1"?"担当A":"担当B",
   privateCounts:{"private-sku":12},privateTotalCount:12,
   workLocation:"広島市",updatedByUid:"secretUid",unitPrice:undefined
  });
  data.set(paths.company+"/partnerWorkAudits/"+key+"__v1",{
   staffId,companyId:PARTNER,hubCompanyId:HUB,date:DATE,version:1,
   counts:counts(n,category),previousCounts:counts(0),
   totalCount:n,privateCounts:{"private-sku":12},
   correctionReason:"Internal audit must remain private",
   createdAt:"hidden",updatedByUid:"secretUid"
  });
 }
 let writes=0;const reads=[];
 const reference=(path)=>({
  path,
  doc(id){return reference(path+"/"+id);},
  collection(name){return reference(path+"/"+name);},
  where(field,operator,value){return {...reference(path),
   query:{field,operator,value},limit(n){return {...this,max:n};}};},
  limit(n){return {...this,max:n};}
 });
 const db={
  collection(name){return reference(name);},
  runTransaction:async(callback,opts)=>{
   assert.deepEqual(opts,{readOnly:true});
   return callback({
    async get(ref){
     reads.push(ref.path);
     if(ref.max){
      if(!["partnerWorkStaff","partnerWorkEntries","partnerWorkAudits"].some(x=>
       ref.path===paths.company+"/"+x))throw Error("UNAUTHORIZED_COLLECTION");
      const docs=[...data.entries()].filter(([path])=>path.startsWith(ref.path+"/")&&
       !path.slice(ref.path.length+1).includes("/")).filter(([path,value])=>
        !ref.query||value[ref.query.field]===ref.query.value).map(([path,value])=>
        ({id:path.slice(ref.path.length+1),data:()=>structuredClone(value),exists:true}));
      return {docs:docs.slice(0,ref.max),size:docs.length};
     }
     const value=data.get(ref.path);
     return {exists:value!==undefined,data:()=>value===undefined?undefined:structuredClone(value)};
    },
    create(){writes++;throw Error("NO_MUTATIONS");},
    update(){writes++;throw Error("NO_MUTATIONS");},
    set(){writes++;throw Error("NO_MUTATIONS");},
    delete(){writes++;throw Error("NO_MUTATIONS");}
   });
  }
 };
 const store=createPartnerTabPublicationStore({db,FieldValue:{
  serverTimestamp:()=>({mock:true})
 }});
 const get=(tab,uid=principal)=>store.readPublishedOptional({
  actor:actor(uid),tab,date:DATE,reader:readPublishedPartnerOptionalTab
 });
 return {get,reads,data,writes:()=>writes};
}
test("all 4 tabs are read from same trusted Owner policy transaction and existing partner counts",async()=>{
 const f=env();
 const report=await f.get("report");
 assert.equal(report.totalCount,8);
 assert.deepEqual(report.lines.slice(0,4),[
  "協力店A｜2026-11-18 営業実績報告","報告状況：報告済",
  "総件数：8件","報告した担当者：2人"
 ]);
 const daily=await f.get("daily");
 assert.equal(daily.products.find(p=>p.name==="NURO").count,5);
 assert.equal(daily.products.find(p=>p.name==="SBMNP").count,3);
 const history=await f.get("history");
 assert.deepEqual(history.audits.map(x=>[x.staffName,x.totalCount]),
  [["担当A",5],["担当B",3]]);
 assert.equal(JSON.stringify(history).includes("privateCounts"),false);
 assert.equal(JSON.stringify(history).includes("correctionReason"),false);
 assert.equal(JSON.stringify(history).includes("unitPrice"),false);
 const goal=await f.get("goal");
 assert.equal(goal.actualCount,8);
 assert.equal(f.writes(),0);
 assert(f.reads.some(x=>x===paths.policy));
 assert(f.reads.some(x=>x===paths.company+"/partnerWorkEntries"));
 assert(f.reads.some(x=>x===paths.company+"/partnerWorkAudits"));
 assert(f.reads.every(x=>!x.startsWith("records/")&&!x.startsWith("products/")));
});
test("when published=false or requested tab not selected, reject BEFORE reading any history",async()=>{
 for(const opts of [
  {selection:[]},{published:false},{selection:["daily"]}
 ]){
  const f=env(opts);
  await blocked(()=>f.get("history"));
  assert.equal(f.reads.some(x=>x.includes("partnerWorkEntries")),false);
  assert.equal(f.reads.some(x=>x.includes("partnerWorkAudits")),false);
  assert.equal(f.writes(),0);
 }
});
test("members see only their own original records and own audit history",async()=>{
 const f=env({asMember:true});
 const day=await f.get("daily");
 assert.equal(day.totalCount,5);assert.equal(day.reportedStaffCount,1);
 const history=await f.get("history");
 assert.deepEqual(history.audits.map(x=>x.staffId),["s1"]);
 assert.equal(f.writes(),0);
});
test("foreign identities and finance-enabled members never read counts or audits",async()=>{
 for(const changed of [
  ["users/pOwner",x=>({...x,canViewRevenue:true})],
  ["companies/partner1/members/pOwner",x=>({...x,canViewUnitPrice:true})],
  ["partnerRelations/partner1",x=>({...x,active:false})],
  ["companies/partner1",x=>({...x,hubCompanyId:"other"})],
  ["companies/hub1/partnerTabPublication/shared",x=>({...x,ownerUid:"foreign"})]
 ]){
  const f=env();const [path,apply]=changed;
  f.data.set(path,apply(f.data.get(path)));
  await blocked(()=>f.get("daily"));
  assert.equal(f.reads.some(x=>x.includes("partnerWorkEntries")),false);
  assert.equal(f.writes(),0);
 }
});
test("corrupt raw count sum or forged financial label causes fail-closed, no source mutation",async()=>{
 for(const [path,mutate] of [
  [paths.company+"/partnerWorkEntries/"+DATE+"__s1",x=>({...x,totalCount:400})],
  [paths.company+"/partnerWorkStaff/s1",x=>({...x,name:"担当A 売上500万円"})]
 ]){
  const f=env();const before=structuredClone([...f.data.entries()]);
  f.data.set(path,mutate(f.data.get(path)));
  await blocked(()=>f.get("report"));
  assert.equal(f.writes(),0);
  assert.notDeepEqual([...f.data.entries()],before); // test fault injection only
 }
});
test("unknown data tabs and malformed dates never query Firestore",async()=>{
 const f=env();
 for(const [tab,date] of [["revenue",DATE],["history","2026-02-30"],
  ["goal","2026-13-01"]]){
  await blocked(()=>createPartnerTabPublicationStore({
   db:{collection(){throw Error("SENTINEL")},runTransaction(){throw Error("READ")}},
   FieldValue:{serverTimestamp:()=>({})}
  }).readPublishedOptional({actor:actor(paths.owner),tab,date,
    reader:readPublishedPartnerOptionalTab}));
 }
 assert.equal(f.writes(),0);
});
