#!/usr/bin/env node
/**
 * STAGING ONLY / NO DEPLOY.
 * Generate an additional diagnostic candidate from the byte-reviewed,
 * already-live finance-boundary-check.html. Do not alter the published page.
 * Financial values are never displayed, logged, stored or returned in reports.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const ORIGINAL_BLOB="7fa664efb17f6d3337e9403498aa8c0857b35be5";
export const FINANCE_COLLECTIONS=Object.freeze([
  "products","records","recordCorrections","revenueGoals"
]);
export function gitBlob(input){
  const buf=Buffer.from(input,"utf8");
  return createHash("sha1").update(Buffer.from("blob "+buf.length+"\0"))
    .update(buf).digest("hex");
}
function one(source,before,after,code){
  const start=source.indexOf(before);
  if(start<0||source.indexOf(before,start+before.length)>=0)
    throw Error("STAGING_DIAGNOSTIC_"+code+"_UNEXPECTED_SOURCE");
  return source.slice(0,start)+after+source.slice(start+before.length);
}
const ORIGINAL_OWNER_HANDOFF=String.raw`
    if(account.role==="owner"&&["products","records"].every(name=>
      results[name].listStatus==="allowed"&&results[name].getStatus==="allowed")){
      const ids=Object.fromEntries(["products","records"].map(name=>
        [name,previous.get(account.company+":"+name)]));
      if(["products","records"].every(name=>ID.test(ids[name]||"")))
        ownerHandoff={company:account.company,ids};
    }`;
const NEW_OWNER_HANDOFF=String.raw`
    // Each Owner-confirmed document can be passed to the subsequent partner
    // session in this tab only. Collections without saved documents must NOT
    // block a valid handoff for the other collections.
    if(account.role==="owner"){
      const verified=FINANCE_COLLECTIONS.filter(name=>
        results[name].listStatus==="allowed"&&results[name].getStatus==="allowed");
      const ids=Object.fromEntries(verified.map(name=>
        [name,previous.get(account.company+":"+name)]).filter(item=>
          ID.test(item[1]||"")));
      if(Object.keys(ids).length>0)
        ownerHandoff={company:account.company,ids};
    }`;
export function makeCandidate(original){
  if(typeof original!=="string"||gitBlob(original)!==ORIGINAL_BLOB)
    throw Error("STAGING_DIAGNOSTIC_SOURCE_SHA_CHANGED");
  let html=original;
  html=one(html,
    '<div class="output"><span>実績の金額原票（LIST / GET）</span><span id="records">未確認</span></div>',
    '<div class="output"><span>実績の金額原票（LIST / GET）</span><span id="records">未確認</span></div>\n'+
    '<div class="output"><span>実績訂正履歴（LIST / GET）</span><span id="recordCorrections">未確認</span></div>\n'+
    '<div class="output"><span>売上目標（LIST / GET）</span><span id="revenueGoals">未確認</span></div>',
    "RESULT_ROWS");
  html=one(html,"const ID=/",
    'const FINANCE_COLLECTIONS=Object.freeze(["products","records","recordCorrections","revenueGoals"]);\nconst ID=/',
    "COLLECTIONS");
  html=one(html,'for(const name of ["products","records"]){',
    'for(const name of FINANCE_COLLECTIONS){',"CHECK_LOOP");
  html=one(html,'for(const name of ["identity","products","records","counts"])',
    'for(const name of ["identity",...FINANCE_COLLECTIONS,"counts"])',
    "INIT_LOOP");
  html=one(html,'for(const name of ["products","records","counts"])',
    'for(const name of [...FINANCE_COLLECTIONS,"counts"])',
    "ERROR_LOOP");
  html=one(html,ORIGINAL_OWNER_HANDOFF,NEW_OWNER_HANDOFF,"HANDOFF");
  html=one(html,
    '<p><a href="./">営業実績管理へ戻る</a></p>',
    '<p class="muted">確認順序：最初に自社Ownerで診断し、診断専用ログアウト後に協力店アカウントで再診断してください。各原票のGETは、Ownerがその種類の既存文書を確認できた場合に限り試します。文書がない場合は未検証と表示し、合格扱いにしません。</p>\n'+
    '<p><a href="./">営業実績管理へ戻る</a></p>',
    "GUIDE");
  if(!html.includes('select:{fields:[{fieldPath:"companyId"}]}')||
     !html.includes('masked(name+"/"+target,["companyId"],token)')||
     !html.includes('getIdToken(true)')||
     !html.includes('location.origin!=="https://nico-factory.web.app"')||
     /localStorage|sessionStorage|console\.log|setDoc\(|writeBatch\(/.test(html))
    throw Error("STAGING_DIAGNOSTIC_READ_ONLY_CONTRACT_CHANGED");
  return html;
}
export function originalSource(){
  return readFileSync(new URL("../../finance-boundary-check.html",import.meta.url),"utf8");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=="--check")
    throw Error("NO_DEPLOY_CHECK_ONLY");
  const candidate=makeCandidate(originalSource());
  const hash=createHash("sha256").update(candidate).digest("hex");
  console.log("STAGING_FOUR_COLLECTIONS_READY NO_DEPLOY SHA256="+hash);
}
