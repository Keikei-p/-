import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectLiveSalesPublicDrift} from "../tools/production/inspect-live-sales-public-drift-readonly.mjs";
const draft={
 home:Buffer.from("<title>営業実績管理</title><p>draft</p>"),
 partnerWorkspace:Buffer.from("<p>submitPartnerWorkspaceCounts draft</p>")
};
function mock({changed=false,missing=false,type=null,huge=false,redirect=false}={}){
 const seen=[];
 return {seen,fetcher:async(url,opts)=>{
  seen.push({url,opts});
  const key=url.endsWith("/partner-workspace.html")?"partnerWorkspace":"home";
  let body=draft[key];
  if(changed&&key==="home")body=Buffer.from("<title>営業実績管理</title><p>previous-live-version</p>");
  if(missing&&key==="partnerWorkspace")body=Buffer.from("SPA fallback");
  const headers={"Content-Type":type??"text/html; charset=utf-8"};
  if(huge)headers["Content-Length"]="5000000";
  return new Response(body,{status:redirect?302:200,headers});
 }};
}
const candidateReader=name=>name.includes("partner-workspace")?draft.partnerWorkspace:draft.home;
test("public GET exactly matches draft only when both byte-identical pages are served",async()=>{
 const c=mock(),r=await inspectLiveSalesPublicDrift({fetcher:c.fetcher,candidateReader});
 assert.equal(r.allDraftPagesAlreadyPublic,true);
 assert.equal(r.pages.home.exactlyMatchesDraft,true);
 assert.equal(r.pages.partnerWorkspace.exactlyMatchesDraft,true);
 assert.match(r.pages.home.publicSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.deploymentPerformed,false);
 assert.equal(r.productionDataWrites,0);
 assert.equal(r.authenticatedPartnerFinanceDeniedVerified,false);
 assert.equal(r.isolatedBackupRestoreVerified,false);
 assert.equal(c.seen.length,2);
 for(const {url,opts} of c.seen){
  assert(["https://nico-factory.web.app/","https://nico-factory.web.app/partner-workspace.html"].includes(url));
  assert.equal(opts.method,"GET");
  assert.equal(opts.redirect,"error");
  assert.equal(opts.headers.Authorization,undefined);
  assert.equal(opts.body,undefined);
 }
});
test("older real production source does not masquerade as deployed PR",async()=>{
 const c=mock({changed:true});
 const r=await inspectLiveSalesPublicDrift({fetcher:c.fetcher,candidateReader});
 assert.equal(r.pages.home.exactlyMatchesDraft,false);
 assert.equal(r.pages.partnerWorkspace.exactlyMatchesDraft,true);
 assert.equal(r.allDraftPagesAlreadyPublic,false);
 assert.notEqual(r.pages.home.publicSha256,r.pages.home.draftSha256);
});
test("SPA fallback, redirect and wrong content type fail closed",async()=>{
 for(const variant of [{missing:true},{redirect:true},{type:"application/json"}]){
  const c=mock(variant);
  await assert.rejects(inspectLiveSalesPublicDrift({fetcher:c.fetcher,candidateReader}));
 }
});
test("oversized public page rejected before body parsing",async()=>{
 const c=mock({huge:true});
 await assert.rejects(inspectLiveSalesPublicDrift({fetcher:c.fetcher,candidateReader}),
  /BLOCK_PUBLIC_PAGE_SIZE/);
});
test("invalid audit inputs do not initiate a network request",async()=>{
 let called=false;const fetcher=()=>{called=true;throw Error("should not run")};
 await assert.rejects(inspectLiveSalesPublicDrift({fetcher,timeoutMs:-1,candidateReader}));
 assert.equal(called,false);
});
test("audit source never handles service accounts, customer records, Firestore or deploy",()=>{
 const src=readFileSync(new URL("../tools/production/inspect-live-sales-public-drift-readonly.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/firebase-admin|GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_SERVICE_ACCOUNT_JSON|httpsCallable|firestore\.googleapis|\/records\b|\/products\b|deploy --only|wrangler\s+deploy|createWriteStream|setDoc\(/i);
});
