import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]||html;
test("a partner leader can archive only email-less staff from existing member list",()=>{
 assert.match(html,/id="pInlinePeople"/);
 const start=source.indexOf('const list=pInline("pInlinePeople");list.replaceChildren();');
 const end=source.indexOf('partnerInlineFillSelect("pInlineStaff"',start);
 assert.ok(start>0&&end>start);
 const list=source.slice(start,end);
 assert.match(list,/if\(canManage&&person\.kind==="managed"\)/);
 assert.match(list,/remove\.onclick=\(\)=>void partnerInlineRemoveManagedStaff\(person\.id,person\.name\)/);
 assert.match(list,/remove\.textContent="班員を削除"/);
 assert.doesNotMatch(list,/deleteDoc|setDoc|removeUser|auth\.delete/);
});
test("confirmation and unsaved protection before any backend write",()=>{
 const start=source.indexOf("async function partnerInlineRemoveManagedStaff(");
 const end=source.indexOf('pInline("pInlineAddManaged").onclick',start);
 assert.ok(start>0&&end>start);
 const fn=source.slice(start,end);
 for(const term of [
  '!["owner","leader"].includes(snap.role)',
  'person.kind!=="managed"',
  'person.uid!=null',
  'window.confirm(',
  'partnerInlineHasUnsavedCounts()',
  'action:"removeManaged",staffId',
  'result?.archived!==true'
 ]) assert.ok(fn.includes(term),term);
 assert.ok(fn.indexOf('window.confirm(')<fn.indexOf('partnerInlineManage('));
 assert.equal(fn.split('partnerInlineManage(').length-1,1);
});
test("existing finance, rank, history, save and authentication never replaced",()=>{
 for(const match of [/monthlyRevenue/,/signInWithEmailAndPassword/,
  /partnerInlineOpenHistoryCorrection/,/loadSharedDailyStandings/,
  /submitPartnerWorkspaceCounts/,/partnerSavedCountReadbackState/,
  /privateCounts:wirePrivateCounts/,/pInlineWorkLocation/])
  assert.match(html,match);
});
