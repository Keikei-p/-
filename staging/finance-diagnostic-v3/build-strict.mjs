#!/usr/bin/env node
/**
 * Strict display revision of the already-published four-collection page.
 * Browser only; no database writes; no finance values, secrets or document IDs.
 * A completed diagnostic remains scoped to one authenticated account.
 */
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {makeCandidate,originalSource} from "../finance-diagnostic-v2/build-candidate.mjs";
const one=(src,a,b,context)=>{
 const at=src.indexOf(a);
 if(at<0||src.indexOf(a,at+a.length)!==-1)
  throw Error("STRICT_FOUR_PROOF_UNREVIEWED_"+context);
 return src.slice(0,at)+b+src.slice(at+a.length);
};
export function originalFour(){return makeCandidate(originalSource());}
export function strictFour(source=originalFour()){
 if(source!==originalFour())throw Error("STRICT_FOUR_PROOF_SOURCE_CHANGED");
 let html=source;
 html=one(html,
 '<div class="output"><span>協力店件数画面（読取のみ）</span><span id="counts">未確認</span></div>',
 '<div class="output"><span>協力店件数画面（読取のみ）</span><span id="counts">未確認</span></div>\n'+
 '<div class="output"><span>今回の総合判定（このログインのみ）</span><span id="overall">未確認</span></div>',
 "NEW_OVERALL_ROW");
 html=one(html,
 'else if(role==="not-owner"||role==="partner-candidate"||role==="partner-verified")\n      label(name,"LIST・GETともに拒否（所属の独立照合は未完）","pass");',
 'else if(role==="partner-verified")\n      label(name,"LIST・GETともに拒否（協力店認証のこのUIDのみ）","pass");\n'+
 '    else if(role==="not-owner"||role==="partner-candidate")\n'+
 '      label(name,"LIST・GET拒否（協力店所属は未証明）","unknown");',
 "DENY_STATUS_MUST_REQUIRE_PARTNER");
 html=one(html,
 'for(const name of ["identity",...FINANCE_COLLECTIONS,"counts"])label(name,"検証中");',
 'for(const name of ["identity",...FINANCE_COLLECTIONS,"counts","overall"])label(name,"検証中");',
 "RESET_STATUSES");
 html=one(html,
 'for(const name of [...FINANCE_COLLECTIONS,"counts"])label(name,"未確認");',
 'for(const name of [...FINANCE_COLLECTIONS,"counts","overall"])label(name,"未確認");',
 "ERROR_STATUSES");
 const summary=[
'    // Overall is valid only for this authenticated UID and verified role.',
'    // Denied LIST with untested GET never counts as a complete denial.',
'    if(auth.currentUser?.uid!==user.uid)throw Error("AUTH_CHANGED_DURING_PROBE");',
'    const deniedEvery=FINANCE_COLLECTIONS.every(name=>',
'      results[name]?.listStatus==="denied"&&results[name]?.getStatus==="denied");',
'    const allowedEvery=FINANCE_COLLECTIONS.every(name=>',
'      results[name]?.listStatus==="allowed"&&results[name]?.getStatus==="allowed");',
'    const anyMoneyReadable=FINANCE_COLLECTIONS.some(name=>',
'      results[name]?.listStatus==="allowed"||results[name]?.getStatus==="allowed");',
'    if(account.role==="partner-verified"&&countVerified&&deniedEvery)',
'      label("overall","4項目拒否確認（このUIDのみ・件数保存は別検証）","pass");',
'    else if(account.role==="partner-verified"&&anyMoneyReadable)',
'      label("overall","金額原票の読み取り許可あり（危険・本番切替停止）","warn");',
'    else if(account.role==="owner"&&allowedEvery)',
'      label("overall","Ownerの4項目閲覧正常（このUIDのみ）","pass");',
'    else',
'      label("overall","判定保留（所属・GET/LIST・件数入力は別途確認）","unknown");',
'    $("status").textContent="診断終了。結果はこのログインのみ。3アカウント別の独立した実UID照合と件数入力保存の確認が必要です。";'
 ].join("\n");
 html=one(html,
 '    $("status").textContent="診断終了。金額遮断の本番承認には別途、独立した実UID照合が必要です。";',
 summary,"TOTAL_RESULT_FAIL_CLOSED");
 if(!html.includes('mask.fieldPaths')||
    !html.includes('getIdToken(true)')||html.length<9000||
    /localStorage|sessionStorage|console\.log\(|\bsetDoc\(|\bwriteBatch\(/.test(html))
  throw Error("STRICT_FOUR_PROOF_READ_ONLY_CONTRACT");
 return html;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=="--check")throw Error("STRICT_FOUR_NO_DEPLOY");
 const source=strictFour();
 console.log("STRICT_FOUR_PROOF_PREVIEW_ONLY_SHA256="+
  createHash("sha256").update(source).digest("hex"));
}
