/**
 * Historical export safety policy. Pure, read-only, no Firebase/network.
 * A report with invalid or missing saved prices must never be advertised
 * as a finalized PDF/CSV. Preserve its JSON evidence for manual audit.
 */
export function archiveExportPolicy({warnings,rows,records,companyVerified}={}){
 if(companyVerified!==true||!Array.isArray(warnings)||
    !Array.isArray(rows)||!Array.isArray(records)||
    warnings.some(s=>typeof s!=="string")||
    rows.some(x=>!x||typeof x!=="object")||
    records.some(x=>!x||typeof x!=="object"))
   throw Error("Archive source validation required");
 const reasons=[...warnings];
 let totalCount=0,totalRevenue=0;
 for(const row of rows){
   if(typeof row.count!=="number"||!Number.isSafeInteger(row.count)||
      row.count<0||typeof row.amount!=="number"||
      !Number.isSafeInteger(row.amount)||row.amount<0){
      reasons.push("実績行の件数・保存単価に未確認項目あり");
      break;
   }
   totalCount+=row.count;totalRevenue+=row.amount;
   if(!Number.isSafeInteger(totalCount)||!Number.isSafeInteger(totalRevenue)){
     reasons.push("件数または売上の合計値が安全な整数範囲を超過");
     break;
   }
 }
 if(records.length>0&&!rows.length)reasons.push("保存済みの実績明細がありません");
 const isReady=reasons.length===0;
 return Object.freeze({
  canExportPdf:isReady,
  canExportCsv:isReady,
  canExportEvidenceJson:true,
  isVerifiedFinancialReport:isReady,
  issueCount:reasons.length
 });
}
