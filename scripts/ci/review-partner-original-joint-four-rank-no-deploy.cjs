"use strict";
/**
 * NO DEPLOY. Additional exact-source review for the existing original partner
 * four ranking cards only. Never revises historic release pins or Auth.
 * A reviewer must compare these hashes with the actual GitHub main sources.
 */
const fs=require("node:fs");
const crypto=require("node:crypto");
const pins=Object.freeze({
 "partner-workspace.html":"1ea7e1a26702681294ec999c7b36a8f10b880aa2",
 "sales-archive.js":"480640ebea66a7cc2aa820cbc1fa9b982d835875",
 "index.html":"5edde6d5e5459ba283d12d157c021d4eee03d587",
 "firestore.rules":"d9f4df6a2ac0f8b5720534a2461ec66b94379190",
 "functions/index.js":"dfb4c48ada6fa89a24c898cd4a2f911bcede822f",
 "functions-partner-workspace/index.js":"90d51246477cf5cfa6966f3e822326ef06cccd0f",
 "functions-partner-workspace/service.cjs":"614f3216e008642ddf5eda6b93c35cc0469557c3",
 "functions-partner-workspace/submission-publication-guard.cjs":"a56ae6100ce70602ed90233af038549129941cd9"
});
const stop=()=>{throw Error("STOP_PARTNER_RANK_ORIGINAL_SOURCE_CHANGED")};
const blob=bytes=>crypto.createHash("sha1")
 .update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
for(const [file,digest]of Object.entries(pins)){
 if(blob(fs.readFileSync(file))!==digest)stop();
}
const page=fs.readFileSync("partner-workspace.html","utf8");
const owner=fs.readFileSync("sales-archive.js","utf8");
for(const x of [
 "const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;",
 "const NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED=false;",
 "const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;",
 "if(NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||",
 "expectedRole:\"partner_owner\"",
 "refreshVerifiedJointInlineForPartner({gen,uid,day,today,dates})",
 "renderVerifiedInlineJointCards({"
 ])if(!page.includes(x))stop();
for(const x of [
 "const NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=false;",
 "const NICO_INTERNAL_JOINT_COUNT_MONTH_RELEASED=false;"
 ])if(!owner.includes(x))stop();
for(const x of ["function refresh(){","const setLoginMode=",
 "async function action(task){","$(\"save\").onclick=()=>action(async()=>{",
 "await refresh();"] )if(!page.includes(x))stop();
if(/NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=true|NICO_OWNER_INLINE_JOINT_CARDS_RELEASED=true/.test(page+"\n"+owner))stop();
console.log("PARTNER_FOUR_RANK_ORIGINAL_REVIEWED_NO_DEPLOY");
