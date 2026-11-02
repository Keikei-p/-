import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const backend=readFileSync(new URL("../functions-partner-workspace/service.cjs",import.meta.url),"utf8");
function between(source,a,b){
 const i=source.indexOf(a),j=source.indexOf(b,i);
 assert.ok(i>=0&&j>i,"missing source "+a);
 return source.slice(i,j);
}
test("first-time and secondary partner logins retain password flow and use verified company context",()=>{
 const auth=between(html,"// Only an opaque company ID","function partnerMainPendingInvite(){");
 for(const item of ["nico-partner-workspace:","localStorage.setItem","localStorage.getItem",
  "localStorage.removeItem","partnerMainValidId(cid)"])
  assert.ok(auth.includes(item),item);
 const callback=between(html,'pInline("pMainAcceptInvite").onclick=async()=>','// Partner onboarding: email is verified');
 assert.match(callback,/rememberPartnerWorkspace\(user.uid,result.partnerCompanyId\)/);
 const routing=between(html,"onAuthStateChanged(","/\* =====================================================\n   ユーザー情報読み込み");
 assert.match(routing,/const partnerWorkspaceId=explicitPartnerWorkspace\|\|rememberedPartnerWorkspace\(user.uid\)/);
 assert.match(routing,/await openSameAppPartnerWorkspace\(user,partnerWorkspaceId\)/);
 assert.match(html,/await signInWithEmailAndPassword\(/);
 const api=between(html,'pInline("pInlineReturnToOwnCompany").onclick=','async function partnerInlineRun(work){');
 assert.match(api,/clearRememberedPartnerWorkspace\(uid\)/);
 assert.match(api,/location.replace\(new URL\("\/",location.origin\)\.href\)/);
 assert.doesNotMatch(auth,/partnerStaffInvite|email\s*:/);
});
test("NURO CB tier inputs preserve old counts as unclassified; never invent CB0",()=>{
 const source=between(html,"const PARTNER_NURO_CB_TIERS=","function partnerInlineHasUnsavedCounts(){");
 const cb=Object.create(null),ctx={};
 runInNewContext(source.replace(/^\/\/.*$/gm,"")+"\nthis.result=partnerUiCbCountSnapshot({counts:{NURO:5}})",ctx);
 assert.equal(ctx.result.unclassified,5);
 assert.equal(ctx.result["0"],0);
 for(const tier of ["0","20000","40000","60000","80000","unclassified"])
  assert.ok(source.includes(tier),tier);
 assert.match(html,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(html,/dataset.cbTier=tier/);
 assert.match(html,/card.className="p-inline-field product-input-group product-input-group--compact partner-cb-card"/);
});
test("count-only CB saves use total validation, versioned audit, and no sales source",()=>{
 for(const marker of [
  "const PARTNER_CB_OPTIONS=",
  "const validateCbCounts=(raw,counts)=>",
  "if(sum!==counts.NURO)fail",
  "const cbCounts=validateCbCounts(x.cbCounts,counts)",
  "const requestedCb=Object.hasOwn(d,\"cbCounts\")",
  "const oldCb=oldSnap.exists?validateCbCounts(old.cbCounts,priorCounts):null",
  "cbCounts:nextCb",
  "previousCbCounts:oldCb",
  "tx.update(summary,sum)",
 ]) assert.ok(backend.includes(marker),marker);
 assert.doesNotMatch(backend,/db\.collection\("(?:products|records|recordCorrections|revenueGoals)"\)/);
 const save=between(html,'pInline("pInlineSave").onclick=','// Original internal owner sees existing teams');
 for(const marker of ["partnerInlineSelectedCb()","counts[key]=parsedCb.total",
  "date,staffId,counts,cbCounts,privateCounts,expectedVersion:",
  "saved.cbCounts?.NURO?.[tier]","partnerInlineCountsUnchanged"])
  assert.ok(save.includes(marker),marker);
 assert.match(html,/function partnerInlineClearFields\(\)/);
});
test("cashback count parser rejects NaN and overflows, accepts 0 and 5 plan cells",()=>{
 const source=between(html,"const PARTNER_NURO_CB_TIERS=","function partnerInlineHasUnsavedCounts(){");
 let fields=["0","20000","40000","60000","80000"].map((tier,i)=>({dataset:{cbTier:tier},value:String(i)}));
 let ctx={pInline:()=>({querySelectorAll:()=>fields})};
 runInNewContext(source+"\nthis.read=partnerInlineSelectedCb;",ctx);
 const output=ctx.read();
 assert.equal(output.total,10);
 assert.equal(output.result["40000"],2);
 fields[0].value="10000";
 assert.throws(()=>ctx.read(),/cb_count_overflow/);
 fields[0].value="0.5";
 assert.throws(()=>ctx.read(),/cb_count_invalid/);
});
