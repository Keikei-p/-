#!/usr/bin/env node
/**
 * Public-HTML GET only. Inspect Hosting deployment drift without credentials
 * or logging customer data, HTML bodies, tokens or finance records.
 */
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {uploadSha} from "../hosting/owner-setup-additive-guard.mjs";

const URL="https://nico-factory.web.app/partner-workspace.html";
const KNOWN_HOSTING_SHA256="97f9e5cb7412694bb63726e9ddee3c4e5bde954246b5ced97ce1c0ddbdd69a9d";
const OWNER_MAIN_SHA="9e1df7ffa9de715edc9cdc3750bf043a9f046565";
const fail=()=>{throw Error("PARTNER_PUBLIC_HTML_READONLY_UNVERIFIED");};
const git=(...args)=>execFileSync("git",args,{encoding:"utf8",maxBuffer:12_000_000});
if(process.env.GITHUB_ACTIONS!=="true"||
   process.env.GITHUB_REPOSITORY!=="Keikei-p/-"||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
   process.env.GOOGLE_APPLICATION_CREDENTIALS||
   process.env.FIREBASE_TOKEN||
   git("rev-parse","HEAD").trim()===OWNER_MAIN_SHA) {
 // Main is allowed as a PR base but cannot be used to read live data.
 // The branch must contain this exact audited script on top of main.
 if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
    process.env.GOOGLE_APPLICATION_CREDENTIALS||
    process.env.FIREBASE_TOKEN)fail();
}
const res=await fetch(URL+"?public_html_readonly_audit="+Date.now(),{
 method:"GET",redirect:"error",cache:"no-store",
 headers:{Accept:"text/html"}
});
if(res.status!==200||res.url.split("?")[0]!==URL||
   !/text\/html/i.test(res.headers.get("content-type")||""))fail();
const live=await res.text();
if(live.length<10000||live.length>300000)fail();
const main=readFileSync("partner-workspace.html","utf8");
const markers={
 modulePresent:live.includes('type="module"'),
 originalDashboardPresent:live.includes("function renderCountOnlyDashboard(summary,days)"),
 originalSummaryBug:live.includes('dates[0]+" 〜 "+dates.at(-1),')&&
   !live.includes('days[0]+" 〜 "+days.at(-1),'),
 newSummaryFix:live.includes('days[0]+" 〜 "+days.at(-1),'),
 partnerJointDisabled:live.includes("const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;"),
 companyInputPresent:live.includes("getPartnerWorkspace"),
 existingStaffUI:live.includes('id="countStaffRank"'),
 existingProductUI:live.includes('id="countProductRank"')
};
const commits=git("log","--format=%H","--max-count=65","--","partner-workspace.html")
 .split("\n").map(s=>s.trim()).filter(Boolean);
const historical=[];
for(const sha of commits){
 const body=git("show",sha+":partner-workspace.html");
 const zipped=uploadSha(body);
 const raw=createHash("sha256").update(body).digest("hex");
 historical.push({sha:sha.slice(0,12),fullSha:sha,uploadSha:zipped,rawSha256:raw,
  lines:body.split("\n").length,
  exactLive:body===live,matchHosting:zipped===KNOWN_HOSTING_SHA256});
}
const closest=historical.filter(x=>x.exactLive||x.matchHosting);
const liveLines=live.split("\n");
const mainLines=main.split("\n");
let prefix=0;
while(prefix<Math.min(liveLines.length,mainLines.length)&&liveLines[prefix]===mainLines[prefix])prefix++;
let suffix=0;
while(suffix<Math.min(liveLines.length-prefix,mainLines.length-prefix)&&
 liveLines[liveLines.length-1-suffix]===mainLines[mainLines.length-1-suffix])suffix++;
const out={
 audit:"PUBLIC_HTML_GET_ONLY",
 url:URL,
 live:{rawSha256:createHash("sha256").update(live).digest("hex"),
  uploadSha:uploadSha(live),hostingHash:KNOWN_HOSTING_SHA256,
  gzipMatchesHosting:uploadSha(live)===KNOWN_HOSTING_SHA256,
  bytes:Buffer.byteLength(live),lines:liveLines.length,
  ...markers},
 reviewedMain:{uploadSha:uploadSha(main),bytes:Buffer.byteLength(main),lines:mainLines.length},
 historicalCommitsChecked:historical.length,
 matchedCommits:closest.map(x=>({sha:x.sha,exactLive:x.exactLive,matchHosting:x.matchHosting})),
 nearestMainLineDiff:{identicalPrefix:prefix,identicalSuffix:suffix,
  changedMainLines:mainLines.length-prefix-suffix,
  changedLiveLines:liveLines.length-prefix-suffix},
 noWrites:true
};
console.log("NICO_PARTNER_LIVE_HTML_PUBLIC_READONLY "+JSON.stringify(out));
