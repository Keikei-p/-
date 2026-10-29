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
 // Never infer missing saved totals from the displayed rows. The original
 // record and its lines must independently agree before a report is final.
 const sourceIds=new Set(),byRecord=new Map();
 for(const source of records){
   if(typeof source.id!=="string"||!source.id||sourceIds.has(source.id)){
     reasons.push("原票IDが欠損または重複");continue;
   }
   sourceIds.add(source.id);
   const storedCount=source.totalCount,storedRevenue=source.totalRevenue;
   if(typeof storedCount!=="number"||!Number.isSafeInteger(storedCount)||
      storedCount<0||typeof storedRevenue!=="number"||
      !Number.isSafeInteger(storedRevenue)||storedRevenue<0){
     reasons.push("原票の保存件数・保存売上が未設定または不正");
   }
   byRecord.set(source.id,{storedCount,storedRevenue,count:0,revenue:0});
 }
 for(const row of rows){
   if(typeof row.recordId!=="string"||!byRecord.has(row.recordId)){
     reasons.push("実績明細の元原票がありません");continue;
   }
   const totals=byRecord.get(row.recordId);
   if(Number.isSafeInteger(row.count)&&row.count>=0&&
      Number.isSafeInteger(row.amount)&&row.amount>=0){
     totals.count+=row.count;totals.revenue+=row.amount;
   }
 }
 for(const totals of byRecord.values()){
   if(!Number.isSafeInteger(totals.count)||
      !Number.isSafeInteger(totals.revenue)||
      totals.count!==totals.storedCount||
      totals.revenue!==totals.storedRevenue)
     reasons.push("原票保存値と明細の集計に不一致");
 }
 const isReady=reasons.length===0;
 return Object.freeze({
  canExportPdf:isReady,
  canExportCsv:isReady,
  canExportEvidenceJson:true,
  isVerifiedFinancialReport:isReady,
  issueCount:reasons.length
 });
}
