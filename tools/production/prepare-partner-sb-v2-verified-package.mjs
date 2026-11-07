#!/usr/bin/env node
/**
 * COST-FREE, NO-DEPLOY release preflight for the already-reviewed
 * SB Light/Air count-only Functions staging prototype.
 *
 * Constructs a disposable Firebase Functions source package. No live
 * Firebase credentials, Firebase APIs, data migration or published app change.
 * The release team must separately review and approve any actual deployment.
 */
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync,writeFileSync,rmSync,existsSync,lstatSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const REVIEWED_BLOBS=Object.freeze({
 "functions-partner-workspace/index.js":"38da7e9174ffea7c406c92292dccfc651b565eb0",
 "functions-partner-workspace/company-code-auth.cjs":"f7e5899cdb9e36da610846d787955b13c1e16e4b",
 "functions-partner-workspace/package.json":"6572599ecac0b8e2b05c166f9e921dc07c0b39f1",
 "functions-partner-workspace/service.cjs":"b94a6aba231dc2569009580a178297a5b6194bda",
 "firebase.partner-workspace.json":"a6ceedec5fab4e22e0a8efe19c685716a2db9750",
 "staging/partner-sb-v2/service.cjs":"41157a07e159cde651b542bbb9b725039ed7fb58",
 "staging/partner-sb-v2/sb-category-v2.cjs":"7f1f7214dd38c6aae3339bab26a8378f1e556f4c",
 "staging/partner-sb-v2/partner-workspace.html":"82a1ed0c67b14ea3fd915419da7864b7c99ffe7b",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "partner-workspace.html":"0930abb188165afea19ef427308ea22fddf636e7",
 "index.html":"88ef5636bfe9254e71f2109d452b6d3049f99861",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190"
});
const stop=c=>{throw Error("STOP_SB_V2_RELEASE_"+c)};
export function gitBlob(bytes){
 const raw=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,"utf8");
 const head=Buffer.from("blob "+raw.length+"\0");
 return createHash("sha1").update(head).update(raw).digest("hex");
}
export function verifySource(files){
 if(!files||typeof files!=="object"||Array.isArray(files))stop("INVALID_SOURCE_SET");
 const paths=Object.keys(REVIEWED_BLOBS);
 if(paths.some(p=>typeof files[p]!=="string"||gitBlob(files[p])!==REVIEWED_BLOBS[p]))
  stop("REVIEWED_SOURCE_CHANGED");
 const index=files["functions-partner-workspace/index.js"];
 const companyCode=files["functions-partner-workspace/company-code-auth.cjs"];
 const pkg=JSON.parse(files["functions-partner-workspace/package.json"]);
 const config=JSON.parse(files["firebase.partner-workspace.json"]);
 const staged=files["staging/partner-sb-v2/service.cjs"];
 const helper=files["staging/partner-sb-v2/sb-category-v2.cjs"];
 const old=files["functions-partner-workspace/service.cjs"];
 const livePage=files["partner-workspace.html"];
 const nextPage=files["staging/partner-sb-v2/partner-workspace.html"];
 if(Object.keys(config).join()!=="functions"||
    config.functions?.source!=="functions-partner-workspace"||
    config.functions?.codebase!=="partner-workspace"||
    pkg.main!=="index.js"||pkg.engines?.node!=="22"||
    index.includes("require(\"./service.cjs\")")===false||
    !index.includes("PARTNER_WORKSPACE_ENABLED===\"enabled\"")||
    !index.includes("region:\"asia-northeast1\"")||
    !index.includes("require(\"./company-code-auth.cjs\")")||
    !companyCode.includes("makeCompanyCodeAuth")||
    !staged.includes('require("./sb-category-v2.cjs")')||
    !staged.includes('sbBreakdownSchema:"sb-separated-v1"')||
    !staged.includes("previousSbBreakdown:")||
    !helper.includes("旧未分類")||
    !old.includes('"SB光・AIR"')||old.includes("sbBreakdownSchema")||
    !nextPage.includes("sbBreakdownSchema===\"sb-separated-v1\"")||
    livePage.includes('id="sbSplitBox"'))
  stop("UNREVIEWED_PARTNER_SHAPE");
 const exports=[...index.matchAll(/exports\.([A-Za-z][A-Za-z0-9_]*)\s*=/g)].map(m=>m[1]);
 const expected=["getPartnerWorkspace","managePartnerWorkspace","acceptPartnerWorkspaceInvite",
  "submitPartnerWorkspaceCounts","issuePartnerCompanyCode","activatePartnerCompanyCode",
  "loginPartnerCompanyCode","logoutPartnerCompanyCode"];
 if(exports.length!==expected.length||expected.some(n=>!exports.includes(n)))
  stop("UNREVIEWED_FUNCTION_EXPORT");
 return Object.freeze({
  existingProductionServicePreserved:true,
  originalCountKeysPreserved:true,
  stagedSplitAndLegacyUnknownVerified:true,
  existingEightFunctionExportsPreserved:true,
  deployApproved:false,liveCountWriteVerified:false,financeBoundaryVerified:false
 });
}
export function makePackage(files){
 const report=verifySource(files);
 // The actual deployable Node package contains only these 5 files. The
 // original source tree, codebase, index, company-code functions and version
 // approval workflow remain untouched.
 const bundle=Object.freeze({
  "functions-partner-workspace/index.js":files["functions-partner-workspace/index.js"],
  "functions-partner-workspace/company-code-auth.cjs":
   files["functions-partner-workspace/company-code-auth.cjs"],
  "functions-partner-workspace/package.json":files["functions-partner-workspace/package.json"],
  "functions-partner-workspace/service.cjs":files["staging/partner-sb-v2/service.cjs"],
  "functions-partner-workspace/sb-category-v2.cjs":files["staging/partner-sb-v2/sb-category-v2.cjs"],
  "firebase.partner-workspace.json":files["firebase.partner-workspace.json"]
 });
 const names=Object.keys(bundle);
 if(names.length!==6)stop("UNREVIEWED_DEPLOY_BUNDLE");
 return Object.freeze({bundle,report});
}
function checkTemporaryDestination(dest){
 if(!process.env.RUNNER_TEMP||!process.env.GITHUB_ACTIONS||
    process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REPOSITORY!=="Keikei-p/-")
  stop("NOT_ISOLATED_RUNNER");
 const root=path.resolve(process.env.RUNNER_TEMP);
 if(dest!==path.join(root,"nico-reviewed-sb-v2-functions-package")||
    !path.isAbsolute(root)||root==="/")
  stop("NOT_REVIEWED_RUNNER_PATH");
 if(existsSync(dest))stop("RUNNER_PACKAGE_ALREADY_EXISTS");
 return dest;
}
export function writeDisposablePackage(packageResult,dest){
 const root=checkTemporaryDestination(dest);
 if(!packageResult||!packageResult.bundle)stop("INVALID_PACKAGE");
 const created=[];
 try{
  mkdirSync(root,{mode:0o700});
  for(const [name,data] of Object.entries(packageResult.bundle)){
   if(!["firebase.partner-workspace.json",
    "functions-partner-workspace/index.js",
    "functions-partner-workspace/company-code-auth.cjs",
    "functions-partner-workspace/package.json",
    "functions-partner-workspace/service.cjs",
    "functions-partner-workspace/sb-category-v2.cjs"].includes(name))
    stop("UNREVIEWED_PACKAGE_PATH");
   const full=path.join(root,name);
   if(name.includes("functions-partner-workspace/")){
    const dir=path.dirname(full);
    if(!existsSync(dir))mkdirSync(dir,{mode:0o700});
   }
   writeFileSync(full,data,{encoding:"utf8",mode:0o600,flag:"wx"});
   created.push(name);
  }
  return created;
 }catch(error){
  rmSync(root,{recursive:true,force:true});
  throw error;
 }
}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=="--prepare"||
    process.env.GITHUB_EVENT_NAME==="workflow_dispatch")
  stop("PREPARE_ONLY_NOT_DEPLOY");
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
 const sources={};
 for(const name of Object.keys(REVIEWED_BLOBS)){
  const full=path.resolve(root,name);
  if(!full.startsWith(root+path.sep))stop("SOURCE_OUTSIDE_REPO");
  sources[name]=readFileSync(full,"utf8");
 }
 const prepared=makePackage(sources);
 const dest=path.join(process.env.RUNNER_TEMP||"","nico-reviewed-sb-v2-functions-package");
 writeDisposablePackage(prepared,dest);
 console.log("SB_V2_STAGED_PACKAGE_READY_NO_DEPLOY "+JSON.stringify(prepared.report));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{
  console.error(/^STOP_SB_V2_RELEASE_[A-Z0-9_]+$/.test(e?.message||"")?
   e.message:"STOP_SB_V2_RELEASE_UNVERIFIED");
  process.exitCode=1;
 });
}
