import test from "node:test";
import assert from "node:assert/strict";
import {inspectPublicLogin} from "../tools/production/nico-live-login-anonymous-audit.mjs";
const reply=(html,status=200)=>({
 status,headers:{get:()=> "text/html;charset=utf-8"},text:async()=>html
});
const shell='<div id="authScreen"></div>onAuthStateChanged( signInWithEmailAndPassword( checkLegacyEntryAgainstServer openSameAppPartnerWorkspace';
test("public pages verify markup, not pretend user login completed",async()=>{
 const paths=[];
 const mock=async url=>{
  paths.push(url);
  if(url.includes("login-self-check.html"))return reply('<form id="loginForm"></form><p id="status"></p> signInWithEmailAndPassword( getDocFromServer(');
  if(url.includes("partner-workspace.html"))return reply('getPartnerWorkspace submitPartnerWorkspaceCounts');
  return reply(shell);
 };
 const v=await inspectPublicLogin({fetcher:mock});
 assert.equal(v.publicLoginShellPresent,true);
 assert.equal(v.pages.selfcheck.dedicated,true);
 assert.equal(v.firebaseUserLoginVerified,false);
 assert.equal(v.partnerLoginVerified,false);
 assert.equal(v.firestoreReads,0);
 assert.equal(v.firestoreWrites,0);
 assert.equal(v.deployments,0);
 assert.equal(paths.length,3);
 assert.ok(paths.every(x=>x.startsWith("https://nico-factory.web.app/")));
});
test("HTTP 200 alone is NOT a usable login screen or dedicated diagnostic",async()=>{
 const v=await inspectPublicLogin({fetcher:async()=>reply("<html>index</html>")});
 assert.equal(v.publicLoginShellPresent,false);
 assert.equal(v.pages.selfcheck.dedicated,false);
});
test("audit rejects redirects to unexpected hosts, no write methods",async()=>{
 await assert.rejects(inspectPublicLogin({root:"https://attacker.example"}),/HOST_DRIFT/);
 const captures=[];
 await inspectPublicLogin({fetcher:async(_,opts)=>{captures.push(opts);return reply(shell)}});
 assert.equal(captures.length,3);
 assert.ok(captures.every(opts=>opts.credentials==="omit"&&!Object.hasOwn(opts,"method")));
});
test("network failures are reported, not treated as successful login",async()=>{
 const v=await inspectPublicLogin({fetcher:async url=>{
  if(url.includes("audit")&&url.includes("-home"))throw Object.assign(Error("timeout"),{name:"TimeoutError"});
  return reply(shell);
 }});
 assert.equal(v.publicLoginShellPresent,false);
 assert.equal(v.pages.home.reachable,false);
 assert.equal(v.pages.home.error,"TimeoutError");
});
