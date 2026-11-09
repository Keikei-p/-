import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 classifyOwnerWorkspaceError
} from "../staging/partner-owner-correction-v3/mobile-bootstrap.mjs";
import {REVIEWED,prepareHubPortal}
 from "../tools/production/prepare-hub-owner-portal-static.mjs";

const cases=[
 ["functions/unauthenticated","AUTH_REQUIRED"],
 ["functions/permission-denied","OWNER_NOT_AUTHORIZED"],
 ["functions/not-found","FUNCTION_UNAVAILABLE"],
 ["functions/unavailable","FUNCTION_UNAVAILABLE"],
 ["functions/resource-exhausted","FUNCTION_UNAVAILABLE"],
 ["functions/internal","FUNCTION_UNAVAILABLE"],
 ["functions/deadline-exceeded","NETWORK_ERROR"],
 ["auth/network-request-failed","NETWORK_ERROR"]
];
test("Firebase callable failures are classified without guessing a missing partner relation",()=>{
 for(const [firebaseCode,expected] of cases){
  const got=classifyOwnerWorkspaceError({
   code:firebaseCode,message:"confidential backend exception"
  });
  assert.equal(got.code,expected,firebaseCode);
  assert(!JSON.stringify(got).includes("confidential"),firebaseCode);
  assert(Object.isFrozen(got));
 }
});
test("partner relation missing is shown ONLY when the backend explicitly uses a fixed safe code",()=>{
 assert.equal(classifyOwnerWorkspaceError({
  code:"functions/permission-denied",
  details:{publicCode:"PARTNER_RELATION_MISSING",email:"sensitive@example.com"}
 }).code,"PARTNER_RELATION_MISSING");
 assert.equal(classifyOwnerWorkspaceError({
  code:"functions/permission-denied",message:"PARTNER_RELATION_MISSING"
 }).code,"OWNER_NOT_AUTHORIZED");
});
test("response contract failures are distinct from server and network failures",()=>{
 for(const message of [
  "OWNER_CORRECTION_BOOT_WORKSPACE_UNVERIFIED",
  "OWNER_CORRECTION_BOOT_COMPANY_UNVERIFIED",
  "STALE_OR_UNTRUSTED",
  "INVALID_TEAM_COUNTS",
  "UNVERIFIED_TEAM"
 ])assert.equal(classifyOwnerWorkspaceError({message}).code,"DATA_SHAPE_INVALID");
 assert.equal(classifyOwnerWorkspaceError({message:"private trace"}).code,"FUNCTION_UNAVAILABLE");
});
test("all seven published errors are fixed Japanese text with no private details reflected",()=>{
 const all=[
  "AUTH_REQUIRED","EMAIL_UNVERIFIED","OWNER_NOT_AUTHORIZED",
  "PARTNER_RELATION_MISSING","FUNCTION_UNAVAILABLE","DATA_SHAPE_INVALID","NETWORK_ERROR"
 ];
 for(const kind of all){
  const result=classifyOwnerWorkspaceError({
   details:{publicCode:kind,token:"TOKEN_PRIVATE_UNSAFE"},
   message:"password_ABC secret@example.com 150000円",
   code:"unknown"
  });
  assert.equal(result.code,kind);
  assert(result.message.length>=10);
  assert.doesNotMatch(JSON.stringify(result),/TOKEN_PRIVATE_UNSAFE|password_ABC|secret@example.com|150000/);
 }
});
test("reviewed four-asset portal keeps correction OFF and displays typed errors only after stale-user check",()=>{
 const files=Object.fromEntries(Object.keys(REVIEWED).map(p=>[
  p,readFileSync(new URL("../"+p,import.meta.url),"utf8")
 ]));
 const assets=prepareHubPortal(files);
 assert.equal(Object.keys(assets).length,4);
 const html=assets["owner-partner-admin.html"];
 assert.match(html,/const HUB_OWNER_CORRECTION_READY=false/);
 assert.match(html,/classifyOwnerWorkspaceError\(error\)/);
 assert.match(html,/if\(target!==seq\|\|session!==user\|\|auth.currentUser!==user\)return;/);
 assert.match(html,/if\(seq!==mySeq\|\|auth.currentUser!==current\)return;/);
 assert.doesNotMatch(html,/console\.log\(error|console\.error\(error|setDoc\(|updateDoc\(|deleteDoc\(/);
});
