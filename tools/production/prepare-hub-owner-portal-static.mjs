#!/usr/bin/env node
/**
 * Offline-only, immutable portal assets bundle. Not a Hosting publisher.
 * The same Firebase Auth session is shared with the canonical index by
 * getAuth(defaultApp); no impersonation, new account or credentials.
 */
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync,writeFileSync,rmSync,existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
export const REVIEWED=Object.freeze({
 "staging/hub-owner-management/owner-partner-admin.html":"f6609e6664ec11f629ea57751295abe18cb1dc2a",
 "staging/partner-owner-correction-v3/mobile-bootstrap.mjs":"fe8fa6779093a19cdc4c678acf85df348a61f76a",
 "staging/partner-owner-correction-v3/owner-client.mjs":"3df123912de87d3212c173997465c721f5b9e54e",
 "staging/partner-owner-correction-v3/owner-ui.mjs":"7c10e98da34339aa26b5fdc0ac89798b57c01016"
});
const stop=code=>{throw Error("STOP_HUB_OWNER_PORTAL_"+code);};
const gitBlob=x=>{const b=Buffer.from(x,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
};
export function prepareHubPortal(files){
 if(!files||typeof files!=="object"||Array.isArray(files))
  stop("FILES_INVALID");
 for(const [name,hash] of Object.entries(REVIEWED))
  if(typeof files[name]!=="string"||gitBlob(files[name])!==hash)
   stop("SOURCE_CHANGED");
 const html=files["staging/hub-owner-management/owner-partner-admin.html"],
  boot=files["staging/partner-owner-correction-v3/mobile-bootstrap.mjs"],
  client=files["staging/partner-owner-correction-v3/owner-client.mjs"],
  ui=files["staging/partner-owner-correction-v3/owner-ui.mjs"];
 if(!html.includes("const HUB_OWNER_CORRECTION_READY=false")||
  !html.includes('getAuth(app)')||!html.includes('getPartnerWorkspace')||
  !html.includes('countOnlyRegisteredCompanies(response,day)')||
  !html.includes("await currentPanel.selectCompany(partnerId)")||
  !html.includes("./owner-partner-admin-assets/mobile-bootstrap.mjs")||
  /\b(?:signInWithEmailAndPassword|createUserWithEmailAndPassword|deleteUser|setDoc|updateDoc|writeBatch|localStorage|sessionStorage)\s*\(/.test(html)||
  !boot.includes('from "./owner-client.mjs"')||
  !boot.includes('from "./owner-ui.mjs"')||
  !client.includes('from "./owner-ui.mjs"')||
  !ui.includes('function selectCompany('))
  stop("PORTAL_CONTRACT_CHANGED");
 return Object.freeze({
  "owner-partner-admin.html":html,
  "owner-partner-admin-assets/mobile-bootstrap.mjs":boot,
  "owner-partner-admin-assets/owner-client.mjs":client,
  "owner-partner-admin-assets/owner-ui.mjs":ui
 });
}
export function writeRunnerPackage(files,dir){
 if(process.env.GITHUB_ACTIONS!=="true"||
    process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
    !process.env.RUNNER_TEMP||
    path.resolve(dir)!==path.join(path.resolve(process.env.RUNNER_TEMP),"nico-owner-portal-static")||
    existsSync(dir))stop("RUNNER_ONLY");
 try{
  mkdirSync(dir,{mode:0o700});
  mkdirSync(path.join(dir,"owner-partner-admin-assets"),{mode:0o700});
  for(const [name,body] of Object.entries(files))
   writeFileSync(path.join(dir,name),body,{flag:"wx",encoding:"utf8",mode:0o600});
 }catch(err){rmSync(dir,{recursive:true,force:true});throw err;}
 return Object.freeze(Object.keys(files));
}
function main(){
 if(process.argv.length!==3||process.argv[2]!=="--prepare")stop("PREPARE_ONLY");
 const base=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
 const files=Object.fromEntries(Object.keys(REVIEWED).map(name=>[
  name,readFileSync(path.join(base,name),"utf8")
 ]));
 const result=prepareHubPortal(files);
 const dest=path.join(process.env.RUNNER_TEMP||"","nico-owner-portal-static");
 writeRunnerPackage(result,dest);
 console.log("HUB_OWNER_PORTAL_STAGING_READY "+JSON.stringify({
  scope:"new/additive HTML and 3 JS modules only",
  sameLogin:true,partnerImpersonation:false,liveCorrectionEnabled:false,
  knownExistingCountCorrectionPrepared:true,
  firebaseWrites:0,hostingReleases:0,fileCount:Object.keys(result).length
 }));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(e){
  console.error(/^STOP_HUB_OWNER_PORTAL_[A-Z_]+$/.test(e.message||"")?
   e.message:"STOP_HUB_OWNER_PORTAL_UNKNOWN");
  process.exitCode=1;
 }
