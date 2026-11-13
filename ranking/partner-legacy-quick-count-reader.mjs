/**
 * STAGING / NO DEPLOY. Read legacy company-only partnerQuickCountDays reports
 * from the SAME trusted read-only Firestore transaction as canonical staff
 * entries. Never invent a person/team or copy private financial fields.
 *
 * A legacy day and a staff-entry day are mutually exclusive. We do NOT
 * assume an old quick report and a newer staff report represent separate
 * sales; overlapping sources block publication to prevent double counting.
 */
import {PARTNER_RANK_SKUS} from "./partner-workspace-count-source.mjs";
import {auditNoFinancialKeys} from "../security/public-projection.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONTH=/^20\d\d-(0[1-9]|1[0-2])$/;
const STOP=()=>{throw Error("PARTNER_LEGACY_QUICK_MONTH_UNVERIFIED");};
const valid=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const names=Object.freeze([
 "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
if(PARTNER_RANK_SKUS.length!==names.length||PARTNER_RANK_SKUS.some(
 (sku,i)=>sku.id!=="partnerSku"+String(i+1).padStart(2,"0")||
 !sku.name.startsWith(names[i])))STOP();
const daysIn=month=>{
 if(!MONTH.test(month||""))STOP();
 const [y,m]=month.split("-").map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();
 return Array.from({length:days},(_,i)=>month+"-"+String(i+1).padStart(2,"0"));
};
const snapTime=s=>{
 const ts=s?.readTime;
 if(!Number.isSafeInteger(ts?.seconds)||!Number.isSafeInteger(ts?.nanoseconds)||
    ts.nanoseconds<0||ts.nanoseconds>=1000000000||
    typeof ts.toDate!=="function")STOP();
 const d=ts.toDate();
 if(!(d instanceof Date)||!Number.isFinite(d.getTime()))STOP();
 return {key:ts.seconds+":"+ts.nanoseconds,iso:d.toISOString()};
};
const legacyCounts=value=>{
 if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).sort().join("|")!==names.slice().sort().join("|"))STOP();
 let total=0;
 const counts=names.map(name=>{
  const n=value[name];
  if(!Number.isSafeInteger(n)||n<0)STOP();
  total+=n;
  if(!Number.isSafeInteger(total))STOP();
  return n;
 });
 return {counts,total};
};
/**
 * Called only after the fresh owner/partner context AND complete partner staff
 * ledger have been validated. All document reads use tx. No writes or caching.
 */
export function createPartnerLegacyQuickMonthReader({db}={}){
 if(!db||typeof db.collection!=="function")STOP();
 return async function readQuick({tx,context,hubCompanyId,partnerCompanyId,month,source}={}){
  if(!tx||typeof tx.get!=="function"||!valid(hubCompanyId)||
     !valid(partnerCompanyId)||hubCompanyId===partnerCompanyId||
     !context||context.serverVerified!==true||
     context.hubCompanyId!==hubCompanyId||
     !Array.isArray(context.approvedCompanyIds)||
     !context.approvedCompanyIds.includes(hubCompanyId)||
     !context.approvedCompanyIds.includes(partnerCompanyId)||
     !source||source.kind!=="partner"||source.companyId!==partnerCompanyId||
     source.isComplete!==true||source.consentVerified!==true||
     !Array.isArray(source.records)||!Array.isArray(source.products))STOP();
  const days=daysIn(month);
  const recordedDays=new Set();
  for(const r of source.records){
   if(r.companyId!==partnerCompanyId||typeof r.date!=="string"||
      r.date.slice(0,7)!==month||!days.includes(r.date))STOP();
   recordedDays.add(r.date);
  }
  const hub=db.collection("companies").doc(hubCompanyId);
  const staffRefs=days.map(day=>hub.collection("partnerWorkCountDays")
   .doc(day).collection("reports").doc(partnerCompanyId));
  const quickRefs=days.map(day=>hub.collection("partnerQuickCountDays")
   .doc(day).collection("reports").doc(partnerCompanyId));
  const reads=await Promise.all([...staffRefs,...quickRefs].map(ref=>tx.get(ref)));
  if(reads.length!==days.length*2)STOP();
  const baseline=snapTime(reads[0]);
  if(baseline.iso!==source.readTime)STOP();
  for(const snap of reads)if(snapTime(snap).key!==baseline.key)STOP();
  const rows=[];
  for(let i=0;i<days.length;i++){
   const staff=reads[i],legacy=reads[days.length+i],day=days[i];
   if(!legacy?.exists)continue;
   // A legacy report coexisting with a new staff report is ambiguous even if
   // both claim zero. Never silently prefer one or add both.
   if(staff?.exists||recordedDays.has(day)||
      typeof legacy.data!=="function")STOP();
   const raw=legacy.data();
   if(!raw||raw.hubCompanyId!==hubCompanyId||
      raw.partnerCompanyId!==partnerCompanyId||raw.date!==day||
      !Number.isSafeInteger(raw.version)||raw.version<1||raw.version>999)STOP();
   const {counts,total}=legacyCounts(raw.counts);
   if(raw.totalCount!==total)STOP();
   // A submitted zero must differ from an unreported day. Represent every
   // known zero category so an authorized ON category can prove zero input.
   // They remain company-only; no fake member or team is created.
   for(let j=0;j<counts.length;j++){
    if(total>0&&counts[j]===0)continue;
    rows.push({
     companyId:partnerCompanyId,date:day,
     sourceId:"legacyQuick_"+day.replaceAll("-",""),
     productId:PARTNER_RANK_SKUS[j].id,count:counts[j],
     kind:"company-code-ledger",exclusiveVerified:true
    });
   }
  }
  auditNoFinancialKeys(rows);
  return rows;
 };
}
