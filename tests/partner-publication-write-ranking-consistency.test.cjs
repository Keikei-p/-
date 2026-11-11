"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {allowedPartnerCategories,KEYS}=require("../functions-partner-workspace/approved-published-categories.cjs");
const {createPartnerSubmissionPublicationGuard}=require("../functions-partner-workspace/submission-publication-guard.cjs");

// The UI/ranking allowlist and the transactional write guard must agree.
// Pure in-memory Firestore stubs: never touches production or credentials.
const hubId="hub",cid="partner",ownerUid="owner",uid="worker";
const product={id:"nuro",companyId:hubId,name:"NURO",active:true};
const visibility={hubCompanyId:hubId,ownerUid,version:1,
 enabledHubProductIds:["nuro"],partnerOverrides:{}};
const mapping={hubCompanyId:hubId,ownerUid,reviewedByUid:ownerUid,
 active:true,version:1,bindings:[{companyId:cid,productId:"partnerSku01",hubProductId:"nuro"}]};
const catalog={schema:"nico-reviewed-count-public-catalog-v1",hubCompanyId:hubId,
 ownerUid,version:1,products:[product]};
const zeros=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
function fixture({visible=visibility,mapped=mapping,publicCatalog=catalog}={}){
 const docs={
  "companies/hub":{ownerUid,active:true},
  "companies/partner":{companyKind:"partner",active:true,hubCompanyId:hubId},
  "partnerRelations/partner":{hubCompanyId:hubId,partnerCompanyId:cid,active:true,countSharingApproved:true},
  "companies/hub/rankingProductVisibility/shared":visible,
  "companies/hub/rankingSkuMappings/shared":mapped,
  "companies/hub/rankingCountPublicCatalog/shared":publicCatalog
 };
 const db={collection(name){return {doc(id){return ref(name+"/"+id)}}}};
 function ref(path){return {path,collection(name){return {doc(id){return ref(path+"/"+name+"/"+id)}}}}}
 const tx={async get(reference){const data=docs[reference.path];return {
  exists:data!==undefined,data:()=>data
 }}};
 const verify=createPartnerSubmissionPublicationGuard({db});
 const scope={verifiedByServer:true,kind:"partner",uid,cid,hubId};
 return {tx,verify,scope};
}
test("approved UI categories match the transactional write allowlist",async()=>{
 const expected=allowedPartnerCategories({hubId,cid,ownerUid,
  visibility,mapping,products:[product]});
 assert.deepEqual(expected,["NURO"]);
 const {tx,verify,scope}=fixture();
 const before=zeros(),after={...before,NURO:3};
 const result=await verify({tx,scope,previousCounts:before,nextCounts:after});
 assert.deepEqual([...result.enabledCategories],expected);
 assert.equal(result.publicationVersion,1);
});
test("OFF category cannot be newly reported, but existing history is preserved",async()=>{
 const {tx,verify,scope}=fixture();
 const before={...zeros(),SBMNP:4};
 const same={...before,NURO:2};
 await assert.doesNotReject(verify({tx,scope,previousCounts:before,nextCounts:same}));
 await assert.rejects(verify({tx,scope,previousCounts:before,
  nextCounts:{...before,SBMNP:5}}),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
 await assert.rejects(verify({tx,scope,previousCounts:before,
  nextCounts:{...before,SBMNP:0}}),/PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
});
test("stale published catalog version fails closed",async()=>{
 const {tx,verify,scope}=fixture({publicCatalog:{...catalog,version:2}});
 await assert.rejects(verify({tx,scope,previousCounts:zeros(),nextCounts:zeros()}),
  /PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
});
test("unverified browser scope cannot bypass publication",async()=>{
 const {tx,verify,scope}=fixture();
 await assert.rejects(verify({tx,scope:{...scope,verifiedByServer:false},
  previousCounts:zeros(),nextCounts:zeros()}),
  /PARTNER_SUBMISSION_PUBLICATION_UNVERIFIED/);
});
