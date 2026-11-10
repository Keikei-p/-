"use strict";
/** Read-only live Firestore Rules audit. Never reads user records or writes data. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {GoogleAuth}=require("google-auth-library");
const project="sales-management-cc116";
const endpoint="https://firebaserules.googleapis.com/v1/projects/"+project+"/releases/cloud.firestore";
async function main(){
 if(process.env.NICO_PROD_AUDIT_MODE!=="READ_ONLY")throw Error("READ_ONLY_MODE_REQUIRED");
 const file=process.env.GOOGLE_APPLICATION_CREDENTIALS;
 if(!file||!fs.existsSync(file))throw Error("EXISTING_SERVICE_ACCOUNT_REQUIRED");
 const auth=new GoogleAuth({scopes:["https://www.googleapis.com/auth/cloud-platform"]});
 const client=await auth.getClient();
 const response=await client.request({url:endpoint,method:"GET",timeout:20000});
 const ruleset=response.data?.rulesetName;
 assert.match(ruleset||"",/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/);
 const rules=await client.request({url:"https://firebaserules.googleapis.com/v1/"+ruleset,method:"GET",timeout:20000});
 const sources=rules.data?.source?.files;
 assert(Array.isArray(sources)&&sources.length>0,"LIVE_RULESET_SOURCE_MISSING");
 const text=sources.map(f=>f.content||"").join("\n");
 const anchors=["function isCompanyMember(","function sameCompany("];
 for(const anchor of anchors)assert(text.includes(anchor),"LIVE_RULES_MISSING_"+anchor);
 for(const name of ["products","records","recordCorrections","goals","revenueGoals"]){
  const at=text.indexOf("match /"+name+"/{");
  assert(at>=0,"LIVE_RULES_MISSING_COLLECTION_"+name);
  const snippet=text.slice(at,at+1000);
  assert(/allow read: if resource\.data\.companyId != null\s*&& sameCompany\(resource\.data\.companyId\)/.test(snippet),"LIVE_FINANCE_BOUNDARY_NOT_PROVEN_"+name);
 }
 const member=text.slice(text.indexOf("function isCompanyMember("),text.indexOf("function isCompanyLeader("));
 for(const term of ["company.get('companyKind', 'internal') == 'internal'","user.get('accessKind', 'internal') == 'internal'","member.get('accessKind', 'internal') == 'internal'"])
  assert(member.includes(term),"LIVE_INTERNAL_MEMBERSHIP_GATE_MISSING");
 console.log("LIVE_RULES_FINANCE_STATIC_BOUNDARY_PASS collections=5; no documents read; no writes");
 console.log("LIMITATION: static rules check only; partner-account GET/LIST and backup restore require separate evidence");
}
main().catch(e=>{console.error("LIVE_RULES_READONLY_AUDIT_FAILED",e.message?.replace(/[^A-Za-z0-9_ -]/g,"_").slice(0,120));process.exitCode=1});
