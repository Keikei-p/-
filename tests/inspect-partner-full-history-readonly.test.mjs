import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectPartnerFullHistory,HISTORY_READ_LIMITS}
 from "../tools/production/inspect-partner-full-history-readonly.mjs";
const TIME="2026-11-17T00:00:00.000Z";
const timestamp={seconds:1794873600,nanoseconds:0,toDate:()=>new Date(TIME)};
const ID="__document_name__",secret="per_run_pseudonym_secret_32_characters";
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const counts=n=>Object.fromEntries(KEYS.map(k=>[k,k==="NURO"?n:0]));
class DB{
 constructor(){this.values=new Map();this.reads=[];this.transactions=0;this.writes=0;this.nextReadTime=null;}
 seed(path,value){this.values.set(path,structuredClone(value));return this;}
 collection(path){return this.query({path,group:false,fields:null,filters:[],after:null,max:null});}
 collectionGroup(name){return this.query({path:name,group:true,fields:null,filters:[],after:null,max:null});}
 query(spec){const db=this;return {
  _kind:"query",spec,
  doc(id){return db.ref(spec.path+"/"+id);},
  select(...fields){return db.query({...spec,fields});},
  where(field,op,value){assert.equal(op,"==");return db.query({...spec,filters:[...spec.filters,[field,value]]});},
  orderBy(field){assert.equal(field,ID);return db.query({...spec,ordered:true});},
  limit(max){return db.query({...spec,max});},
  startAfter(snapshot){assert.equal(typeof snapshot.ref.path,"string");return db.query({...spec,after:snapshot.ref.path});}
 };}
 ref(path){const db=this;return {_kind:"doc",path,collection:n=>db.collection(path+"/"+n)};}
 snap(path,fields=null,readTime=timestamp){
  const exists=this.values.has(path),value=this.values.get(path);
  return {id:path.split("/").at(-1),ref:{path},exists,readTime,
   data:()=>exists?structuredClone(fields?Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]])):value):undefined};
 }
 async runTransaction(task,options){
  this.transactions++;assert.deepEqual(options,{readOnly:true});const db=this;
  return task({
   async get(ref){
    const time=db.nextReadTime?.(db.reads.length,ref)??timestamp;
    if(ref._kind==="doc"){db.reads.push({path:ref.path,fields:null});return db.snap(ref.path,null,time);}
    assert.equal(ref._kind,"query");const s=ref.spec;
    assert(s.ordered,"every list must have document-ID ordering");assert(s.max<=HISTORY_READ_LIMITS.pageSize);
    db.reads.push({...s});
    const selected=[...db.values].filter(([path,v])=>{
     const belongs=s.group?path.split("/").at(-2)===s.path:
      path.startsWith(s.path+"/")&&!path.slice(s.path.length+1).includes("/");
     return belongs&&s.filters.every(([k,value])=>v[k]===value)&&(!s.after||path>s.after);
    }).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,s.max);
    return {readTime:time,docs:selected.map(([path])=>db.snap(path,s.fields,time))};
   },
   create(){db.writes++;throw Error("NO_WRITES");},set(){db.writes++;throw Error("NO_WRITES");},
   update(){db.writes++;throw Error("NO_WRITES");},delete(){db.writes++;throw Error("NO_WRITES");}
  });
 }
}
function fixture(){
 const db=new DB(),products=[{id:"nuro_id",companyId:"hub_id",name:"NURO",active:true},
  {id:"addon_id",companyId:"hub_id",name:"追加商材",active:true}];
 db.seed("companies/hub_id",{companyKind:"internal",active:true,ownerUid:"owner_uid"});
 db.seed("companies/partner_id",{companyKind:"partner",active:true,hubCompanyId:"hub_id"});
 db.seed("partnerRelations/partner_id",{partnerCompanyId:"partner_id",hubCompanyId:"hub_id",active:true,countSharingApproved:true});
 db.seed("companies/hub_id/rankingProductVisibility/shared",{hubCompanyId:"hub_id",ownerUid:"owner_uid",version:1,
  enabledHubProductIds:["nuro_id","addon_id"],partnerOverrides:{}});
 db.seed("companies/hub_id/rankingCountPublicCatalog/shared",{schema:"nico-reviewed-count-public-catalog-v1",
  hubCompanyId:"hub_id",ownerUid:"owner_uid",version:1,products});
 db.seed("companies/hub_id/rankingSkuMappings/shared",{hubCompanyId:"hub_id",ownerUid:"owner_uid",
  reviewedByUid:"owner_uid",active:true,version:1,
  bindings:[{companyId:"partner_id",productId:"partnerSku01",hubProductId:"nuro_id"}]});
 for(const p of products)db.seed("products/"+p.id,{...p,unitPrice:987654321,revenue:987654321});
 db.seed("records/do_not_read",{totalRevenue:987654321,customerEmail:"private@example.invalid"});
 db.seed("users/do_not_read",{email:"private@example.invalid"});
 db.seed("companies/partner_id/partnerPrivateProducts/custom_id",{companyId:"partner_id",name:"独自商材",active:true,
  origin:"partner_custom",visibility:"private"});
 db.seed("companies/partner_id/partnerWorkEntries/2026-10-01__staff_id",{companyId:"partner_id",hubCompanyId:"hub_id",
  date:"2026-10-01",staffId:"staff_id",version:1,counts:counts(3),totalCount:3,
  privateCounts:{custom_id:4},privateTotalCount:4,publishedCounts:{addon_id:5},publishedTotalCount:5,
  staffNameSnapshot:"秘密氏名",writerEmail:"private@example.invalid"});
 // No parent day document exists: a collectionGroup read must still find it.
 db.seed("companies/hub_id/partnerWorkCountDays/2026-10-01/reports/partner_id",{
  hubCompanyId:"hub_id",partnerCompanyId:"partner_id",date:"2026-10-01",source:"staff-entries-v1",
  counts:counts(3),totalCount:3,publishedCounts:{addon_id:5},publishedTotalCount:5});
 return db;
}
const inspect=(db,options={})=>inspectPartnerFullHistory({db,documentId:ID,pseudonymKey:secret,...options});

test("complete paginated history uses a single read-only snapshot and returns only pseudonymous aggregates",async()=>{
 const db=fixture(),before=structuredClone([...db.values]);
 const report=await inspect(db,{limits:{pageSize:1}});
 assert.equal(db.transactions,1);assert.equal(db.writes,0);assert.deepEqual([...db.values],before);
 assert.equal(report.completeSnapshot,true);assert.equal(report.sourceConservationVerified,true);
 assert.equal(report.originalTotalCount,12);assert.equal(report.mappedTotalCount,8);assert.equal(report.heldTotalCount,4);
 assert.equal(report.reportCount,1);assert.equal(report.originalEntryCount,1);
 assert.equal(report.sourceDocumentsExported,0);assert.equal(report.financialMasterFieldsRead,0);
 assert(report.readQueryCount>10,"small pages exercise cursor reads and final empty pages");
 assert(db.reads.some(q=>q.group&&q.path==="reports"));
 assert(db.reads.filter(q=>q.path==="companies").length>=3,"all company pages read");
 assert(!db.reads.some(q=>/^(records|users|recordCorrections)(?:\/|$)/.test(q.path)));
 const productReads=db.reads.filter(q=>q.path==="products");
 assert(productReads.every(q=>q.fields.join("|")==="companyId|name|active"));
 assert(db.reads.every(q=>!q.fields||!q.fields.some(f=>/unitPrice|revenue|Email|NameSnapshot/.test(f))));
 assert.doesNotMatch(JSON.stringify(report),/987654321|private@example|秘密氏名|独自商材|追加商材|hub_id|partner_id|staff_id|owner_uid|nuro_id|addon_id|custom_id/);
});

test("all historical months are inventoried, including old quick documents with missing parent days",async()=>{
 const db=fixture();
 db.seed("companies/hub_id/partnerQuickCountDays/2024-01-01/reports/partner_id",{
  hubCompanyId:"hub_id",partnerCompanyId:"partner_id",date:"2024-01-01",version:1,counts:counts(2),totalCount:2});
 const r=await inspect(db);
 assert.equal(r.reportCount,2);assert.equal(r.originalTotalCount,14);
 assert(r.companies[0].products.some(p=>p.month==="2024-01"&&p.sourceKind==="quick_legacy"&&p.originalCount===2));
});

test("late-page limits cannot return a successful first-page inventory",async()=>{
 const db=fixture();
 await assert.rejects(inspect(db,{limits:{pageSize:1,companies:1}}),/STOP_PARTNER_FULL_HISTORY_READONLY_DOCUMENT_LIMIT/);
 assert.equal(db.writes,0);
 await assert.rejects(inspect(fixture(),{limits:{totalDocuments:2}}),/STOP_PARTNER_FULL_HISTORY_READONLY_/);
 await assert.rejects(inspect(fixture(),{limits:{totalQueries:1}}),/STOP_PARTNER_FULL_HISTORY_READONLY_/);
 await assert.rejects(inspect(fixture(),{limits:{entriesPerCompany:10001}}),/LIMIT_CONFIG/);
});

test("orphan company parents cannot hide saved partner entries or private products",async()=>{
 for(const kind of ["partnerWorkEntries","partnerPrivateProducts"]){
  const db=fixture();
  if(kind==="partnerWorkEntries")db.seed("companies/missing_company/partnerWorkEntries/2026-10-01__orphan_staff",{
   companyId:"missing_company",hubCompanyId:"hub_id",date:"2026-10-01",staffId:"orphan_staff",version:1,
   counts:counts(1),totalCount:1});
  else db.seed("companies/missing_company/partnerPrivateProducts/orphan_sku",{
   companyId:"missing_company",name:"非公開",active:true,origin:"partner_custom",visibility:"private"});
  await assert.rejects(inspect(db),/ORPHAN_(?:ENTRY|PRIVATE_PRODUCT)_SCOPE/);
  assert.equal(db.writes,0);
 }
});

test("different snapshot time aborts rather than claiming complete reconciliation",async()=>{
 const db=fixture();
 db.nextReadTime=(i)=>i>0?{...timestamp,nanoseconds:1}:timestamp;
 await assert.rejects(inspect(db),/MIXED_SNAPSHOTS/);
 assert.equal(db.writes,0);
});

test("report path and stored company/day identity must agree",async()=>{
 const db=fixture();
 db.values.get("companies/hub_id/partnerWorkCountDays/2026-10-01/reports/partner_id").date="2026-10-02";
 await assert.rejects(inspect(db),/REPORT_PATH_IDENTITY/);
 assert.equal(db.writes,0);
});

test("unrelated report collections cannot be counted as partner entries",async()=>{
 const db=fixture();
 db.seed("otherRoot/secret/reports/unrelated",{hubCompanyId:"hub_id",partnerCompanyId:"partner_id",
  date:"2026-10-01",counts:counts(999),totalCount:999,unitPrice:987654321});
 const r=await inspect(db);
 assert.equal(r.reportCount,1);assert.equal(r.originalTotalCount,12);
 assert.equal(db.writes,0);
});

test("CLI requires main read-only runtime and contains no persistence or credential output",()=>{
 const tool=readFileSync(new URL("../tools/production/inspect-partner-full-history-readonly.mjs",import.meta.url),"utf8");
 assert.match(tool,/GITHUB_REF!=="refs\/heads\/main"/);
 assert.match(tool,/NICO_PARTNER_AUDIT_MODE!=="READ_ONLY"/);
 assert.match(tool,/\},\{readOnly:true\}\)/);
 assert.doesNotMatch(tool,/\b(?:tx|db|batch|writer)\.(?:set|update|delete|create)\s*\(|writeFile|firebase deploy|auth\.signIn|console\.(?:log|error)\([^)]*(?:credential|token|e\.message)/);
});

test("live runner is main-only after credential-free tests and never publishes or exports source data",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/nico-partner-full-history-readonly.yml",import.meta.url),"utf8");
 assert.match(workflow,/pull_request:/);assert.match(workflow,/push:/);assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/needs: synthetic/);assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/github\.repository == 'Keikei-p\/-'/);
 assert.match(workflow,/NICO_PARTNER_AUDIT_MODE: READ_ONLY/);
 assert.match(workflow,/inspect-partner-full-history-readonly\.mjs --read-only/);
 assert.match(workflow,/chmod 600/);assert.match(workflow,/if: \$\{\{ always\(\) \}\}/);
 assert.doesNotMatch(workflow,/upload-artifact|firebase deploy|functions:delete|rules:release|set -x|contents: write/);
 const synthetic=workflow.split("  live-readonly:")[0];
 assert.doesNotMatch(synthetic,/secrets\.|GOOGLE_APPLICATION_CREDENTIALS/);
});
