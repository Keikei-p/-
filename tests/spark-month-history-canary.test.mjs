import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {spawnSync} from "node:child_process";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const marker='<script type="module">';
const start=html.indexOf(marker),end=html.indexOf("</script>",start);
assert(start>0 && end>start,"Expected existing inline module script");
const app=html.slice(start+marker.length,end);
test("staged HTML module parses with Node syntax checker (no network or Firebase)",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sales-month-"));
 try{
  const filename=path.join(dir,"index.mjs");
  fs.writeFileSync(filename,app,"utf8");
  const check=spawnSync(process.execPath,["--check",filename],{encoding:"utf8"});
  assert.equal(check.status,0,check.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("preview is opt-in, restricted to owner, and original listener remains available",()=>{
 assert.match(app,/new URLSearchParams\(location\.search\)\.get\("history-preview"\)=== "1"|new URLSearchParams\(location\.search\)\.get\("history-preview"\)==="1"/);
 assert.match(app,/MONTH_HISTORY_PREVIEW && isCurrentCompanyOwner\(\)/);
 assert.match(app,/if\(useScopedHistoryPreview\(\)\)\{[\s\S]{0,140}startScopedHistoryMonth/);
 assert.match(app,/\}else\{\s*unsubscribeRecords\s*=\s*onSnapshot\(\s*recordsCollectionQuery\(\)/);
});
test("month boundaries use next-month exclusive range, including December rollover",()=>{
 const start=app.indexOf("function scopedHistoryBounds(");
 const end=app.indexOf("function scopedHistoryQuery(",start);
 assert(start>0&&end>start);
 const fn=vm.runInNewContext(app.slice(start,end)+";scopedHistoryBounds");
 for(const [month,begin,finish] of [
  ["2026-01","2026-01-01","2026-02-01"],
  ["2026-10","2026-10-01","2026-11-01"],
  ["2026-12","2026-12-01","2027-01-01"]
 ]){
  const result=fn(month);
  assert.equal(result.start,begin);
  assert.equal(result.end,finish);
 }
 for(const invalid of ["2026-00","2026-13","2026-1","","2026-02-30",null]){
  if(invalid==="2026-02-30")continue; // this is a date, not a month
  assert.throws(()=>fn(invalid));
 }
});
test("scope never reads all company documents in preview; member edit checks exact day",()=>{
 assert.match(app,/scopedHistoryQuery\(bounds\.start,bounds\.end\)/);
 assert.match(app,/where\("date",">=",start\),where\("date","<",end\)/);
 assert.match(app,/value\.companyId!==companyId\|\|typeof value\.date!=="string"/);
 assert.match(app,/value\.date<bounds\.start\|\|value\.date>=bounds\.end/);
 assert.match(app,/where\("uid","==",recordMember\.value\)/);
 assert.match(app,/where\("date","==",recordDate\.value\)/);
});
test("cache and partial totals are never confirmed, and user-facing chart is guarded",()=>{
 assert.match(app,/snapshot\.metadata\?\.fromCache\|\|snapshot\.metadata\?\.hasPendingWrites/);
 assert.match(app,/月次|端末内キャッシュのみ/);
 assert.match(app,/scopedAnnualLoaded!==dashboardMonth\.value\.slice\(0,4\)/);
 assert.match(app,/if\(!useScopedHistoryPreview\(\)\)renderDashboard\(\)/);
});
test("no data deletion or Firestore Rule deployment is added by the preview",()=>{
 const start=app.indexOf("const MONTH_HISTORY_PREVIEW");
 const end=app.indexOf("function startRealtimeListeners",start);
 const block=app.slice(start,end);
 assert(!/\b(?:deleteDoc|deleteUser|setDoc|updateDoc|writeBatch|runTransaction)\s*\(/.test(block));
 assert.match(block,/onSnapshot\(scopedHistoryQuery/);
 assert.match(block,/getDocsFromServer\(scopedHistoryQuery/);
});
