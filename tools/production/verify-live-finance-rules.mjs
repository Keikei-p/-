#!/usr/bin/env node
// Read-only verification of published Firestore Rules release source.
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const hash=s=>createHash("sha256").update(s.replace(/\r\n/g,"\n").trim()).digest("hex");
const fail=()=>{console.error("RULESET_VERIFY_STOP: deployed Rules do not match expected hash");process.exitCode=1;};
async function main(){
 const expected=process.argv[2],project=process.env.FIREBASE_PROJECT_ID;
 if(!/^[a-f0-9]{64}$/.test(expected||"")||project!=="sales-management-cc116"||
   !process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.GITHUB_ACTIONS!=="true"){
   fail();return;
 }
 const require=createRequire(new URL("../../functions/package.json",import.meta.url));
 const {applicationDefault}=require("firebase-admin/app");
 const {access_token}=await applicationDefault().getAccessToken();
 if(!access_token){fail();return;}
 const root="https://firebaserules.googleapis.com/v1/projects/"+project;
 async function get(url){
  const r=await fetch(url,{headers:{Authorization:"Bearer "+access_token},redirect:"error"});
  if(!r.ok)throw Error("rules_read_failed");
  return r.json();
 }
 const release=await get(root+"/releases/cloud.firestore");
 if(!/^projects\/sales-management-cc116\/rulesets\/[A-Za-z0-9_-]+$/.test(release.rulesetName||"")){fail();return;}
 const rule=await get("https://firebaserules.googleapis.com/v1/"+release.rulesetName);
 if(!Array.isArray(rule.source?.files)||rule.source.files.length!==1||
    typeof rule.source.files[0]?.content!=="string"||
    hash(rule.source.files[0].content)!==expected){fail();return;}
 console.log("VERIFIED_ACTUAL_LIVE_FIRESTORE_RULES_HASH="+expected);
}
main().catch(()=>fail());
