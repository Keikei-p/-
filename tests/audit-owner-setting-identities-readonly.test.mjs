import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyOwnerSettingIdentity,classifyHubProductCatalog,
 auditOwnerSettingIdentityReadOnly} from "../tools/production/audit-owner-setting-identities-readonly.mjs";
const uid="hubowner",hub="nico_internal",partner="partnerone",pid="partnerowner";
const company={companyKind:"internal",ownerUid:uid,active:true};
const pcompany={companyKind:"partner",ownerUid:pid,hubCompanyId:hub,active:true};
const owner={uid,companyId:hub,companyRole:"owner",active:true,
 email:"owner@example.invalid"};
const member={uid,companyId:hub,companyRole:"owner",active:true};
const authUser={uid,email:"owner@example.invalid",emailVerified:true,disabled:false};
const partnerOwner={uid:pid,companyId:partner,companyRole:"owner",active:true,
 email:"partner@example.invalid",accessKind:"partner",memberType:"cooperator",
 canViewRevenue:false,canViewUnitPrice:false};
const partnerMember={uid:pid,companyId:partner,companyRole:"owner",active:true,
 accessKind:"partner",memberType:"cooperator",
 canViewRevenue:false,canViewUnitPrice:false};
const partnerAuth={uid:pid,email:"partner@example.invalid",emailVerified:true,disabled:false};
const rel={partnerCompanyId:partner,hubCompanyId:hub,active:true,countSharingApproved:true};
const snap=(id,data,exists=true)=>({id,exists,data:()=>data});
const base={ownerUid:uid,companyId:hub,kind:"hub",company,user:owner,
 member,context:null,authUser};
test("Hub and partner correct real authenticated roles pass independently",()=>{
 assert.equal(classifyOwnerSettingIdentity(base),"OWNER_SETTING_ROLE_METADATA_READY");
 assert.equal(classifyOwnerSettingIdentity({...base,company:{...company,active:undefined}}),
  "OWNER_SETTING_ROLE_METADATA_READY");
 assert.equal(classifyOwnerSettingIdentity({
  ownerUid:pid,companyId:partner,kind:"partner",company:pcompany,
  user:partnerOwner,member:partnerMember,context:null,authUser:partnerAuth
 }),"OWNER_SETTING_ROLE_METADATA_READY");
});
test("Owner bad user schema, secondary context, Auth and partner financial access stop",()=>{
 assert.equal(classifyOwnerSettingIdentity({...base,user:{...owner,companyRole:"master"}}),
  "OWNER_USER_OR_MEMBER_ROLE_INVALID");
 assert.equal(classifyOwnerSettingIdentity({...base,member:null}),
  "OWNER_USER_OR_MEMBER_ROLE_INVALID");
 assert.equal(classifyOwnerSettingIdentity({...base,context:{active:true}}),
  "ACTIVE_SECONDARY_CONTEXT_BLOCKED");
 assert.equal(classifyOwnerSettingIdentity({...base,authUser:{...authUser,emailVerified:false}}),
  "OWNER_AUTH_METADATA_UNVERIFIED");
 assert.equal(classifyOwnerSettingIdentity({...base,user:{...owner,email:"different@example.invalid"}}),
  "OWNER_EMAIL_MISMATCH");
 assert.equal(classifyOwnerSettingIdentity({...base,user:{...owner,authKind:"partner_code_shared"}}),
  "SHARED_CODE_OWNER_NOT_ALLOWED");
 assert.equal(classifyOwnerSettingIdentity({
  ownerUid:pid,companyId:partner,kind:"partner",company:pcompany,
  user:{...partnerOwner,canViewRevenue:true},member:partnerMember,
  context:null,authUser:partnerAuth
 }),"PARTNER_OWNER_FINANCE_ISOLATION_OR_ROLE_INVALID");
});
test("Products are reduced to counts; prices in product display names rejected",()=>{
 const rows=[snap("nurosku",{companyId:hub,name:"NURO",active:true}),
  snap("airsku",{companyId:hub,name:"SoftBank Air",active:false})];
 assert.deepEqual(classifyHubProductCatalog(rows,hub),{
  total:2,active:1,retired:1,invalid:0,readableByOwner:true,
  actionableForFirstPublication:true
 });
 const bad=classifyHubProductCatalog([
  ...rows,snap("private",{companyId:hub,name:"利益100万円",active:true})
 ],hub);
 assert.equal(bad.invalid,1);
 assert.equal(bad.actionableForFirstPublication,false);
 assert.equal(classifyHubProductCatalog([],hub).actionableForFirstPublication,false);
});
function fake({u=owner,m=member,puser=partnerOwner,pmember=partnerMember,
  h=company,pc=pcompany,au=authUser,pau=partnerAuth,
  products=[snap("p1",{name:"NURO",active:true,companyId:hub})],
  context={},partnerContext={}}={}){
 const calls=[];
 const db={collection(name){
  calls.push(name);
  assert(["companies","partnerRelations","users","partnerWorkspaceContexts","products"]
   .includes(name),"unexpected read: "+name);
  if(name==="companies")return {
   select(...fields){
    assert.deepEqual(fields,["companyKind","ownerUid","active","hubCompanyId"]);
    return {limit(n){assert.equal(n,201);return {get:async()=>({
      docs:[snap(hub,h)]
    })}}};
   },
   doc(companyId){
    assert([hub,partner].includes(companyId));
    return {
     get:async()=>snap(companyId,companyId===hub?h:pc),
     collection(name){assert.equal(name,"members");return {doc(which){
      return {get:async()=>snap(which,which===uid?m:pmember)};
     }}}
    };
   }
  };
  if(name==="partnerRelations")return {
   where(k,op,val){assert.deepEqual([k,op,val],["hubCompanyId","==",hub]);
    return {select(...names){
     assert.deepEqual(names,["hubCompanyId","partnerCompanyId","active","countSharingApproved"]);
     return {limit(n){assert.equal(n,101);return {get:async()=>({docs:[
      snap(partner,rel)
     ]})}}};
    }};
   }
  };
  if(name==="products")return {
   where(k,op,v){assert.deepEqual([k,op,v],["companyId","==",hub]);return {
    select(...n){assert.deepEqual(n,["companyId","name","active"]);return {
     limit(n){assert.equal(n,1001);return {get:async()=>({docs:products})}};
    }};
   }}
  };
  if(name==="users")return {doc(v){return {get:async()=>snap(v,v===uid?u:puser)}}};
  if(name==="partnerWorkspaceContexts")return {doc(v){return {
   get:async()=>Object.hasOwn(v===uid?context:partnerContext,"active")?
    snap(v,v===uid?context:partnerContext):snap(v,{},false)
  }}};
 }};
 const auth={getUser:async v=>v===uid?au:pau};
 return {db,auth,calls};
}
test("live preflight reads ONLY bounded owner identities and safe product listing, not finance",async()=>{
 const f=fake(),r=await auditOwnerSettingIdentityReadOnly(f);
 assert.equal(r.hubOwnerMetadataReady,true);
 assert.equal(r.partnerOwnersMetadataReady,1);
 assert.equal(r.hubProductsTotal,1);
 assert.equal(r.hubProductCatalogReadyForFirstOwnerToggle,true);
 assert.equal(r.nextStep,"OWNER_MANUALLY_REVIEW_SKU_PUBLICATION_AND_RECIPROCAL_CONSENT");
 assert.equal(r.productionDocumentWrites,0);
 assert.equal(r.financeOrCountOriginalReads,0);
 assert.equal(r.realPartnerFinanceGetListDeniedVerified,false);
 assert(!f.calls.some(x=>/records|revenue|price|unit|count|sales/i.test(x)));
 const json=JSON.stringify(r);
 for(const secret of ["owner@example.invalid","partner@example.invalid",hub,partner,
  "NURO","SoftBank Air"])assert.equal(json.includes(secret),false,secret);
});
test("failed hub or partner authorization is a differentiated blocker without writes",async()=>{
 let r=await auditOwnerSettingIdentityReadOnly(fake({u:{...owner,companyRole:"master"}}));
 assert.equal(r.hubOwnerMetadataReady,false);
 assert.equal(r.nextStep,"FIX_OWNER_PROFILE_SCHEMA_WITHOUT_CHANGING_HISTORY");
 r=await auditOwnerSettingIdentityReadOnly(fake({
  puser:{...partnerOwner,canViewRevenue:true}
 }));
 assert.equal(r.partnerOwnersMetadataReady,0);
 assert.equal(r.nextStep,"FIX_PARTNER_OWNER_PROFILE_OR_FINANCE_DENIAL_BEFORE_CONSENT");
 r=await auditOwnerSettingIdentityReadOnly(fake({products:[]}));
 assert.equal(r.nextStep,"REVIEW_HUB_PRODUCT_CATALOG_WITHOUT_CHANGING_MASTERS");
});
test("proof source stays GET-only, bounded, no login/impersonation, anonymous result",()=>{
 const src=readFileSync(new URL("../tools/production/audit-owner-setting-identities-readonly.mjs",import.meta.url),"utf8");
 assert.match(src,/productionDocumentWrites:0/);
 assert.match(src,/safeToEnableJointRanking:false/);
 assert.match(src,/companyRole!=="owner"/);
 assert.match(src,/canViewRevenue!==false/);
 assert.match(src,/canViewUnitPrice!==false/);
 assert.doesNotMatch(src,/\.collection\(["'](?:records|recordCorrections|revenueGoals|partnerWorkEntries)["']\)/);
 assert.doesNotMatch(src,/\b(?:tx\.set|tx\.update|tx\.delete|\.create|\.set|\.update|\.delete|signInWith|setCustomUserClaims|firebase deploy)\s*\(/);
});
