import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {historicalBlob} from "./helpers/historical-builder-fixtures.mjs";
import {blobSha} from "../tools/hosting/owner-setup-additive-guard.mjs";

const files=Object.freeze({
 "functions-partner-workspace/service.cjs":"712bf523ac83942c02767c25321bfed7059055be",
 "tests/partner-workspace.test.cjs":"94c7b76caaa7cf057c0bf8361d188d61ffe8a07d",
 "functions-partner-workspace/index.js":"42eea81ab01449bedbbedabdc1a8fb6bfba1e284",
 "functions-partner-workspace/workspace-identity.cjs":"e06305c7dd151a3e5bab93a394396754fd25088e",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750"
});
const code=()=>readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
test("only one reviewed existing workspace callable receives an Owner-only read branch",()=>{
 for(const [path,sha] of Object.entries(files)){
  const file=readFileSync(new URL("../"+path,import.meta.url),"utf8");
  assert.equal(blobSha(file),sha,path+" exact source");
 }
 const old=historicalBlob("ff2911be0bfa23d7c041e7451729d59862b2261f");
 const current=code();
 const oldActor=` const {actor,scope}=require("./workspace-identity.cjs").makeWorkspaceIdentity({
  db,getAuth,HttpsError,enabled,now
 });`;
 const newActor=` const makeIdentity=require("./workspace-identity.cjs").makeWorkspaceIdentity;
 const {actor,scope}=makeIdentity({db,getAuth,HttpsError,enabled,now});
 // Owner setup GET is independent of the workspace's normal enable flag.
 // This separately verified actor is invoked ONLY by the read-only path.
 const {actor:readOwnerSetup}=makeIdentity({
  db,getAuth,HttpsError,enabled:()=>true,now
 });`;
 const oldView=` async function view(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date);
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(d.sharedCountRankings!==undefined){`;
 const newView=` async function view(request){
  const d=request?.data||{};
  const setupOnly=d.ownerSetupCompaniesOnly===true;
  const a=await (setupOnly?readOwnerSetup(request):actor(request));
  const date=validDate(d.date);
  // Owner-only setup cannot select a secondary company or reuse partner roles.
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(setupOnly){
   if(Object.keys(d).sort().join("|")!=="date|ownerSetupCompaniesOnly"||
      s.kind!=="hub"||s.role!=="owner")fail();
   // Return only registered partner IDs/names and the active count relation.
   // No bilateral approval, team/staff/count collection or monetary query.
   const relations=await db.collection("partnerRelations")
    .where("hubCompanyId","==",s.cid).limit(101).get();
   if(relations.size>100)fail("resource-exhausted");
   const registeredCompanies=[];
   for(const sn of relations.docs){
    const rel=sn.data()||{};
    if(!ID.test(sn.id)||rel.partnerCompanyId!==sn.id||
       rel.hubCompanyId!==s.cid)fail("data-loss");
    const cs=await db.collection("companies").doc(sn.id).get();
    const company=cs.data()||{};
    if(!cs.exists||company.companyKind!=="partner"||
       company.hubCompanyId!==s.cid||!validCompanyName(company.name))
      fail("data-loss");
    registeredCompanies.push({
     partnerCompanyId:sn.id,name:clean(company.name),
     active:rel.active===true&&rel.countSharingApproved===true&&company.active===true
    });
   }
   registeredCompanies.sort((x,y)=>x.name.localeCompare(y.name,"ja"));
   return {role:"hub",date,registeredCompanies};
  }
  if(d.sharedCountRankings!==undefined){`;
 assert.equal(current.split(newActor).length,2,"exactly one reviewed Owner identity");
 assert.equal(current.split(newView).length,2,"exactly one reviewed Owner-only route");
 assert.equal(current.replace(newActor,oldActor).replace(newView,oldView),old,
  "Every existing manage, submit, accept, ranking, finance, and normal view byte is unchanged");
 assert(!/\.(?:create|set|update|delete)\(/.test(newView));
 assert(!/\.collection\s*\(\s*["'](?:products|records|recordCorrections|revenueGoals)["']\s*\)/.test(newView));
});
test("read-only Owner branch cannot auto-enable the workspace, count writes, or ranking",()=>{
 const entry=readFileSync(new URL("../functions-partner-workspace/index.js",import.meta.url),"utf8");
 const project=JSON.parse(readFileSync(new URL("../.firebaserc",import.meta.url),"utf8"));
 assert.equal(project.projects.default,"sales-management-cc116");
 assert.match(entry,/PARTNER_WORKSPACE_ENABLED==="enabled"/);
 assert.match(entry,/NICO_PARTNER_COUNT_PUBLICATION_WRITE_ENABLED==="enabled"/);
 assert.match(entry,/NICO_PARTNER_SHARED_RANKING_ENABLED==="enabled"/);
 assert.match(entry,/exports.getPartnerWorkspace=onCall\(opts,service.view\)/);
 assert(!/exports.getOwnerSetup|exports.ownerSetup/.test(entry));
});
