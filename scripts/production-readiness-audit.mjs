#!/usr/bin/env node
/**
 * SALES PRODUCTION READINESS AUDIT — LOCAL, READ ONLY.
 *
 * Does NOT connect to Firebase, GitHub, LINE or Cloudflare. Reads repository
 * text files only, never modifies user records, backups, deployment or rules.
 *
 * A static PASS is not authorization to publish. Human/isolated Firebase
 * verification is always required; missing proof fails closed.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const checks=[];
function add(code,status,detail){checks.push({code,status,detail});}
function read(relative){
  try{return fs.readFileSync(path.join(root,relative),"utf8");}
  catch{return null;}
}
function ruleSection(rules,collection){
  if(!rules)return null;
  const marker="match /"+collection+"/{";
  const pos=rules.indexOf(marker);
  if(pos<0)return null;
  const end=rules.indexOf("\n    match /",pos+marker.length);
  return rules.slice(pos,end<0?rules.length:end);
}
const rules=read("firestore.rules");
if(!rules){
  add("FINANCE_RULES","BLOCK","Firestore Rulesの確認ができない");
}else{
  for(const name of ["products","records","recordCorrections","revenueGoals"]){
    const section=ruleSection(rules,name);
    const condition=section?.match(/allow\s+read\s*:\s*if\s+([\s\S]*?);/)?.[1];
    if(!condition){
      add("RULE_"+name,"REVIEW","read規則を静的に抽出できない。エミュレータで要確認");
      continue;
    }
    const companyWide=/\bsameCompany\s*\(/.test(condition);
    // Broad company-member reads remain unsafe for partner accounts. For
    // revenueGoals, even an owner OR canViewRevenue branch can leak to a
    // partner owner. Never interpret display-only restrictions as protection.
    if(companyWide){
      add("RULE_"+name,"BLOCK","会社所属者が金額原票を読む許可が残る可能性。協力店ownerを含め要遮断");
    }else{
      add("RULE_"+name,"REVIEW","見かけの会社全体許可はなし。ただしRules実機/エミュレータ検証必須");
    }
  }
  for(const name of ["products","records","recordCorrections","revenueGoals"]){
    const section=ruleSection(rules,name);
    if(section&&!/allow\s+delete\s*:\s*if\s+false\s*;|allow\s+update,\s*delete\s*:\s*if\s+false\s*;/.test(section)){
      add("NO_HARD_DELETE_"+name,"REVIEW","原票の物理削除拒否を静的に確認できない");
    }
  }
}

const app=read("index.html");
if(!app){
  add("APP","BLOCK","本番HTMLが見つからない");
}else if(/onSnapshot\s*\(\s*recordsCollectionQuery\s*\(\s*\)/.test(app)
      ||/getDocs\s*\(\s*recordsCollectionQuery\s*\(\s*\)/.test(app)){
  add("HISTORY_LOAD","BLOCK","全期間の実績購読/取得が残る。月別取得の完成と大規模検証が必要");
}else{
  add("HISTORY_LOAD","REVIEW","全期間直接取得の既知パターンなし。年度/報告/端末の網羅検証は別途必要");
}
if(app&&/companyCollectionQuery\s*\(\s*["']products["']\s*\)/.test(app)){
  add("PARTNER_UI","BLOCK","アプリが金額付き商材原票を直接購読。協力店の件数専用経路と切替必要");
}else{
  add("PARTNER_UI","REVIEW","協力店の生原票アクセス可否は実際のルールと権限で要確認");
}

const hosting=read(".github/workflows/nico-factory-sync.yml");
if(!hosting){
  add("DEPLOY_GATE","BLOCK","Hostingデプロイ設定が見つからない");
}else if(/^\s*push:\s*$/m.test(hosting)){
  add("DEPLOY_GATE","BLOCK","mainへのpushでHostingが自動更新される。手動承認ゲートへの切替が必要");
}else if(/workflow_dispatch\s*:/.test(hosting)){
  add("DEPLOY_GATE","REVIEW","手動トリガー候補あり。main/承認文字列/対象サイトを別途確認");
}else{
  add("DEPLOY_GATE","BLOCK","安全な手動公開トリガーを確認できない");
}
const gateway=read("security/staged-count-gateway.mjs");
if(gateway&&/enabled\s*=\s*false/.test(gateway)){
  add("PARTNER_GATEWAY","BLOCK","件数専用Gatewayは初期無効。本番adapter、公開ビュー同期と登録/訂正接続が未証明");
}else{
  add("PARTNER_GATEWAY","REVIEW","稼働フラグと安全な本番adapter接続を要確認");
}

for(const [code,detail] of [
  ["BACKUP","Firestore全コレクションとサブコレクション、Auth/Rules/Indexes/設定の保全範囲を確認"],
  ["RESTORE","本番と隔離した環境へ復元し、原票・件数・単価・CB・訂正・班履歴を照合"],
  ["ACL","協力店owner/master/leader/member、社内owner/leader/member、他会社・無効アカウントでread/writeを検証"],
  ["LARGE_DATA","2,000/2,001/25,001件・月境界・年度集計・請求読取量を検証"],
  ["DEVICE","新公式URLのみでiPhone/Android/PCのログイン、登録、訂正、報告とキャッシュ更新を検証"],
  ["NOTIFICATIONS","LINEはOFFのまま。送信先・無料枠・二重送信・時刻を承認付き実地検証"],
  ["OWNER_APPROVAL","復元証跡・本番変更差分・緊急停止/ロールバックを管理者が確認"]
])add(code,"EVIDENCE_REQUIRED",detail);

const blocked=checks.filter(x=>x.status==="BLOCK");
const unverified=checks.filter(x=>x.status!=="BLOCK");
if(process.argv.includes("--json")){
  console.log(JSON.stringify({release:"STOP",readOnly:true,blockers:blocked.length,unverified:unverified.length,checks},null,2));
}else{
  console.log("営業実績アプリ / 本番公開点検（読取専用）");
  for(const c of checks)console.log("["+c.status+"] "+c.code+" — "+c.detail);
  console.log("\n判定: STOP / 本番データ・Rules・Hostingには一切操作していません");
  console.log("BLOCK "+blocked.length+"件、未検証 "+unverified.length+"件。詳細: docs/SALES_PRODUCTION_RELEASE_20261029.md");
}
// A static audit alone can NEVER green-light production. Keep a nonzero
// exit code until independent runtime/backup proof is reviewed by the owner.
process.exitCode=2;
