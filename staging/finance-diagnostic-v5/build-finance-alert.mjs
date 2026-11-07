#!/usr/bin/env node
/**
 * Candidate for ONLY the live finance-boundary-four.html display.
 * Builds from the exact prior session-safe diagnostic; no new reads/writes.
 * A single LIST or GET grant on ANY non-Owner role is a review warning, even
 * when the user's separate partner relationship could not be verified.
 */
import {sessionSafeFour} from "../finance-diagnostic-v4/build-session-safe.mjs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
const one=(src,previous,next,name)=>{
 if(src.split(previous).length!==2)throw Error("FINANCE_ALERT_UNREVIEWED_"+name);
 return src.replace(previous,next);
};
export const priorDiagnostic=()=>sessionSafeFour();
export function financeAlertFour(source=priorDiagnostic()){
 if(source!==priorDiagnostic())throw Error("FINANCE_ALERT_SOURCE_CHANGED");
 let html=source;
 html=one(html,
  '    else if(account.role==="partner-verified"&&anyMoneyReadable)',
  '    else if(account.role!=="owner"&&anyMoneyReadable)',
  "ANY_NON_OWNER_FINANCE_READ");
 html=one(html,
  'label("overall","金額原票の読み取り許可あり（危険・本番切替停止）","warn");',
  'label("overall","金額原票を読取可能（兼務協力店なら危険・所属を確認して本番切替停止）","warn");',
  "EXPLICIT_REVIEW_WARNING");
 html=one(html,
  '  else label(name,"判定保留（再検証が必要）","unknown");',
  '  else if(role!=="owner"&&(result.listStatus==="allowed"||result.getStatus==="allowed"))\n'+
  '    label(name,"金額原票に一部読取許可あり（所属確認・公開停止）","warn");\n'+
  '  else label(name,"判定保留（再検証が必要）","unknown");',
  "PARTIAL_READ_WARNING");
 if(!html.includes('STALE_AUTH_PROBE')||
    !html.includes('id="overall"')||
    !html.includes('role!=="owner"&&anyMoneyReadable')||
    !html.includes('label(name,"未確認","unknown")')||
    !html.includes('mask.fieldPaths')||
    !html.includes('getIdToken(true)')||
    /localStorage|sessionStorage|console\.log\(|\b(?:setDoc|updateDoc|deleteDoc|writeBatch)\s*\(/.test(html))
  throw Error("FINANCE_ALERT_READ_ONLY_CONTRACT");
 return html;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=="--check")
  throw Error("FINANCE_ALERT_NO_DEPLOY");
 const html=financeAlertFour();
 console.log("FINANCE_ALERT_SHA256="+createHash("sha256").update(html).digest("hex"));
 console.log("PRODUCTION_DOCUMENT_WRITES=0");
}
