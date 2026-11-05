"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {readVisibleRankingGroups,addAutomaticPublishedGroups,MAX_VISIBLE_GROUPS}=
 require("../functions-partner-workspace/automatic-published-groups.cjs");
const {projectMasterProducts}=require("../functions-partner-workspace/catalog-publication.cjs");

test("newly added active products default OFF and become individually rankable only after explicit ON",()=>{
 const master=[
  {id:"fiberNew",name:"新商材A",active:true,sortOrder:1,unitPrice:888888,revenue:222222},
  {id:"old",name:"既存販売終了",active:false,sortOrder:2,unitPrice:777777}
 ];
 const hidden=projectMasterProducts(master,[],true);
 assert.deepEqual(hidden,[]);
 const published=projectMasterProducts(master,["fiberNew","old"],true);
 assert.deepEqual(published.map(p=>p.id),["fiberNew"]);
 const groups=addAutomaticPublishedGroups([],published,[]);
 assert.equal(groups.length,1);
 assert.equal(groups[0].name,"新商材A");
 assert.deepEqual(groups[0].keys,["id:fiberNew"]);
 assert.match(groups[0].id,/^auto_[a-f0-9]{32}$/);
 assert.doesNotMatch(JSON.stringify(groups),/888888|777777|222222|unitPrice|revenue/);
 assert.deepEqual(addAutomaticPublishedGroups([],published,[]),groups,"IDs must be stable");
 assert.deepEqual(addAutomaticPublishedGroups([],[],[]),[]);
});

test("Owner-saved groups always win; newly published unlinked product fills only an unrepresented slot",()=>{
 const original={revision:1,groups:[
  {id:"existing",name:"既存合算",keys:["legacy:NURO","id:fiberNew"]}
 ]};
 const selected=readVisibleRankingGroups(original,["fiberNew","electricNew"],["NURO"]);
 const before=structuredClone(original);
 const rows=[{id:"fiberNew",name:"新商材A"},{id:"electricNew",name:"新商材B"}];
 const combined=addAutomaticPublishedGroups(selected.groups,rows,[]);
 assert.equal(combined.length,2);
 assert.equal(combined[0].id,"existing");
 assert.deepEqual(combined[1].keys,["id:electricNew"]);
 assert.deepEqual(original,before,"ranking group config is read-only");
 // A product linked to an original 9-category bucket must never enter
 // the extra-product ranking again (legacy/category duplication).
 assert.equal(addAutomaticPublishedGroups([],rows,["fiberNew"]).length,1);
 assert.deepEqual(addAutomaticPublishedGroups([],rows,["fiberNew"])[0].keys,["id:electricNew"]);
});

test("OFF hides stale manual groups but never edits their original configuration",()=>{
 const stored={revision:6,groups:[
  {id:"secret",name:"旧公開商材グループ",keys:["id:legacyProduct"]},
  {id:"nuro",name:"NURO",keys:["legacy:NURO"]},
  {id:"mixed",name:"一部非公開",keys:["legacy:NURO","id:legacyProduct"]}
 ]};
 // Global duplicate-key validation forbids a real document from assigning
 // a key to two groups. Use valid independent groups instead.
 stored.groups[2].keys=["legacy:U-NEXT","id:hiddenSecond"];
 const before=structuredClone(stored);
 const off=readVisibleRankingGroups(stored,[],["NURO","U-NEXT"]);
 assert.deepEqual(off.groups.map(x=>x.id),["nuro"]);
 assert.doesNotMatch(JSON.stringify(off),/secret|旧公開商材グループ|legacyProduct|hiddenSecond|一部非公開/);
 assert.deepEqual(stored,before);
 const restored=readVisibleRankingGroups(stored,["legacyProduct","hiddenSecond"],["NURO","U-NEXT"]);
 assert.deepEqual(restored.groups.map(x=>x.id),["secret","nuro","mixed"]);
});

test("identically named products remain different IDs with separate rank cards",()=>{
 const rows=[{id:"productA",name:"新電力"},{id:"productB",name:"新電力"}];
 const groups=addAutomaticPublishedGroups([],rows,[]);
 assert.equal(groups.length,2);
 assert.notEqual(groups[0].id,groups[1].id);
 assert.deepEqual(groups.map(x=>x.keys[0]),["id:productA","id:productB"]);
});

test("malformed, duplicate and excess products never create silent partial ranks",()=>{
 assert.throws(()=>addAutomaticPublishedGroups([],[{id:"a",name:"新商材"},{id:"a",name:"新商材"}],[]),/UNVERIFIED/);
 assert.throws(()=>addAutomaticPublishedGroups([],[{id:"constructor",name:"新商材"}],[]),/UNVERIFIED/);
 assert.throws(()=>addAutomaticPublishedGroups([],[{id:"unsafe",name:"単価20万円"}],[]),/UNVERIFIED/);
 const many=Array.from({length:MAX_VISIBLE_GROUPS+1},(_,i)=>({id:"p"+i,name:"商材"+i}));
 assert.throws(()=>addAutomaticPublishedGroups([],many,[]),/UNVERIFIED/);
 assert.throws(()=>readVisibleRankingGroups({revision:1,groups:[{
  id:"a",name:"混入",keys:["id:__proto__"]
 }]},[],["NURO"]),/UNVERIFIED/);
});

test("same existing ranking and two-column UI are retained: no new finance dashboard",()=>{
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 const source=fs.readFileSync(require.resolve("../functions-partner-workspace/service.cjs"),"utf8");
 assert.match(html,/id="productRankingProductList"/);
 assert.match(html,/id="productRankingMemberList"/);
 assert.match(html,/id="pInlineExtraFields" class="product-input-list"/);
 assert.match(html,/id="pInlineCountFields" class="product-input-list"/);
 assert.match(source,/projectExtraRankDocs/);
 assert.match(source,/async function activePublishedProducts\(/);
 assert.match(source,/addAutomaticPublishedGroups\(/);
 assert.match(source,/groupStandings=groupPersonalScores\(/);
});
