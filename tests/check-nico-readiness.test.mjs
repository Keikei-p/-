import {test} from "node:test";
import assert from "node:assert/strict";
import {HOSTS,FILES,audit,verifyStatic,readHost} from "../scripts/check-nico-readiness.mjs";

const fixture={
  "index.html":Buffer.from('<title>営業実績管理</title> projectId: "sales-management-cc116" authDomain: "sales-management-cc116.firebaseapp.com" signInWithEmailAndPassword recordCorrections canCurrentUserCorrectRecord service-worker.js manifest.webmanifest getFirestore(app)'),
  "manifest.webmanifest":Buffer.from(JSON.stringify({id:"./",start_url:"./",scope:"./",display:"standalone",icons:[{src:"./icon-192.png"}]})),
  "service-worker.js":Buffer.from('request.mode === "navigate"; fetch("no-store"); self.skipWaiting()'),
  "icon-180.png":Buffer.from([137,80,78,71,1]),
  "icon-192.png":Buffer.from([137,80,78,71,2]),
  "icon-512.png":Buffer.from([137,80,78,71,3])
};
const locals=async name=>fixture[name];
function fetcher(override={}){
  return async url=>{
    const u=new URL(url);
    const name=u.pathname.endsWith("/")?"index.html":u.pathname.split("/").pop();
    let bytes=override[name]??fixture[name];
    return {
      status:200,url,
      headers:new Map([["content-type",name==="index.html"?"text/html":"application/octet-stream"],["content-length",String(bytes.length)]]),
      arrayBuffer:async()=>bytes
    };
  };
}
test("all required files and both pinned origins",()=>{
  assert.deepEqual(Object.keys(HOSTS),["company","legacy"]);
  assert.equal(FILES.length,6);
  assert.equal(Object.keys(verifyStatic(fixture)).length,6);
});
test("both hosts exactly matching source passes",async()=>{
  const result=await audit({load:fetcher(),readLocal:locals});
  assert.equal(result.assetCount,6);
  assert.equal(result.digest.length,64);
});
test("changed HTML or icons blocks",async()=>{
  await assert.rejects(audit({
    load:fetcher({"index.html":Buffer.from("outdated deployment")}),readLocal:locals
  }),/contract/);
  await assert.rejects(audit({
    load:fetcher({"icon-192.png":Buffer.from("altered")}),readLocal:locals
  }),/differ from repository/);
});
test("non-200 responses, redirects and changed PWA scope block",async()=>{
  await assert.rejects(readHost(HOSTS.company,async url=>({...await fetcher()(url),status:404})),/HTTP 200/);
  await assert.rejects(readHost(HOSTS.company,async url=>({...await fetcher()(url),url:"https://evil.test/"})),/unexpected redirect/);
  await assert.rejects(audit({
    load:fetcher({"manifest.webmanifest":Buffer.from('{"id":"./","start_url":"/other","scope":"./","display":"standalone"}')}),
    readLocal:locals
  }),/scope changed/);
});
test("unauthorized URL blocks before any request",async()=>{
  let invoked=false;
  await assert.rejects(readHost("https://untrusted.test/",async()=>{invoked=true;}),/Unapproved/);
  assert.equal(invoked,false);
});
