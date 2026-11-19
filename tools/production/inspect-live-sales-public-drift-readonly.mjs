#!/usr/bin/env node
/**
 * READ-ONLY public byte fingerprint for the live sales login and partner
 * workspace compared with the current PR. Only exact public Firebase Hosting
 * GET endpoints are allowed. Matching a draft does NOT authorize release.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const ROOT="https://nico-factory.web.app";
const MAX_BYTES=3*1024*1024;
const ROUTES=Object.freeze([
 {key:"home",path:"/",filename:"../../index.html",marker:"営業実績管理"},
 {key:"partnerWorkspace",path:"/partner-workspace.html",
  filename:"../../partner-workspace.html",marker:"submitPartnerWorkspaceCounts"}
]);
const digest=value=>createHash("sha256").update(value).digest("hex");
export async function inspectLiveSalesPublicDrift({
 fetcher=fetch,timeoutMs=12000,
 candidateReader=filename=>readFileSync(new URL(filename,import.meta.url))
}={}){
 if(typeof fetcher!=="function"||typeof candidateReader!=="function"||
    !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)
  throw Error("INVALID_READONLY_AUDIT_DEPENDENCIES");
 const pages={};
 for(const route of ROUTES){
  const url=ROOT+route.path;
  const u=new URL(url);
  if(u.origin!==ROOT||u.protocol!=="https:"||
     !["/","/partner-workspace.html"].includes(u.pathname))
   throw Error("BLOCK_UNREVIEWED_HTTP_ENDPOINT");
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),timeoutMs);
  let res,bytes;
  try{
   res=await fetcher(url,{method:"GET",redirect:"error",cache:"no-store",
    headers:{Accept:"text/html"},signal:ac.signal});
   if(res.status!==200||!/^text\/html(?:;|$)/i.test(res.headers.get("content-type")||""))
    throw Error("BLOCK_PUBLIC_PAGE_MISSING_OR_NON_HTML_"+route.key);
   const length=res.headers.get("content-length");
   if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>MAX_BYTES))
    throw Error("BLOCK_PUBLIC_PAGE_SIZE_"+route.key);
   bytes=Buffer.from(await res.arrayBuffer());
  }finally{clearTimeout(timer);}
  if(bytes.length===0||bytes.length>MAX_BYTES)
   throw Error("BLOCK_PUBLIC_HTML_BYTES_"+route.key);
  // A Firebase SPA fallback can return HTTP 200 for an absent page.
  if(!bytes.toString("utf8").includes(route.marker))
   throw Error("BLOCK_PUBLIC_HTML_MARKER_"+route.key);
  const draft=Buffer.from(candidateReader(route.filename));
  if(draft.length===0||draft.length>MAX_BYTES||!draft.toString("utf8").includes(route.marker))
   throw Error("BLOCK_LOCAL_DRAFT_MARKER_"+route.key);
  pages[route.key]=Object.freeze({
   publicStatus:res.status,publicBytes:bytes.length,
   publicSha256:digest(bytes),draftSha256:digest(draft),
   exactlyMatchesDraft:bytes.equals(draft)
  });
 }
 return Object.freeze({
  project:"sales-management-cc116",
  site:ROOT,
  pages:Object.freeze(pages),
  allDraftPagesAlreadyPublic:Object.values(pages).every(x=>x.exactlyMatchesDraft),
  authenticatedPartnerFinanceDeniedVerified:false,
  isolatedBackupRestoreVerified:false,
  productionDataWrites:0,deploymentPerformed:false
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const report=await inspectLiveSalesPublicDrift();
 console.log("NICO_PUBLIC_LIVE_DRAFT_BYTE_COMPARISON "+JSON.stringify(report));
}
