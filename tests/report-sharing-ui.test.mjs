import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const start=html.indexOf("function normalizeNotificationSettings(");
const end=html.indexOf("async function loadNotificationSettings()",start);
if(start<0||end<0)throw Error("Missing existing notification settings function");
const context=vm.createContext({});
const normalize=vm.runInContext(html.slice(start,end)+"\n normalizeNotificationSettings;",context);
test("notification settings keep both consent grants and partner team selection",()=>{
 const original={
  enabled:true,weekdays:[1,2,3],lineEnabled:true,lineGroupId:"G",
  aggregatePartnerReports:true,linkedCompanyIds:["partnerCo"],
  partnerTeamIds:["teamPartner"],linkedHubCompanyId:"parentCo",
  countsShareApproved:true,countsShareLineGroupId:"G2"
 };
 const saved=normalize(original);
 for(const field of ["aggregatePartnerReports","linkedCompanyIds","partnerTeamIds",
   "linkedHubCompanyId","countsShareApproved","countsShareLineGroupId"])
   assert.equal(JSON.stringify(saved[field]),JSON.stringify(original[field]));
 assert.equal(saved.enabled,true);
 assert.equal(saved.lineEnabled,true);
 assert.equal(saved.lineGroupId,"G");
});
test("legacy notification settings cannot implicitly approve cross-company sharing",()=>{
 const saved=normalize({enabled:true,weekdays:[1],lineEnabled:true,lineGroupId:"old"});
 assert.equal(saved.aggregatePartnerReports,false);
 assert.deepEqual(Array.from(saved.linkedCompanyIds),[]);
 assert.deepEqual(Array.from(saved.partnerTeamIds),[]);
 assert.equal(saved.countsShareApproved,false);
 assert.equal(saved.linkedHubCompanyId,"");
 assert.equal(saved.countsShareLineGroupId,"");
});
test("all approval controls exist once and are owner-only",()=>{
 for(const id of [
  "notificationSharingSection","notificationPartnerTeamOptions",
  "notificationAggregatePartnerReports","notificationLinkedCompanyIds",
  "notificationCountsShareApproved","notificationLinkedHubCompanyId",
  "notificationCountsShareLineGroupId"
 ]){
  assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert(html.includes('document.getElementById("'+id+'")'),id);
 }
 assert(html.includes("notificationSharingSection.hidden = !canEdit"));
 assert(html.includes("if (\n      !isCurrentCompanyOwner()\n    )"));
 assert(html.includes("merge: true"),"old settings and paired LINE values must not be overwritten");
 assert(html.includes("new Set(splitCompanyIds).size !== splitCompanyIds.length"));
});
