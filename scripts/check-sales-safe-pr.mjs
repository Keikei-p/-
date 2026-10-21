// Sales app PR safety policy. No secrets, no network, no production writes.
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

function fail(reason) {console.error("SAFETY BLOCK:",reason);process.exitCode=1;}
function gitDiff(base,head) {
  return execFileSync("git",["diff","--name-only","--diff-filter=ACMRD",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
}
const evFile=process.env.GITHUB_EVENT_PATH;
const event=evFile&&fs.existsSync(evFile)?JSON.parse(fs.readFileSync(evFile,"utf8")):{};
const base=event.pull_request?.base?.sha;
const head=event.pull_request?.head?.sha;
if(!base||!head){fail("PR event with base/head SHA required");process.exit();}
const files=gitDiff(base,head);
const protectedFiles=new Set(["index.html","firestore.rules","firebase.json",".firebaserc",
  "service-worker.js","manifest.webmanifest",
  ".github/workflows/firebase-production-deploy.yml",
  ".github/workflows/nico-factory-sync.yml",
  ".github/workflows/pr38-validation.yml",
  ".github/workflows/sales-safety-guard.yml",
  "AGENTS.md",
  "cloudflare-line/src/index.js",
  "cloudflare-line/wrangler.toml",
  "functions/index.js"]);
const protectedChanges=files.filter(f=>protectedFiles.has(f));
const labels=new Set((event.pull_request.labels||[]).map(label=>label.name));
const hasApproval=labels.has("sales-production-reviewed");
if(protectedChanges.length>0){
  console.error("Sensitive production paths changed:",protectedChanges.join(", "));
  // Explicit maintainer-added label is a *signal*, not an alternative to code review.
  if(!hasApproval)fail("Protected files require maintainer-applied label: sales-production-reviewed");
  if(!files.includes("docs/SALES_RELEASE_SIGNOFF.md"))fail("Protected files require a per-release signed review note: docs/SALES_RELEASE_SIGNOFF.md");
}
if(files.some(f=>/^\.github\/workflows\/.test(f)&&f.endsWith(".yml")) && !files.every(f=>!/^\.github\/workflows\/.test(f))){
  console.log("Workflow changes require manual review of job permissions and deployment triggers");
}
// The finance project is deliberately NOT wired to the production client yet.
const financeSource="cloudflare-finance/src/index.js";
const financeConfig="cloudflare-finance/wrangler.toml";
const financeRules="cloudflare-finance/finance-locked.rules";
const project=JSON.parse(fs.readFileSync(".firebaserc","utf8")).projects?.default;
if(project!=="sales-management-cc116")fail("Firebase project identity changed");
const firebaseConfig=JSON.parse(fs.readFileSync("firebase.json","utf8"));
if(firebaseConfig.firestore?.rules!=="firestore.rules")fail("Staged finance rules cannot be production rules path");
if(fs.existsSync(financeConfig)){
  const config=fs.readFileSync(financeConfig,"utf8");
  if(!/FINANCE_GATEWAY_ENABLED\s*=\s*"disabled"/.test(config))
    fail("Finance Worker must default to disabled");
}
if(fs.existsSync(financeSource)){
  const s=fs.readFileSync(financeSource,"utf8");
  if(!s.includes('FINANCE_GATEWAY_ENABLED!=="enabled"'))
    fail("Finance Worker explicit runtime disable gate absent");
  if(/firebase\s+deploy|wrangler\s+deploy/.test(s))
    fail("Gateway must not attempt production deploy");
}
if(fs.existsSync(financeRules) && firebaseConfig.firestore.rules===financeRules)
  fail("Candidate finance rules must never be deployed by default");
for(const f of files.filter(f=>f.endsWith(".yml")&&f.startsWith(".github/workflows/"))){
  if(!fs.existsSync(f))continue;
  const s=fs.readFileSync(f,"utf8");
  if(f.includes("finance") && /firebase deploy --only firestore:rules/.test(s))
    fail("Staged finance workflow cannot deploy production Firestore rules");
}
console.log("Changed files:",files.length);
if(!process.exitCode)console.log("PASS: PR source guard (not a substitute for branch protection/approval)");
