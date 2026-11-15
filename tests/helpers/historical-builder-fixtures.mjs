// Source-code fixtures from immutable, already pinned Git blobs. No network,
// credentials or production data. CI must check out the complete Git history.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const cache=new Map();
export function historicalBlob(sha){
 if(typeof sha!=="string"||!(/^[a-f0-9]{40}$/).test(sha))
  throw Error("HISTORICAL_FIXTURE_INVALID_BLOB");
 if(!cache.has(sha)){
  const bytes=execFileSync("git",["cat-file","blob",sha],{
   cwd:root,maxBuffer:8*1024*1024
  });
  const actual=createHash("sha1").update("blob "+bytes.length+"\0")
   .update(bytes).digest("hex");
  if(actual!==sha)throw Error("HISTORICAL_FIXTURE_BLOB_MISMATCH");
  cache.set(sha,bytes.toString("utf8"));
 }
 return cache.get(sha);
}
export function historicalSources(pins){
 return Object.fromEntries(Object.entries(pins).map(([name,sha])=>
  [name,historicalBlob(sha)]));
}
export function historicalOwnerWorkspaceInputs(partnerHtmlBlob){
 const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
 return {
  original:historicalBlob(partnerHtmlBlob),
  panel:read("ranking/owner-ranking-consent-panel.mjs"),
  bridge:read("ranking/owner-ranking-consent-firebase-bridge.mjs"),
  css:read("ranking/owner-ranking-consent-panel.css")
 };
}
