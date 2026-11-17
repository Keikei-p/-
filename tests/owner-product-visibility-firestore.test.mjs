import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createPartnerSubmissionPublicationGuard}=
 require("../functions-partner-workspace/submission-publication-guard.cjs");
const {KEYS}=require("../functions-partner-workspace/approved-published-categories.cjs");
import {createOwnerProductVisibilityStore}
 from "../ranking/owner-product-visibility-firestore.mjs";
import {buildOwnerVisibleCountRanking}
 from "../ranking/owner-product-visibility-rankings.mjs";

const principal={uid:"owner",email:"owner@example.test",emailVerified:true};
const product=(id,name,active=true)=>({companyId:"hub",name,active,
 revenue:25000,unitPrice:10000,cashbackOptions:[5000]});
function fake(){
 const state=new Map([
  ["users/owner",{uid:"owner",email:"owner@example.test",
   companyId:"hub",companyRole:"owner",active:true,accessKind:"internal"}],
  ["companies/hub",{name:"本社",ownerUid:"owner",companyKind:"internal",active:true}],
  ["companies/hub/members/owner",{uid:"owner",companyId:"hub",
   companyRole:"owner",active:true,accessKind:"internal"}],
  ["companies/partner",{name:"協力店",ownerUid:"partner-owner",companyKind:"partner",
   hubCompanyId:"hub",active:true}],
  ["partnerRelations/partner",{partnerCompanyId:"partner",
   hubCompanyId:"hub",active:true,countSharingApproved:true}],
  ["products/nuro",product("nuro","NURO光")],
  ["products/air",product("air","SoftBank Air")]
 ]);
 let serial=0,writes=0;
 const ref=path=>({
  path,doc(id){return ref(path+"/"+(id??("audit_"+(++serial))))},
  collection(name){return ref(path+"/"+name)},
  where(field,operator,value){
   return {type:"query",path,field,operator,value,
    limit(max){return {...this,max}}}
  },
  limit(max){return {type:"query",path,max}}
 });
 const snapshot=(path,value)=>{
  const id=path.split("/").at(-1);
  return {id,exists:value!==undefined,
   data(){return structuredClone(value)}};
 };
 const tx={
  async get(q){
   if(q.type==="query"){
    const docs=[...state.entries()].filter(([p,value])=>
     p.startsWith(q.path+"/")&&
     p.split("/").length===q.path.split("/").length+1&&
     (q.field==null||value[q.field]===q.value))
     .map(([p,value])=>snapshot(p,value));
    return {docs:docs.slice(0,q.max||9999)};
   }
   return snapshot(q.path,state.get(q.path));
  },
  create(r,value){if(state.has(r.path))throw Error("ALREADY_EXISTS");
   writes++;state.set(r.path,structuredClone(value));},
  update(r,value){if(!state.has(r.path))throw Error("NOT_FOUND");
   writes++;state.set(r.path,{...state.get(r.path),...structuredClone(value)});}
 };
 const db={collection:ref,async runTransaction(fn){return fn(tx)}};
 const store=createOwnerProductVisibilityStore({
  db,FieldValue:{serverTimestamp:()=> "SERVER_TIMESTAMP"}
 });
 return {store,state,tx,db,get writes(){return writes}};
}
test("owner starts with every shared product OFF, raw prices are NEVER sent",async()=>{
 const f=fake(),status=await f.store.readStatus(principal);
 assert.equal(status.version,0);
 assert.equal(status.products.length,2);
 assert(status.products.every(p=>p.enabled===false));
 assert(!/revenue|unitPrice|cashback|25000|10000/.test(JSON.stringify(status)));
 assert.equal(f.writes,0);
});
test("one owner toggle is atomic, version checked, audited, and changes no sales/product rows",async()=>{
 const f=fake(),before=structuredClone(f.state.get("products/nuro"));
 const saved=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 assert.deepEqual(saved,{saved:true,version:1,productId:"nuro",
  enabled:true,partnerCompanyId:null});
 assert.deepEqual(f.state.get("products/nuro"),before);
 assert.equal(f.state.get("companies/hub/rankingProductVisibility/shared")
  .enabledHubProductIds.join(","),"nuro");
 const publicCatalog=f.state.get("companies/hub/rankingCountPublicCatalog/shared");
 assert.equal(publicCatalog.schema,"nico-reviewed-count-public-catalog-v1");
 assert.equal(publicCatalog.version,1);
 assert.equal(publicCatalog.ownerUid,"owner");
 assert.deepEqual(publicCatalog.products.map(({id,name,active})=>({id,name,active})),
  [{id:"air",name:"SoftBank Air",active:true},
   {id:"nuro",name:"NURO光",active:true}].sort((a,b)=>a.name.localeCompare(b.name,"ja")||
    a.id.localeCompare(b.id)));
 assert.doesNotMatch(JSON.stringify(publicCatalog),/revenue|unitPrice|cashback|25000|10000/);
 assert.equal(f.writes,5,"visibility, catalog, audit plus one exact mapping and its audit");
 const linked=f.state.get("companies/hub/rankingSkuMappings/shared");
 assert.equal(linked.version,1);
 assert.deepEqual(linked.bindings,[{
  companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"
 }]);
 assert.equal(linked.reviewedByUid,"owner");
 assert.equal([...f.state.keys()].filter(x=>
  x.startsWith("companies/hub/rankingSkuMappingAudit/")).length,1);
 assert(!/revenue|unitPrice|cashback|25000|10000/.test(JSON.stringify(linked)));
 assert.equal((await f.store.readStatus(principal)).products
  .find(p=>p.id==="nuro").enabled,true);
 const repeat=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:1});
 assert.equal(repeat.saved,false);
 assert.equal(f.writes,5,"idempotent no-op must not duplicate catalog or mapping audits");
 await assert.rejects(f.store.saveSwitch({principal,productId:"air",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,5);
});
test("partner-specific OFF cannot turn on globally OFF product; OFF never deletes counts",async()=>{
 const f=fake(),saved=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 const restricted=await f.store.saveSwitch({principal,productId:"nuro",
  partnerCompanyId:"partner",enabled:false,expectedVersion:saved.version});
 assert.equal(restricted.version,2);
 const state=await f.store.readForRanking({context:{
  serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",hubCompanyId:"hub",role:"hub_owner",
  approvedCompanyIds:["hub","partner"]},mappingsReviewed:true});
 assert.deepEqual(state.enabledHubProductIds,["nuro"]);
 assert.deepEqual(state.partnerOverrides,[{companyId:"partner",
  enabledHubProductIds:[]}]);
 assert.equal(state.ownerSettingsRead,true);
 assert.equal(state.productMappingsReviewed,true);
 await assert.rejects(f.store.saveSwitch({principal,productId:"air",
  partnerCompanyId:"partner",enabled:true,expectedVersion:2}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 const off=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:false,expectedVersion:2});
 assert.equal(off.saved,true);
 assert.deepEqual(f.state.get("companies/hub/rankingProductVisibility/shared")
  .enabledHubProductIds,[]);
 assert.equal(f.state.get("products/nuro").revenue,25000);
});
test("secondary user, wrong owner and unrelated partner are rejected before any write",async()=>{
 const f=fake(),badPrincipal={...principal,uid:"other"};
 await assert.rejects(f.store.readStatus(badPrincipal),/UNAUTHORIZED_OR_INCOMPLETE/);
 await assert.rejects(f.store.saveSwitch({principal:badPrincipal,
  productId:"nuro",enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("partnerWorkspaceContexts/owner",{active:true,kind:"partner_secondary"});
 await assert.rejects(f.store.readStatus(principal),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.delete("partnerWorkspaceContexts/owner");
 await assert.rejects(f.store.saveSwitch({principal,productId:"nuro",
  partnerCompanyId:"foreign",enabled:true,expectedVersion:0}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,0);
});
test("unknown, disabled and money-labelled products fail closed, never write",async()=>{
 const f=fake();
 await assert.rejects(f.store.saveSwitch({principal,productId:"fake",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("products/nuro",{...f.state.get("products/nuro"),active:false});
 await assert.rejects(f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("products/nuro",product("nuro","NURO_CB50000"));
 await assert.rejects(f.store.readStatus(principal),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,0);
});


test("REAL store->server publication->company/person/SKU ranking switch uses ONE source of truth",async()=>{
 const f=fake(),context={serverVerified:true,viewerUid:"owner",
  viewerCompanyId:"hub",hubCompanyId:"hub",role:"hub_owner",
  approvedCompanyIds:["hub","partner"],userActive:true,memberActive:true,
  companyActive:true,reciprocalOwnersApproved:true,
  completeSnapshotBudgetApproved:true,individualNamesApproved:true};
 const today="2026-11-08";
 const makeSource=(cid,kind,nuro,air)=>{
  const uid="person"+cid,teamId="team",sourceId="record"+cid;
  const products=[{companyId:cid,sourceId:cid==="hub"?"nuro":"p-nuro",
   name:"NURO光",active:true,sortOrder:0},
   {companyId:cid,sourceId:cid==="hub"?"air":"p-air",
   name:"SoftBank Air",active:true,sortOrder:1}];
  return {companyId:cid,kind,companyLabel:cid==="hub"?"本社":"協力店",
   readTime:"2026-11-08T12:00:00Z",consentVerified:true,isComplete:true,
   completeWindows:{current:true,previous:false},
   teams:[{id:teamId,name:"営業班",goalCount:null}],
   roster:[{uid,name:"営業担当",teamId}],products,
   records:[{companyId:cid,sourceId,uid,teamId,date:today,
    totalCount:nuro+air,reportStatus:"submitted",
    memberNameSnapshot:"営業担当",teamNameSnapshot:"営業班",workLocation:""}],
   lines:products.map((p,i)=>({companyId:cid,recordId:sourceId,
    sourceId:sourceId+"__"+i,uid,teamId,date:today,
    productId:p.sourceId,count:i===0?nuro:air}))};
 };
 const input={context,hubCompanyId:"hub",
  approvedCompanyIds:["hub","partner"],
  sources:[makeSource("hub","own",2,3),makeSource("partner","partner",5,2)],
  productGroups:[
   {companyId:"hub",productId:"nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:"partner",productId:"p-nuro",groupId:"nuro",groupName:"NURO光"},
   {companyId:"hub",productId:"air",groupId:"air",groupName:"SoftBank Air"},
   {companyId:"partner",productId:"p-air",groupId:"air",groupName:"SoftBank Air"}
  ],period:{kind:"day",day:today,asOf:today}};
 const original=structuredClone(input);
 const ranking=async()=>buildOwnerVisibleCountRanking({input,publication:
  await f.store.readForRanking({context,mappingsReviewed:true})});
 assert.equal((await ranking()).summary.total,0,"no saved owner setting = ALL OFF");
 await f.store.saveSwitch({principal,productId:"nuro",enabled:true,expectedVersion:0});
 const on=await ranking();
 assert.deepEqual(on.summary,{own:2,partner:5,total:7,unidentified:0});
 assert.deepEqual(on.productRanking.map(p=>p.name),["NURO光"]);
 assert.equal(on.memberRanking.find(p=>p.companyId==="partner").count,5);
 await f.store.saveSwitch({principal,productId:"air",enabled:true,expectedVersion:1});
 assert.equal((await ranking()).summary.total,12);
 await f.store.saveSwitch({principal,productId:"nuro",enabled:false,expectedVersion:2});
 const off=await ranking();
 assert.deepEqual(off.summary,{own:3,partner:2,total:5,unidentified:0});
 assert.deepEqual(off.productRanking.map(p=>p.name),["SoftBank Air"]);
 assert.deepEqual(input,original,"published totals change, immutable stored counts do not");
});


test("retired formerly-ON product is never ranked and owner can safely switch it OFF",async()=>{
 const f=fake();
 await f.store.saveSwitch({principal,productId:"nuro",enabled:true,expectedVersion:0});
 f.state.set("products/nuro",{...f.state.get("products/nuro"),active:false});
 const status=await f.store.readStatus(principal);
 assert.equal(status.products.find(p=>p.id==="nuro").enabled,false);
 const publication=await f.store.readForRanking({
  context:{serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",hubCompanyId:"hub",
   role:"hub_owner",approvedCompanyIds:["hub","partner"]},mappingsReviewed:true
 });
 assert.deepEqual(publication.enabledHubProductIds,[]);
 const off=await f.store.saveSwitch({
  principal,productId:"nuro",enabled:false,expectedVersion:1
 });
 assert.equal(off.saved,true);
 assert.deepEqual(f.state.get("companies/hub/rankingProductVisibility/shared")
  .enabledHubProductIds,[]);
});


test("legacy products without an active field stay available, never exposing their prices",async()=>{
 const f=fake(),old={...f.state.get("products/nuro")};
 delete old.active;
 f.state.set("products/nuro",old);
 const row=(await f.store.readStatus(principal)).products.find(p=>p.id==="nuro");
 assert.equal(row.active,true);
 const saved=await f.store.saveSwitch({
  principal,productId:"nuro",enabled:true,expectedVersion:0
 });
 assert.equal(saved.saved,true);
 assert.deepEqual(f.state.get("products/nuro"),old);
});

test("revoked partner override stays in audit settings but is omitted from active ranking scope",async()=>{
 const f=fake();
 await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 await f.store.saveSwitch({principal,productId:"nuro",
  partnerCompanyId:"partner",enabled:false,expectedVersion:1});
 const stored=structuredClone(f.state.get("companies/hub/rankingProductVisibility/shared"));
 const context={serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",hubCompanyId:"hub",
  role:"hub_owner",approvedCompanyIds:["hub"]};
 const view=await f.store.readForRanking({context,mappingsReviewed:true});
 assert.deepEqual(view.partnerOverrides,[],
  "no longer approved partner must not appear in ranking response");
 assert.deepEqual(view.enabledHubProductIds,["nuro"]);
 assert.deepEqual(f.state.get("companies/hub/rankingProductVisibility/shared"),
  stored,"historical override and version must remain untouched");
 await assert.rejects(f.store.readForRanking({context:{
  ...context,approvedCompanyIds:["hub","hub"]},mappingsReviewed:true}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 await assert.rejects(f.store.readForRanking({context:{
  ...context,approvedCompanyIds:["partner"]},mappingsReviewed:true}),
  /UNAUTHORIZED_OR_INCOMPLETE/);
 await assert.rejects(f.store.readForRanking({context:{
  ...context,role:"partner_owner",viewerCompanyId:"foreign"
 },mappingsReviewed:true}),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,8,"two Owner toggles preserve the original mapping, ranking reads add zero writes");
});


test("ranking settings read verifies live owner identity and partner consent, even with forged context",async()=>{
 const f=fake();
 const hub={serverVerified:true,viewerUid:"owner",viewerCompanyId:"hub",
  hubCompanyId:"hub",role:"hub_owner",approvedCompanyIds:["hub","partner"]};
 const read=context=>f.store.readForRanking({context,mappingsReviewed:true});
 assert.deepEqual((await read(hub)).enabledHubProductIds,[]);
 await assert.rejects(read({...hub,viewerUid:"attacker"}),/UNAUTHORIZED_OR_INCOMPLETE/);
 await assert.rejects(read({...hub,viewerCompanyId:"partner"}),/UNAUTHORIZED_OR_INCOMPLETE/);
 const partner={...hub,role:"partner_owner",viewerUid:"partner-owner",
  viewerCompanyId:"partner"};
 assert.deepEqual((await read(partner)).enabledHubProductIds,[]);
 await assert.rejects(read({...partner,viewerUid:"other"}),/UNAUTHORIZED_OR_INCOMPLETE/);
 f.state.set("partnerRelations/partner",{
  ...f.state.get("partnerRelations/partner"),active:false});
 await assert.rejects(read(partner),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,0,"authorization tests must be read-only");
});


test("Unicode-normalized amount labels never enter count-only owner publication or vendor copies",async()=>{
 const f=fake();
 f.state.set("products/nuro",product("nuro","ＮＵＲＯ ＣＢ５０００"));
 await assert.rejects(f.store.readStatus(principal),/UNAUTHORIZED_OR_INCOMPLETE/);
 await assert.rejects(f.store.saveSwitch({principal,productId:"air",
  enabled:true,expectedVersion:0}),/UNAUTHORIZED_OR_INCOMPLETE/);
 assert.equal(f.writes,0,"reject before any visibility/catalog/audit write");
 assert.equal(f.state.has("companies/hub/rankingCountPublicCatalog/shared"),false);
 const canonical=readFileSync(new URL("../ranking/owner-product-visibility-firestore.mjs",import.meta.url),"utf8");
 for(const path of [
  "../functions-ranking-approvals/ranking/owner-product-visibility-firestore.mjs",
  "../functions-ranking-approvals/vendor/owner-product-visibility-firestore.mjs"
 ])assert.equal(readFileSync(new URL(path,import.meta.url),"utf8"),canonical,
  "canonical and deployable copies must have identical finance fences");
});


test("Owner global ON links three active count-sharing partners at once, without their approval or count rewrites",async()=>{
 const f=fake();
 for(const cid of ["partner2","partner3"]){
  f.state.set("companies/"+cid,{name:cid,ownerUid:cid+"Owner",
   companyKind:"partner",hubCompanyId:"hub",active:true});
  f.state.set("partnerRelations/"+cid,{partnerCompanyId:cid,
   hubCompanyId:"hub",active:true,countSharingApproved:true});
 }
 const before=new Map([...f.state].filter(([key])=>
  key.startsWith("products/")||key.includes("partnerWorkEntries")||
  key.includes("records/")).map(([key,v])=>[key,structuredClone(v)]));
 const result=await f.store.saveSwitch({
  principal,productId:"nuro",enabled:true,expectedVersion:0
 });
 assert.equal(result.saved,true);
 const mapping=f.state.get("companies/hub/rankingSkuMappings/shared");
 assert.equal(mapping.version,1);
 assert.deepEqual(mapping.bindings,[ "partner","partner2","partner3"].map(companyId=>({
  companyId,productId:"partnerSku01",hubProductId:"nuro"
 })));
 assert.equal([...f.state.keys()].filter(p=>
  p.startsWith("companies/hub/rankingSkuMappingAudit/")).length,3);
 for(const [p,v] of before)assert.deepEqual(f.state.get(p),v);
 assert(!/revenue|unitPrice|cashback|25000|10000/.test(JSON.stringify(mapping)));
 assert.equal(f.writes,7,"3 existing publication writes plus mapping and three audits");
});
test("global Owner ON does not bypass company OFF or a manually reviewed SKU choice",async()=>{
 const f=fake();
 f.state.set("companies/hub/rankingProductVisibility/shared",{
  hubCompanyId:"hub",ownerUid:"owner",version:1,
  enabledHubProductIds:[],partnerOverrides:{partner:[]}
 });
 const saved=await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:1});
 assert.equal(saved.saved,true);
 assert.equal(f.state.has("companies/hub/rankingSkuMappings/shared"),false,
  "partner explicitly OFF still cannot receive the SKU mapping");
 assert.equal(f.writes,3);
 const g=fake();
 g.state.set("companies/hub/rankingSkuMappings/shared",{
  hubCompanyId:"hub",ownerUid:"owner",reviewedByUid:"owner",active:true,
  version:4,bindings:[{companyId:"partner",
   productId:"partnerSku01",hubProductId:"air"}]
 });
 await g.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 const mapped=g.state.get("companies/hub/rankingSkuMappings/shared");
 assert.equal(mapped.version,4,"the existing audited choice cannot be overwritten");
 assert.deepEqual(mapped.bindings,[{
  companyId:"partner",productId:"partnerSku01",hubProductId:"air"
 }]);
 assert.equal(g.writes,3,"no automatic mapping or mapping audit for a chosen category");
});
test("ambiguous Owner labels fail closed for auto-mapping; unknown merchandise never guesses a category",async()=>{
 const f=fake();
 f.state.set("products/nuro2",product("nuro2","NURO"));
 await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 assert.equal(f.state.has("companies/hub/rankingSkuMappings/shared"),false,
  "duplicate plausible NURO masters must not be guessed");
 assert.equal(f.writes,3);
 const g=fake();
 await g.store.saveSwitch({principal,productId:"air",
  enabled:true,expectedVersion:0});
 assert.equal(g.state.has("companies/hub/rankingSkuMappings/shared"),false,
  "standalone Air cannot impersonate the old combined optical/AIR product");
});
test("legacy 光/AIR maps ONLY to its exact combined category; toggling OFF keeps the binding and history",async()=>{
 const f=fake();
 f.state.set("products/combined",
  product("combined","SB光・AIR（旧合算・未分類）"));
 await f.store.saveSwitch({principal,productId:"combined",
  enabled:true,expectedVersion:0});
 const before=structuredClone(f.state.get("companies/hub/rankingSkuMappings/shared"));
 assert.deepEqual(before.bindings,[{
  companyId:"partner",productId:"partnerSku05",hubProductId:"combined"
 }]);
 const off=await f.store.saveSwitch({
  principal,productId:"combined",enabled:false,expectedVersion:1
 });
 assert.equal(off.saved,true);
 assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared"),before);
 assert.equal(f.state.get("products/combined").revenue,25000);
 assert.equal(f.state.get("companies/hub/rankingProductVisibility/shared")
  .enabledHubProductIds.includes("combined"),false);
});


test("Owner ON -> existing partner input allowed -> OFF blocks new counts, history stays -> re-ON restores input",async()=>{
 const f=fake(),zero=Object.fromEntries(KEYS.map(key=>[key,0]));
 const scope={verifiedByServer:true,kind:"partner",uid:"partner-worker",
  cid:"partner",hubId:"hub"};
 const verify=createPartnerSubmissionPublicationGuard({db:f.db});
 await assert.rejects(verify({tx:f.tx,scope,
  previousCounts:zero,nextCounts:{...zero,NURO:1}}),
  /PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/,
  "with no Owner publication, partner must not write that category");
 await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:0});
 const enabled=await verify({tx:f.tx,scope,previousCounts:zero,
  nextCounts:{...zero,NURO:3}});
 assert.deepEqual([...enabled.enabledCategories],["NURO"]);
 assert.equal(enabled.publicationVersion,1);
 assert.deepEqual(f.state.get("companies/hub/rankingSkuMappings/shared")
  .bindings,[{companyId:"partner",productId:"partnerSku01",hubProductId:"nuro"}]);
 await f.store.saveSwitch({principal,productId:"nuro",
  enabled:false,expectedVersion:1});
 const old={...zero,NURO:3};
 const off=await verify({tx:f.tx,scope,previousCounts:old,nextCounts:old});
 assert.deepEqual([...off.enabledCategories],[]);
 await assert.rejects(verify({tx:f.tx,scope,
  previousCounts:old,nextCounts:{...old,NURO:4}}),
  /PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/,
  "OFF must not allow new input");
 await assert.rejects(verify({tx:f.tx,scope,
  previousCounts:old,nextCounts:zero}),
  /PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/,
  "OFF must never reset earlier 3 saved counts");
 await f.store.saveSwitch({principal,productId:"nuro",
  enabled:true,expectedVersion:2});
 const resumed=await verify({tx:f.tx,scope,previousCounts:old,
  nextCounts:{...old,NURO:4}});
 assert.deepEqual([...resumed.enabledCategories],["NURO"]);
 assert.equal(resumed.publicationVersion,3);
 const map=f.state.get("companies/hub/rankingSkuMappings/shared");
 assert.equal(map.version,1,"ON/OFF does not duplicate existing mappings");
 assert.equal(map.bindings.length,1);
 assert.equal(f.state.get("products/nuro").revenue,25000);
});
