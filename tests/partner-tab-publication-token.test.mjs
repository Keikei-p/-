import test from "node:test";
import assert from "node:assert/strict";
import {createVerifiedRankTokenReader} from "../functions-partner-tabs/trusted-token-reader.mjs";

const TOKEN="abcdefghijklmnopqrstuvwx1234567890";
const validClaim={uid:"owner1",email:"owner@example.com",email_verified:true};
const validUser={uid:"owner1",email:"owner@example.com",emailVerified:true,disabled:false};
const denied=fn=>assert.rejects(fn,/PARTNER_TABS_IDENTITY_NOT_VERIFIED/);
function authWith(claim=validClaim,user=validUser,throwToken=false){
 const calls={revocationChecks:[],userReads:[]};
 const auth={
  async verifyIdToken(token,checkRevoked){
   calls.revocationChecks.push([token,checkRevoked]);
   if(throwToken)throw Error("revoked");
   return claim;
  },
  async getUser(uid){calls.userReads.push(uid);return user;}
 };
 return {auth,calls};
}
test("must verify revocation and current Firebase Auth profile every call",async()=>{
 const f=authWith(),read=createVerifiedRankTokenReader({auth:f.auth});
 assert.deepEqual(await read(TOKEN),{uid:"owner1",email:"owner@example.com",emailVerified:true});
 assert.deepEqual(await read(TOKEN),{uid:"owner1",email:"owner@example.com",emailVerified:true});
 assert.deepEqual(f.calls.revocationChecks,[[TOKEN,true],[TOKEN,true]]);
 assert.deepEqual(f.calls.userReads,["owner1","owner1"]);
 assert.equal(Object.isFrozen(await read(TOKEN)),true);
});
test("revoked token, disabled account, unverified address and identity mismatch denied",async()=>{
 for(const [claim,user,revoked] of [
  [validClaim,validUser,true],
  [validClaim,{...validUser,disabled:true},false],
  [{...validClaim,email_verified:false},validUser,false],
  [validClaim,{...validUser,emailVerified:false},false],
  [{...validClaim,uid:"owner2"},validUser,false],
  [{...validClaim,email:"hacker@example.com"},validUser,false],
  [{...validClaim,email:"owner@example.com"}, {...validUser,email:"other@example.com"},false]
 ]){
  const f=authWith(claim,user,revoked);
  await denied(()=>createVerifiedRankTokenReader({auth:f.auth})(TOKEN));
 }
});
test("missing token/Auth client and forged role values are never trusted",async()=>{
 assert.throws(()=>createVerifiedRankTokenReader({auth:{}}),/PARTNER_TABS_IDENTITY_NOT_VERIFIED/);
 const f=authWith();
 const reader=createVerifiedRankTokenReader({auth:f.auth});
 await denied(()=>reader(""));
 await denied(()=>reader("x"));
 assert.equal(f.calls.revocationChecks.length,0);
});
