import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {URL as BILLING_URL,PROJECT,inspectProjectBilling} from "../tools/production/inspect-project-billing-readonly.mjs";
const good=()=>({
 name:"projects/"+PROJECT+"/billingInfo",
 projectId:PROJECT,billingAccountName:"billingAccounts/secret-1234",
 billingEnabled:true
});
test("one exact Cloud Billing GET yields safe booleans and NEVER verifies free credit",async()=>{
 const calls=[];
 const result=await inspectProjectBilling(async url=>{
  calls.push(url);return {status:200,json:async()=>good()}
 });
 assert.deepEqual(calls,[BILLING_URL]);
 assert.equal(result.billingEnabled,true);
 assert.equal(result.linkedBillingAccount,true);
 assert.equal(result.trialCreditBalanceVerified,false);
 assert.equal(result.trialExpiryVerified,false);
 assert.equal(result.noRecurringChargeGuaranteed,false);
 assert.equal(result.releaseCostGatePassed,false);
 assert.equal(result.productionWrites,0);
 assert.doesNotMatch(JSON.stringify(result),/secret-1234|billingAccounts\/|access_token/i);
});
test("unlinked/unbilled project is not falsely reported as eligible for release",async()=>{
 const out=await inspectProjectBilling(async()=>({
  status:200,json:async()=>({...good(),billingEnabled:false,billingAccountName:undefined})
 }));
 assert.equal(out.billingEnabled,false);
 assert.equal(out.linkedBillingAccount,false);
 assert.equal(out.releaseCostGatePassed,false);
});
test("permissions denied return unknown rather than claim billing disabled",async()=>{
 for(const code of [401,403]){
  const out=await inspectProjectBilling(async()=>({status:code}));
  assert.equal(out.billingEnabled,null);
  assert.equal(out.billingMetadataReadable,false);
  assert.equal(out.reason,"BILLING_GET_PERMISSION_DENIED");
  assert.equal(out.releaseCostGatePassed,false);
 }
});
test("malformed resource and ambiguous errors always stop, do not authorize spending",async()=>{
 const bodies=[
  null,{},[],{...good(),billingEnabled:"true"},
  {...good(),name:"projects/another/billingInfo"},
  {...good(),billingAccountName:"billingAccounts/secret\nleak"}
 ];
 for(const body of bodies)await assert.rejects(
  inspectProjectBilling(async()=>({status:200,json:async()=>body})),
  /STOP_NICO_BILLING_READONLY_BILLING_RESPONSE_INVALID/
 );
 for(const code of [404,429,500,302])await assert.rejects(
  inspectProjectBilling(async()=>({status:code})),
  /STOP_NICO_BILLING_READONLY_/
 );
 await assert.rejects(inspectProjectBilling(async()=>{throw Error("token")}),
  /STOP_NICO_BILLING_READONLY_REMOTE_UNVERIFIED/);
});
test("auditor only uses GET against exact project and does not write/deploy",()=>{
 const s=readFileSync(new URL("../tools/production/inspect-project-billing-readonly.mjs",import.meta.url),"utf8");
 assert.match(s,/method:"GET"/);
 assert.match(s,/FIREBASE_PROJECT_ID!==PROJECT/);
 assert.match(s,/trialCreditBalanceVerified:false/);
 assert.match(s,/releaseCostGatePassed:false/);
 assert.doesNotMatch(s,/method:"POST"|method:"PATCH"|method:"DELETE"|firebase deploy|updateBillingInfo/);
});
