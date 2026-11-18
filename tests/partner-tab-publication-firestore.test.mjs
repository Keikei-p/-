import test from "node:test";
import assert from "node:assert/strict";
import {PARTNER_OPTIONAL_TABS} from "../ranking/partner-tab-visibility-policy.mjs";
import {
  PARTNER_TAB_ALLOWED_IDS,createPartnerTabPublicationStore
} from "../functions-ranking-approvals/ranking/partner-tab-publication-store.mjs";

const UID="owner1", PARTNER="partner1", HUB="hub1", PARTNER_COMPANY="company1";
const actor=(uid=UID,email="owner@example.com")=>({uid,email,emailVerified:true});
const fail=fn=>assert.rejects(fn,/PARTNER_TAB_PUBLICATION_NOT_AUTHORIZED_OR_UNVERIFIED/);
const user={uid:UID,companyId:HUB,active:true,companyRole:"owner",
 email:"owner@example.com",accessKind:"internal",memberType:"internal"};
const company={ownerUid:UID,active:true,companyKind:"internal"};
const member={uid:UID,companyId:HUB,companyRole:"owner",active:true,
 accessKind:"internal",memberType:"internal"};

function makeDB(initial={}) {
 const data=new Map(Object.entries(initial));
 const reads=[],writes=[];
 let seq=0;
 const ref=(path)=>({
  path,
  doc(id) {return ref(path+"/"+(id??("audit"+(++seq))));},
  collection(name){return ref(path+"/"+name);}
 });
 const db={
  collection(name){return ref(name);},
  runTransaction:async (callback,{readOnly=false}={})=>{
   const pending=[];
   const tx={
    get:async target=>{
     reads.push(target.path);
     const row=data.get(target.path);
     return {exists:row!==undefined,data:()=>row};
    },
    create(target,value){
     if(readOnly)throw Error("READ_ONLY_WRITE");
     if(data.has(target.path)||pending.some(x=>x.path===target.path))
      throw Error("CREATE_EXISTS");
     pending.push({type:"create",path:target.path,value});
    },
    update(target,value){
     if(readOnly)throw Error("READ_ONLY_WRITE");
     if(!data.has(target.path))throw Error("UPDATE_MISSING");
     pending.push({type:"update",path:target.path,value});
    }
   };
   const result=await callback(tx);
   for(const op of pending){data.set(op.path,structuredClone(op.value));writes.push(op);}
   return result;
  }
 };
 return {db,data,reads,writes};
}
const seeded=()=>makeDB({
 ["users/"+UID]:structuredClone(user),
 ["companies/"+HUB]:structuredClone(company),
 ["companies/"+HUB+"/members/"+UID]:structuredClone(member),
 ["users/"+PARTNER]:{
  uid:PARTNER,companyId:PARTNER_COMPANY,active:true,
  accessKind:"partner",memberType:"cooperator",
  email:"partner@example.com",canViewRevenue:false,canViewUnitPrice:false
 },
 ["companies/"+PARTNER_COMPANY]:{
  ownerUid:PARTNER,companyKind:"partner",hubCompanyId:HUB,active:true
 },
 ["companies/"+PARTNER_COMPANY+"/members/"+PARTNER]:{
  uid:PARTNER,companyId:PARTNER_COMPANY,active:true,
  accessKind:"partner",memberType:"cooperator",
  canViewRevenue:false,canViewUnitPrice:false
 },
 ["partnerRelations/"+PARTNER_COMPANY]:{
  partnerCompanyId:PARTNER_COMPANY,hubCompanyId:HUB,
  active:true,countSharingApproved:true
 },
 ["partnerWorkEntries/old1"]:{counts:{NURO:8},date:"2026-10-31"},
 ["partnerWorkCountDays/day1"]:{totalCount:8},
 ["records/old2"]:{amount:100000},
 ["products/product1"]:{unitPrice:20000}
});
const timestamp={serverTimestamp:()=>({__timestamp:"test"})};
const store=env=>createPartnerTabPublicationStore({db:env.db,FieldValue:timestamp});
const publicationPath="companies/"+HUB+"/partnerTabPublication/shared";

test("backend ID contract matches the existing eight-tab UI; no money tabs",()=>{
 assert.deepEqual(PARTNER_TAB_ALLOWED_IDS,PARTNER_OPTIONAL_TABS.map(x=>x.id));
 assert.equal(PARTNER_TAB_ALLOWED_IDS.length,8);
});

test("unconfigured Owner and partner reader fail closed; read-only and no financial access",async()=>{
 const f=seeded(),s=store(f);
 assert.deepEqual(await s.readOwner(actor()),{
  schema:"nico-partner-tabs-v1",revision:0,published:false,tabs:[]
 });
 assert.deepEqual(await s.readPartner(actor(PARTNER,"partner@example.com")),{
  schema:"nico-partner-tabs-v1",revision:0,published:false,tabs:[]
 });
 assert.equal(f.writes.length,0);
 assert.equal(f.reads.some(k=>/^(products|records|partnerWorkEntries|partnerWorkCountDays|revenueGoals)/.test(k)),false);
});

test("single Owner transaction publishes identical setting for all companies, not their counts",async()=>{
 const f=seeded(),s=store(f),original=structuredClone([...f.data.entries()]);
 const result=await s.saveOwner({actor:actor(),expectedRevision:0,
  published:true,selectedTabs:["history","team","product"]});
 assert.deepEqual(result,{saved:true,schema:"nico-partner-tabs-v1",
  revision:1,published:true,tabs:["product","team","history"]});
 assert.deepEqual((await s.readPartner(actor(PARTNER,"partner@example.com"))).tabs,
  ["product","team","history"]);
 assert.equal(f.writes.length,2);
 assert.deepEqual(f.writes.map(w=>w.path.split("/").slice(2,3)[0]),
  ["partnerTabPublication","partnerTabPublicationAudits"]);
 assert.equal(f.data.get(publicationPath).hubCompanyId,HUB);
 assert.equal(f.data.get(publicationPath).ownerUid,UID);
 assert.equal("partnerOverrides" in f.data.get(publicationPath),false);
 for(const [key,value] of original){
  assert.deepEqual(f.data.get(key),value,"Changed original: "+key);
 }
 assert.equal(f.reads.some(k=>/^(products|records|partnerWorkEntries|partnerWorkCountDays)/.test(k)),false);
});

test("no-op is idempotent, CAS rejects stale settings with zero new writes",async()=>{
 const f=seeded(),s=store(f),args={actor:actor(),expectedRevision:0,
  published:true,selectedTabs:["team"]};
 await s.saveOwner(args);
 assert.equal((await s.saveOwner({...args,expectedRevision:1})).saved,false);
 assert.equal(f.writes.length,2);
 await fail(()=>s.saveOwner(args));
 assert.equal(f.writes.length,2);
});

test("unpublished draft is invisible to partner; later publish is additive config only",async()=>{
 const f=seeded(),s=store(f);
 await s.saveOwner({actor:actor(),expectedRevision:0,published:false,
  selectedTabs:["individual","daily"]});
 assert.deepEqual((await s.readPartner(actor(PARTNER,"partner@example.com"))).tabs,[]);
 const result=await s.saveOwner({actor:actor(),expectedRevision:1,published:true,
  selectedTabs:["individual","daily"]});
 assert.deepEqual(result.tabs,["individual","daily"]);
 assert.equal(f.writes.length,4);
});

test("nonOwner, secondary identity and cooperator cannot save Owner publication",async()=>{
 for(const change of [
  {"users/"+UID:{...user,companyRole:"leader"}},
  {"companies/"+HUB+"/members/"+UID:{...member,companyRole:"leader"}},
  {"users/"+UID:{...user,accessKind:"partner"}},
  {"partnerWorkspaceContexts/"+UID:{active:true}},
  {"companies/"+HUB:{...company,ownerUid:"somebody"}},
  {"users/"+UID:{...user,active:false}}
 ]){
  const f=seeded();for(const [k,v] of Object.entries(change))f.data.set(k,v);
  await fail(()=>store(f).saveOwner({actor:actor(),expectedRevision:0,
   published:true,selectedTabs:["team"]}));
  assert.equal(f.writes.length,0);
 }
 const f=seeded();await fail(()=>store(f).saveOwner({
  actor:actor(PARTNER,"partner@example.com"),
  expectedRevision:0,published:true,selectedTabs:["team"]
 }));
 assert.equal(f.writes.length,0);
});

test("partner read denies missing relation or finance-enabled identity",async()=>{
 for(const [k,change] of [
  ["partnerRelations/"+PARTNER_COMPANY,{active:false}],
  ["users/"+PARTNER,{canViewRevenue:true}],
  ["companies/"+PARTNER_COMPANY+"/members/"+PARTNER,{canViewUnitPrice:true}],
  ["partnerWorkspaceContexts/"+PARTNER,{active:true}]
 ]){
  const f=seeded();f.data.set(k,{...f.data.get(k),...change});
  await fail(()=>store(f).readPartner(actor(PARTNER,"partner@example.com")));
  assert.equal(f.writes.length,0);
 }
});

test("bad policy, unauthorized fields, invalid revision and foreign document fail closed",async()=>{
 const f=seeded(),s=store(f);
 for(const selectedTabs of [["revenueChart"],["team","team"],["team","finance"],null]){
  await fail(()=>s.saveOwner({actor:actor(),expectedRevision:0,
   published:true,selectedTabs}));
 }
 await fail(()=>s.saveOwner({actor:actor(),expectedRevision:-1,published:true,
  selectedTabs:["team"]}));
 f.data.set(publicationPath,{schema:"nico-partner-tabs-v1",hubCompanyId:"foreign",
  ownerUid:UID,version:1,published:true,tabs:["team"]});
 await fail(()=>s.readOwner(actor()));
 assert.equal(f.writes.length,0);
});
