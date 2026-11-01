import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectPartnerPublicAuth,parsePartnerAuthSurface} from "../tools/production/inspect-partner-public-auth.mjs";

const html=readFileSync(new URL("../partner-invite.html",import.meta.url),"utf8");
const config=parsePartnerAuthSurface(html);
test("public client uses only the reviewed Firebase project and SDK",()=>{
 assert.equal(config.project,"sales-management-cc116");
 assert.match(config.appNumber,/^\d+$/);
 assert.equal(config.domain,"sales-management-cc116.firebaseapp.com");
 assert.match(config.version,/^\d+\.\d+\.\d+$/);
});
test("read-only public auth diagnostics do not submit a password or user email",async()=>{
 const requests=[],logs=[];
 const request=async(url,opts)=>{
  requests.push({url,opts});
  if(url.includes("identitytoolkit"))
   return {ok:true,status:200,json:async()=>({projectId:"sales-management-cc116",authorizedDomains:["nico-factory.web.app"],signIn:{email:{enabled:true}}})};
  return {ok:true,status:200};
 };
 const outcome=await inspectPartnerPublicAuth(html,{request,log:s=>logs.push(s)});
 assert.equal(outcome.publicAssetsVerified,true);
 assert.equal(outcome.authConfigurationVerified,true);
 assert.equal(requests.length,5);
 for(const {url,opts} of requests){
  assert.equal(opts.method,"GET");
  assert(!url.includes("accounts:signInWithPassword"));
  assert(!url.includes("accounts:signUp"));
  assert(!url.includes("email="));
  assert.equal(opts.redirect,"error");
 }
 assert(logs.includes("NICO_AUTHORIZED_DOMAIN=true"));
 assert(logs.includes("EMAIL_PASSWORD_PROVIDER_ENABLED=true"));
 assert(!logs.some(v=>v.includes(config.key)));
});
test("Identity Toolkit numeric project identifier is accepted only if it matches appId",async()=>{
 const logs=[];
 const request=async url=>url.includes("identitytoolkit")?
   {ok:true,status:200,json:async()=>({projectId:config.appNumber,authorizedDomains:["nico-factory.web.app"]})}:
   {ok:true,status:200};
 const result=await inspectPartnerPublicAuth(html,{request,log:v=>logs.push(v)});
 assert.equal(result.publicAssetsVerified,true);
 assert(logs.includes("PUBLIC_AUTH_PROJECT_NUMBER_MATCH=true"));
 const mismatch=await inspectPartnerPublicAuth(html,{request:async url=>url.includes("identitytoolkit")?
   {ok:true,status:200,json:async()=>({projectId:"wrong-project",authorizedDomains:["nico-factory.web.app"]})}:
   {ok:true,status:200},log:()=>{}});
 assert.equal(mismatch.publicAssetsVerified,false);
});
test("unsafe unauthorized domain or missing SDK fails closed without any user lookup",async()=>{
 const request=async url=>url.includes("identitytoolkit")?
  {ok:true,status:200,json:async()=>({authorizedDomains:["other.example"]})}:{ok:true,status:200};
 const outcome=await inspectPartnerPublicAuth(html,{request,log:()=>{}});
 assert.equal(outcome.publicAssetsVerified,false);
 const missingSdk=await inspectPartnerPublicAuth(html,{request:async url=>url.includes("firebase-auth.js")?
  {ok:false,status:404}:{ok:false,status:403},log:()=>{}});
 assert.equal(missingSdk.publicAssetsVerified,false);
});
