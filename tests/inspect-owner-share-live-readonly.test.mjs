import test from "node:test";
import assert from "node:assert/strict";
import {ASSETS,inspectOwnerShareLive}
  from "../tools/production/inspect-owner-share-live-readonly.mjs";
const prefix = "projects/sales-management-cc116/locations/asia-northeast1/functions/";
const f = (name, flag) => ({
  name: prefix + name, state:"ACTIVE",
  serviceConfig:{environmentVariables:{
    NICO_OWNER_PRODUCT_VISIBILITY_ENABLED:flag,
    NICO_JOINT_COUNT_RANKING_ENABLED:flag
  }}
});
const pages = () => ({
  "/index.html":{status:200,body:'OWNER_PRODUCT_SHARE_INLINE_START id="ownerProductShareInline" mountOwnerProductVisibilityDashboard'},
  ...Object.fromEntries(Object.entries(ASSETS).map(([path,marker])=>[path,{status:200,body:"export function "+marker+"(){}"}]))
});
const rows = (flag="enabled") => [
  f("getOwnerProductVisibility",flag),f("setOwnerProductVisibility",flag),
  f("getVerifiedJointCountRanking",flag)
];
test("complete synthetic deployment is only technical readiness, never real-owner proof",()=>{
  const p=inspectOwnerShareLive({publicFiles:pages(),cloudFunctions:rows(),mainIndexMatches:true});
  assert.equal(p.ownerShareTechnicalReady,true);
  assert.equal(p.actualOwnerToggleSaveVerified,false);
  assert.equal(p.partnerFinanceGetListDeniedVerified,false);
  assert.equal(p.firestoreWrites,0);
});
test("released index alone with API flags disabled must be NOT READY",()=>{
  const p=inspectOwnerShareLive({publicFiles:pages(),cloudFunctions:rows("disabled"),mainIndexMatches:true});
  assert.equal(p.indexReady,true);
  assert.equal(p.ownerShareTechnicalReady,false);
  assert.equal(p.visibilityGetEnabled,false);
  assert.equal(p.rankingEnabled,false);
});
test("missing Hosting module blocks technical readiness even with enabled Functions",()=>{
  const p=pages();
  p["/ranking/owner-product-visibility-panel.mjs"]={status:404,body:"Not Found"};
  assert.equal(inspectOwnerShareLive({publicFiles:p,cloudFunctions:rows(),mainIndexMatches:true}).ownerShareTechnicalReady,false);
});
test("stale public index or absent callable cannot pass",()=>{
  assert.equal(inspectOwnerShareLive({publicFiles:pages(),cloudFunctions:rows(),mainIndexMatches:false}).ownerShareTechnicalReady,false);
  assert.equal(inspectOwnerShareLive({publicFiles:pages(),cloudFunctions:[rows()[0]],mainIndexMatches:true}).ownerShareTechnicalReady,false);
});
test("reject wrong project, duplicate cloud identity and incomplete HTTP evidence",()=>{
  assert.throws(()=>inspectOwnerShareLive({publicFiles:pages(),cloudFunctions:[{name:"projects/other/locations/asia-northeast1/functions/getOwnerProductVisibility"}],mainIndexMatches:true}),/CLOUD_SCOPE/);
  assert.throws(()=>inspectOwnerShareLive({publicFiles:pages(),cloudFunctions:[rows()[0],rows()[0]],mainIndexMatches:true}),/CLOUD_SCOPE/);
  const p=pages();delete p["/index.html"];
  assert.throws(()=>inspectOwnerShareLive({publicFiles:p,cloudFunctions:rows(),mainIndexMatches:true}),/INDEX_UNVERIFIED/);
});
