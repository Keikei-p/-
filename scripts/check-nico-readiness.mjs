#!/usr/bin/env node
/**
 * Anonymous, read-only NICO migration readiness check.
 * No Firebase credentials, no token, no document reads or writes.
 * Checks the canonical NICO site. Optional parity mode compares the published site to main.\n * Scheduled checks do not require unshipped main commits to have deployed.
 */
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const PROJECT_ID = "sales-management-cc116";
export const HOSTS = Object.freeze({
  company: "https://nico-factory.web.app/"
});
export const FILES = Object.freeze([
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png"
]);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function verifyHtml(html) {
  const required = [
    '<title>営業実績管理</title>',
    'projectId: "'+PROJECT_ID+'"',
    'authDomain: "sales-management-cc116.firebaseapp.com"',
    'signInWithEmailAndPassword',
    'recordCorrections',
    'canCurrentUserCorrectRecord',
    'service-worker.js',
    'manifest.webmanifest',
    'getFirestore(app)'
  ];
  for (const token of required) {
    if (!html.includes(token)) throw Error("Published app does not match essential sales-app contract");
  }
  if (html.includes("SAFE_FINANCE_CUTOVER"))
    throw Error("Unexpected unapproved Finance Gateway cutover");
}
function verifyManifest(text) {
  const manifest=JSON.parse(text);
  if(manifest.start_url!=="./" || manifest.scope!=="./" ||
    manifest.display!=="standalone" || manifest.id!=="./") {
    throw Error("PWA manifest's relative app scope changed");
  }
  for(const entry of manifest.icons??[]){
    if(typeof entry.src!=="string"||!entry.src.startsWith("./"))throw Error("PWA icon paths changed");
  }
}
function verifyWorker(text) {
  if(!text.includes('request.mode ===') || !text.includes('"navigate"') ||
    !text.includes('"no-store"') || !text.includes("self.skipWaiting()")) {
    throw Error("PWA network-first navigation guard missing");
  }
}
export function verifyStatic(files) {
  if(FILES.some(f=>!Buffer.isBuffer(files[f])))throw Error("Missing static asset");
  verifyHtml(files["index.html"].toString("utf8"));
  verifyManifest(files["manifest.webmanifest"].toString("utf8"));
  verifyWorker(files["service-worker.js"].toString("utf8"));
  return Object.fromEntries(FILES.map(name=>[name,sha(files[name])]));
}
function safeURL(base,name) {
  const url=new URL(name==="index.html"?"":name,base);
  if(url.protocol!=="https:" || !url.href.startsWith(base)) throw Error("Site URL is not authorized");
  return url;
}
export async function readHost(base,load) {
  if(!Object.values(HOSTS).includes(base)) throw Error("Unapproved site URL");
  const result={};
  for(const name of FILES) {
    const url=safeURL(base,name);
    const response=await load(url.href);
    if(response.status!==200)throw Error(name+": response is not HTTP 200");
    const final=new URL(response.url||url.href);
    if(final.protocol!=="https:" || final.origin!==url.origin ||
      final.pathname!==url.pathname)throw Error(name+": unexpected redirect");
    if(name==="index.html"){
      const contentType=response.headers?.get?.("content-type")||"";
      if(!contentType.toLowerCase().includes("text/html"))
        throw Error("App HTML content-type mismatch");
    }
    const contentLength=Number(response.headers?.get?.("content-length")||"0");
    if(contentLength>1_500_000)throw Error(name+": unexpected response size");
    const buffer=Buffer.from(await response.arrayBuffer());
    if(!buffer.length || buffer.length>1_500_000)throw Error(name+": invalid payload size");
    result[name]=buffer;
  }
  return result;
}
export async function audit({load=globalThis.fetch,readLocal=async name=>readFile(path.join(DIR,name))}={}){
  const local={};
  for(const name of FILES)local[name]=await readLocal(name);
  const want=verifyStatic(local);
  const perHost={};
  for(const [kind,host] of Object.entries(HOSTS)){
    const remote=await readHost(host,load);
    const digest=verifyStatic(remote);
    const mismatches=FILES.filter(name=>digest[name]!==want[name]);
    if(mismatches.length)throw Error(kind+": published artifacts differ from repository: "+mismatches.join(", "));
    perHost[kind]=digest;
  }
  return {assetCount:FILES.length,digest:want["index.html"]};
}
// Remote-only checks protect the LIVE site while main is intentionally ahead of
// production under a manual release policy. They cannot prove version parity.
export async function auditPublished({load=globalThis.fetch}={}){
  const remote=await readHost(HOSTS.company,load);
  const digests=verifyStatic(remote);
  return {assetCount:FILES.length,digest:digests["index.html"]};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const check=process.env.NICO_CHECK_MODE==="parity"?audit:auditPublished;
  check({load:(url)=>fetch(url,{method:"GET",redirect:"manual",cache:"no-store",
    headers:{"User-Agent":"nico-sales-readonly-health/1.0"},
    signal:AbortSignal.timeout(20000)})}).then(({assetCount,digest})=>{
      console.log("PASS: canonical NICO URL serves the expected application contract.");
      console.log("PASS: Firebase project and PWA contracts match; checked "+assetCount+" static assets.");\n      console.log("CHECK MODE: "+(process.env.NICO_CHECK_MODE==="parity"?"strict main/publication parity":"published site health only"));
      console.log("Production HTML SHA-256: "+digest);
      console.log("READ-ONLY: no login, Firestore, user data, paid services or deployment touched.");
      console.log("LIMITATION: cannot prove login, role-specific security or current Firestore document integrity.");
    }).catch(err=>{
      console.error("BLOCK: canonical NICO readiness failed: "+String(err?.message||err));
      process.exitCode=1;
    });
}
