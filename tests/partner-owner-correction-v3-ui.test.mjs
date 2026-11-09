import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 COUNT_KEYS,SB_PARTS,verifiedCount,normalizedSplit,
 correctionPayload,verifyCorrectionReadback,mountOwnerCorrection
} from '../staging/partner-owner-correction-v3/owner-ui.mjs';

const zeros=()=>Object.fromEntries(COUNT_KEYS.map(k=>[k,0]));
const date="2026-10-31",partnerCompanyId="partner";
const previous=()=>({
 staffId:"s1",staffName:"担当者",version:2,
 counts:{...zeros(),"SB光・AIR":5,NURO:2},totalCount:7,
 sbBreakdown:{"SB光":0,"SB AIR":0,"旧未分類":5}
});
const base=()=>({
 date,partnerCompanyId,previous:previous(),
 draftCounts:{...previous().counts,NURO:3},
 draftSb:{"SB光":2,"SB AIR":2,"旧未分類":1},
 correctionReason:"確認済みのSB光とAIRを訂正"
});
test('older combined count 5 stays explicitly unclassified, no auto allocation',()=>{
 assert.deepEqual(normalizedSplit(5,undefined),{
  "SB光":0,"SB AIR":0,"旧未分類":5});
 assert.deepEqual(normalizedSplit(5,{"SB光":2,"SB AIR":1,"旧未分類":2}),
  {"SB光":2,"SB AIR":1,"旧未分類":2});
 assert.throws(()=>normalizedSplit(5,{"SB光":3,"SB AIR":3,"旧未分類":0}),
  /SB_SPLIT_MISMATCH/);
});
test('build payload: exact count schema, version, target and explicit reason; no finance fields',()=>{
 const result=correctionPayload(base());
 assert.equal(result.expectedVersion,2);
 assert.equal(result.date,date);
 assert.equal(result.partnerCompanyId,partnerCompanyId);
 assert.equal(result.staffId,"s1");
 assert.equal(result.counts.NURO,3);
 assert.deepEqual(result.sbBreakdown,{"SB光":2,"SB AIR":2,"旧未分類":1});
 assert.equal(Object.keys(result).sort().join("|"),
  "correctionReason|counts|date|expectedVersion|partnerCompanyId|sbBreakdown|staffId");
 assert.doesNotMatch(JSON.stringify(result),/totalRevenue|privateCounts|revenuePerUnit|cashbackOptions/);
});
test('stale, missing, negative, decimal and out-of-range counts cannot form a request',()=>{
 for(const value of ["", "-1","1.3","010","10000","Infinity","1e3",null,{},-1,10000]){
  assert.throws(()=>verifiedCount(value));
  assert.throws(()=>correctionPayload({...base(),draftCounts:{
   ...base().draftCounts,NURO:value}}));
 }
 for(const malformed of [
  {...base(),partnerCompanyId:"../other"},
  {...base(),previous:{...previous(),version:0}},
  {...base(),draftCounts:{...base().draftCounts,unitPrice:100}},
  {...base(),draftSb:{"SB光":6,"SB AIR":0,"旧未分類":0}},
  {...base(),correctionReason:"短い"},
  {...base(),correctionReason:"売上5万円を増額"},
  {...base(),correctionReason:"本来はNURO\n新規"}
 ])assert.throws(()=>correctionPayload(malformed));
 const noChange={...base(),draftCounts:previous().counts,
  draftSb:previous().sbBreakdown};
 assert.throws(()=>correctionPayload(noChange),/NO_CHANGES/);
});
test('save success needs precise owner scope, version, count checksum and SB readback',()=>{
 const r=correctionPayload(base());
 const saved={saved:true,scope:"hub-owner-existing-only",
  partnerCompanyId,staffId:"s1",date,version:3,totalCount:8};
 const current={role:"hub",scope:"existing-partner-counts-only",
  partnerCompanyId,date,entries:[{...previous(),version:3,
   counts:r.counts,totalCount:8,sbBreakdown:r.sbBreakdown}]};
 assert.equal(verifyCorrectionReadback(saved,r,current),true);
 for(const invalid of [
  {saved:{...saved,version:4},current},
  {saved,current:{...current,role:"partner"}},
  {saved,current:{...current,entries:[{...current.entries[0],version:2}]}},
  {saved,current:{...current,entries:[{...current.entries[0],totalCount:7}]}},
  {saved,current:{...current,entries:[{...current.entries[0],
    sbBreakdown:{"SB光":3,"SB AIR":1,"旧未分類":1}}]}},
  {saved,current:{...current,entries:[]}}
 ])assert.equal(verifyCorrectionReadback(invalid.saved,r,invalid.current),false);
});
class FakeElement{
 constructor(tag){this.tag=tag;this.children=[];this.value="";this.hidden=false;
  this.disabled=false;this.attrs={};this.listeners={};this.style={};this.textContent="";}
 append(...nodes){
  this.children.push(...nodes);
  if(this.tag==="select"&&nodes.length&&this.value===""){
   const first=nodes.find(n=>n.tag==="option");
   if(first)this.value=first.value;
  }
 }
 replaceChildren(...nodes){this.children=[];this.value="";this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(name,fn){this.listeners[name]=fn;}
}
function ui(){
 const dom={createElement:tag=>new FakeElement(tag)},root=new FakeElement("div");
 const requested=[],updates=[],confirmations=[];
 let currentDate=date,latest=null,denyReadback=false;
 const api={
  list:async input=>{
   requested.push(input);
   if(denyReadback&&updates.length)throw Error("NETWORK");
   return latest||{
    role:"hub",scope:"existing-partner-counts-only",
    partnerCompanyId,date,entries:[previous()]};
  },
  correct:async request=>{
   updates.push(request);
   latest={role:"hub",scope:"existing-partner-counts-only",
    partnerCompanyId,date,entries:[{
     ...previous(),version:request.expectedVersion+1,
     counts:request.counts,totalCount:Object.values(request.counts).reduce((a,b)=>a+b,0),
     sbBreakdown:request.sbBreakdown
    }]};
   return {saved:true,scope:"hub-owner-existing-only",partnerCompanyId,
    staffId:request.staffId,date,version:request.expectedVersion+1};
  }
 };
 const mounted=mountOwnerCorrection({
  root,dom,companies:[{name:"協力店A",partnerCompanyId,active:true},
   {name:"悪意の無効店",partnerCompanyId:"disabled",active:false}],
  api,dateGetter:()=>currentDate,
  confirmChange:text=>{confirmations.push(text);return true;}
 });
 const wrap=root.children[0],editor=wrap.children[5];
 return {
  mounted,root,wrap,editor,requested,updates,confirmations,
  company:wrap.children[3],status:wrap.children[6],
  staff:editor.children[1],fields:editor.children[2],
  sbFields:editor.children[4],reason:editor.children[6],
  setDate:d=>{currentDate=d;},denyReadback:()=>{denyReadback=true;}
 };
}
test('mobile owner controls: select company -> select staff -> correct -> readback success',async()=>{
 const x=ui();
 assert.equal(x.wrap.children[0].textContent,"協力店の件数を訂正（自社オーナー専用）");
 assert.equal(x.company.children.length,2,"inactive company hidden");
 x.company.value=partnerCompanyId;
 await x.mounted.load();
 assert.equal(x.editor.hidden,false);
 assert.equal(x.staff.value,"s1");
 assert.equal(x.fields.children.length,COUNT_KEYS.length);
 assert.equal(x.sbFields.children.length,SB_PARTS.length);
 x.fields.children.find(y=>y.textContent==="NURO").children[0].value="3";
 for(const p of SB_PARTS)
  x.sbFields.children.find(y=>y.textContent===p).children[0].value=
   p==="SB光"?"2":p==="SB AIR"?"2":"1";
 x.reason.value="担当者に確認済みの分類を訂正";
 await x.mounted.save();
 assert.equal(x.updates.length,1);
 assert.equal(x.updates[0].expectedVersion,2);
 assert.equal(x.requested.length,2);
 assert.match(x.status.textContent,/保存・再照合完了：第3版/);
 assert.equal(x.reason.value,"");
 assert.match(x.confirmations[0],/変更後合計：8件/);
 assert.doesNotMatch(JSON.stringify(x.updates),/privateCounts|revenue|price|cashback/i);
});
test('readback network error never retries writes or advertises saved result',async()=>{
 const x=ui();x.company.value=partnerCompanyId;await x.mounted.load();
 x.fields.children.find(y=>y.textContent==="NURO").children[0].value="3";
 x.reason.value="担当者に確認したNUROの数を訂正";
 x.denyReadback();await x.mounted.save();
 assert.equal(x.updates.length,1);
 assert.match(x.status.textContent,/二重登録防止/);
 assert.equal(x.editor.hidden,true);
});
test('changing company or date invalidates stale selection; destroyed panel clears UI',async()=>{
 const x=ui();x.company.value=partnerCompanyId;await x.mounted.load();
 x.setDate("2026-11-01");
 x.fields.children.find(y=>y.textContent==="NURO").children[0].value="3";
 x.reason.value="日付が変わったため修正不可";
 await x.mounted.save();
 assert.equal(x.updates.length,0);
 assert.match(x.status.textContent,/再取得してください/);
 x.mounted.destroy();assert.equal(x.root.children.length,0);
});

test('staged owner UI never reads Firestore, leaks money or persists auth',()=>{
 const file=readFileSync(new URL('../staging/partner-owner-correction-v3/owner-ui.mjs',import.meta.url),'utf8');
 assert.match(file,/STAGING ONLY/);
 assert.doesNotMatch(file,/getFirestore|firebase-firestore|localStorage|sessionStorage|document\.cookie/);
 assert.doesNotMatch(file,/innerHTML|outerHTML|insertAdjacentHTML/);
 assert.doesNotMatch(file,/firebase deploy|collection\("records"\)/);
});

test('one-tap hub company choice opens existing saved staff without another sign-in',async()=>{
 const x=ui();
 await x.mounted.openCompany(partnerCompanyId);
 assert.deepEqual(x.requested,[{date,partnerCompanyId}]);
 assert.equal(x.company.value,partnerCompanyId);
 assert.equal(x.editor.hidden,false);
 assert.equal(x.staff.value,"s1");
 assert.equal(x.updates.length,0,"a company switch must never mutate counts");
});
test('one-tap hub choice cannot select an unapproved or another company',async()=>{
 const x=ui();
 for(const company of ["disabled","../foreign","other"])
  await assert.rejects(x.mounted.openCompany(company),/UNAVAILABLE_PARTNER_COMPANY/);
 assert.equal(x.requested.length,0);
 assert.equal(x.updates.length,0);
 x.mounted.destroy();
 await assert.rejects(x.mounted.openCompany(partnerCompanyId),
  /UNAVAILABLE_PARTNER_COMPANY/);
});
