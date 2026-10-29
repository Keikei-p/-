import test from "node:test";
import assert from "node:assert/strict";
import {collectFirestoreMemberPages,safePartnerMembers} from "../src/index.js";
const company="partnerCompany";
function doc(i){
 const uid="user"+String(i).padStart(3,"0");
 return {name:"projects/dummy/databases/(default)/documents/companies/"+company+"/members/"+uid,
   fields:{uid:{stringValue:uid},companyId:{stringValue:company},
     teamId:{stringValue:i%2===0?"A":"B"},active:{booleanValue:true},
     name:{stringValue:"社員"+i}}};
}
test("Partner roster spans multiple Firestore pages without exposing other team",async()=>{
 const docs=Array.from({length:901},(_,i)=>doc(i));
 const urls=[];
 const all=await collectFirestoreMemberPages(async token=>{
  urls.push(token);
  return token===""?{documents:docs.slice(0,500),nextPageToken:"after-500"}:
    {documents:docs.slice(500)};
 });
 assert.equal(all.length,901);
 assert.deepEqual(urls,["","after-500"]);
 const partner=safePartnerMembers(all,{isPartner:true,teamId:"A",companyId:company});
 assert.equal(partner.length,451);
 assert(partner.every(m=>m.teamId==="A"&&m.uid&&m.name));
 assert(!partner.some(m=>m.teamId==="B"));
 assert(!partner.some(m=>Object.prototype.hasOwnProperty.call(m,"canViewRevenue")));
});
test("Pagination fails closed for duplicated documents or page tokens",async()=>{
 await assert.rejects(collectFirestoreMemberPages(async token=>({
  documents:[doc(1)],nextPageToken:token||"replay"})),/members_duplicated_page/);
 await assert.rejects(collectFirestoreMemberPages(async token=>({
  documents:[doc(token?2:1)],nextPageToken:"same"})),/members_invalid_page_token/);
 await assert.rejects(collectFirestoreMemberPages(async()=>({documents:"malformed"})),/members_invalid_page/);
});
test("Pagination preserves 0 results without guessing membership",async()=>{
 const data=await collectFirestoreMemberPages(async()=>({}));
 assert.deepEqual(data,[]);
});
