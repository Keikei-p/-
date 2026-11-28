/**
 * STAGING ONLY — trusted-server, read-only Firestore adapter.
 * Not registered in any Cloud Function, route, Hosting asset or Worker.
 *
 * Reads the EXISTING partner day/person ledger + hub daily reports in one
 * Firestore read-only transaction. Existing active count sharing authorizes
 * counts; optional existing individual-name approval is checked separately
 * in the same snapshot and never grants permission merely from a saved name.
 *
 * The existing account, sales originals, audit history, Rules and Functions
 * are never written or modified. No client-provided proof or company label.
 */
import {buildPartnerCountRankingSource} from "./partner-workspace-count-source.mjs";
import {auditNoFinancialKeys} from "../security/public-projection.mjs";
import {existingPublicNameApprovalPairVerified}
 from "./trusted-combined-ranking-context.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONTH=/^(20\d\d)-(0[1-9]|1[0-2])$/;
const MAX_ENTRIES=2000,MAX_TEAMS=150,MAX_STAFF=150,MAX_PRIVATE=100;
const FORBIDDEN_NAME=/(?:売上|単価|収益|原価|価格|報酬|利益|キャッシュバック|cash[\s_-]*back|revenue|unit[\s_-]*price|commission|salary|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:万円|千円|円)|[\r\n\t@])/i;
const halt=()=>{throw Error("PARTNER_RANK_LIVE_MONTH_NOT_APPROVED_OR_INCOMPLETE");};
const tokyoMonth=clock=>{
 if(typeof clock!=="function")halt();
 const now=clock();
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))halt();
 const parts=new Intl.DateTimeFormat("en-US",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit"
 }).formatToParts(now);
 const y=parts.find(x=>x.type==="year")?.value;
 const m=parts.find(x=>x.type==="month")?.value;
 const month=y+"-"+m;
 if(!MONTH.test(month))halt();
 return month;
};
const id=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","prototype","constructor"].includes(x);
function isoTime(snapshot) {
 const t=snapshot?.readTime;
 if(!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds)||
    t.nanoseconds<0||t.nanoseconds>=1000000000||
    typeof t?.toDate!=="function")halt();
 const date=t.toDate();
 if(!(date instanceof Date)||!Number.isFinite(date.getTime()))halt();
 return {key:t.seconds+":"+t.nanoseconds,iso:date.toISOString()};
}
function doc(snapshot) {
 if(!snapshot||snapshot.exists!==true||typeof snapshot.data!=="function")halt();
 const value=snapshot.data();
 if(!value||typeof value!=="object"||Array.isArray(value))halt();
 return value;
}
function monthDays(month) {
 if(!MONTH.test(month||""))halt();
 const [year,m]=month.split("-").map(Number);
 const count=new Date(Date.UTC(year,m,0)).getUTCDate();
 return Array.from({length:count},(_,i)=>month+"-"+String(i+1).padStart(2,"0"));
}
function verifiedRelation(r,hub,partner) {
 if(r.hubCompanyId!==hub||r.partnerCompanyId!==partner||
    r.active!==true||r.countSharingApproved!==true)halt();
}
function requireSameTime(snapshot,key) {
 if(isoTime(snapshot).key!==key)halt();
}
function approvedServerContext(ctx,hub,partner) {
 if(!ctx||ctx.serverVerified!==true||ctx.userActive!==true||
    ctx.memberActive!==true||ctx.companyActive!==true||
    (ctx.activeCountSharingVerified!==true&&ctx.reciprocalOwnersApproved!==true)||
    ctx.completeSnapshotBudgetApproved!==true||
    ctx.hubCompanyId!==hub||!Array.isArray(ctx.approvedCompanyIds)||
    !ctx.approvedCompanyIds.includes(hub)||
    !ctx.approvedCompanyIds.includes(partner)||
    ctx.approvedCompanyIds.length>30)halt();
}
/**
 * Must be called from a trusted server after verifyIdToken, fresh membership
 * and active linked count-sharing checks. This module rechecks the company,
 * relation and optional existing name permissions in one count transaction.
 * Supply only server-validated ctx and a server-selected partner ID.
 *
 * Firestore interfaces: db.collection().doc().collection(), query.where(),
 * query.limit(), and db.runTransaction(tx => tx.get(refOrQuery)).
 */
/**
 * Read the complete existing partner month inside the CALLER'S transaction.
 * This is a trusted-server-only primitive for the atomic owner ranking
 * loader; it must never create a nested transaction or accept client proofs.
 * The outer caller must use db.runTransaction(..., {readOnly:true}).
 */
export function createPartnerMonthTransactionReader({
 db,clock=()=>new Date(),includePrivateCounts=false
}={}) {
 if(typeof includePrivateCounts!=="boolean")halt();
 if(!db||typeof db.collection!=="function")throw Error("missing server Firestore");
 return async function readPartnerMonthInTransaction({
  tx,hubCompanyId,partnerCompanyId,month,context
 }={}){
  if(!tx||typeof tx.get!=="function")halt();
  if(!id(hubCompanyId)||!id(partnerCompanyId)||
     hubCompanyId===partnerCompanyId)halt();
  const days=monthDays(month);
  // Current active membership cannot prove membership in a past month.
  // For past months rely exclusively on immutable saved report snapshots.
  const includeCurrentRoster=month===tokyoMonth(clock);
  approvedServerContext(context,hubCompanyId,partnerCompanyId);
  const c=id=>db.collection("companies").doc(id);
  const hub=c(hubCompanyId),partner=c(partnerCompanyId);
  const rel=db.collection("partnerRelations").doc(partnerCompanyId);
  const teamQuery=partner.collection("partnerWorkTeams").limit(MAX_TEAMS+1);
  const staffQuery=partner.collection("partnerWorkStaff").limit(MAX_STAFF+1);
  const entryQuery=partner.collection("partnerWorkEntries")
   .where("date",">=",days[0])
   .where("date","<=",days.at(-1)).limit(MAX_ENTRIES+1);
  const privateQuery=includePrivateCounts?
   partner.collection("partnerPrivateProducts").limit(MAX_PRIVATE+1):null;
  const daily=days.map(day=>hub.collection("partnerWorkCountDays").doc(day)
   .collection("reports").doc(partnerCompanyId));
  // Every result is from the SAME caller-owned read-only transaction. No
   // independent client GETs can supply faux completeness/readTime proof.
   const [hubSnap,partnerSnap,relSnap,teamSnap,staffSnap,entrySnap,...tail]=
    await Promise.all([
     tx.get(hub),tx.get(partner),tx.get(rel),
     tx.get(teamQuery),tx.get(staffQuery),tx.get(entryQuery),
     ...(includePrivateCounts?[tx.get(privateQuery)]:[]),
     ...daily.map(ref=>tx.get(ref))
    ]);
   const privateSnap=includePrivateCounts?tail.shift():null;
   const dailySnaps=tail;
   const {key,iso}=isoTime(entrySnap);
   for(const snap of [hubSnap,partnerSnap,relSnap,teamSnap,staffSnap,
     ...(includePrivateCounts?[privateSnap]:[]),...dailySnaps])
    requireSameTime(snap,key);
   const hubCompany=doc(hubSnap),partnerCompany=doc(partnerSnap),
     relation=doc(relSnap);
   if(hubCompany.active===false||
      !["internal","direct"].includes(hubCompany.companyKind??"internal")||
      partnerCompany.active!==true||partnerCompany.companyKind!=="partner"||
      partnerCompany.hubCompanyId!==hubCompanyId)halt();
   verifiedRelation(relation,hubCompanyId,partnerCompanyId);
   let publicNamesVerified=false;
   if(relation.individualNamesApprovedByHub===true&&
      relation.individualNamesApprovedByPartner===true&&
      id(hubCompany.ownerUid)&&id(partnerCompany.ownerUid)){
    const [hubApprovalSnap,partnerApprovalSnap]=await Promise.all([
     tx.get(hub.collection("rankingApprovals").doc(partnerCompanyId)),
     tx.get(partner.collection("rankingApprovals").doc(hubCompanyId))
    ]);
    // Approval expiry or malformed optional evidence suppresses names only.
    // Count/entry/summary snapshot validation remains mandatory above/below.
    try{
     requireSameTime(hubApprovalSnap,key);requireSameTime(partnerApprovalSnap,key);
     publicNamesVerified=existingPublicNameApprovalPairVerified({
      relation,hubCompany,partnerCompany,hubCompanyId,partnerCompanyId,
      hubApproval:hubApprovalSnap.exists?doc(hubApprovalSnap):null,
      partnerApproval:partnerApprovalSnap.exists?doc(partnerApprovalSnap):null
     });
    }catch{publicNamesVerified=false;}
   }
   if(!Array.isArray(entrySnap?.docs)||!Array.isArray(teamSnap?.docs)||
      !Array.isArray(staffSnap?.docs)||
      (includePrivateCounts&&!Array.isArray(privateSnap?.docs))||
      entrySnap.docs.length>MAX_ENTRIES||teamSnap.docs.length>MAX_TEAMS||
      staffSnap.docs.length>MAX_STAFF||
      (includePrivateCounts&&privateSnap.docs.length>MAX_PRIVATE))halt();
   const teams=teamSnap.docs.map(s=>{
    const t=doc(s);
    if(!id(s.id)||t.companyId!==partnerCompanyId)halt();
    return {id:s.id,name:t.name,goalCount:null};
   });
   // Only active current partnerWorkStaff may be added as unreported.
   // Historical/inactive staff remain visible ONLY through actual saved
   // entry snapshots. Never assign old counts to the current team.
   const verifiedTeams=new Set(teams.map(t=>t.id)),seenStaff=new Set();
   const activeRoster=[];
   for(const snapshot of staffSnap.docs){
    const person=doc(snapshot);
    if(!id(snapshot.id)||seenStaff.has(snapshot.id)||
       person.companyId!==partnerCompanyId||
       typeof person.active!=="boolean")halt();
    seenStaff.add(snapshot.id);
    if(person.active!==true||!includeCurrentRoster)continue;
    if(!id(person.teamId)||!verifiedTeams.has(person.teamId)||
       typeof person.name!=="string"||
       person.name.trim().length<1||person.name.length>80||
       FORBIDDEN_NAME.test(person.name.normalize("NFKC")))halt();
    activeRoster.push({uid:snapshot.id,name:person.name.trim(),teamId:person.teamId});
   }
   // A removed historical team cannot be silently remapped to the user's
   // current team. buildPartnerCountRankingSource refuses unknown snapshots.
   const entries=entrySnap.docs.map(s=>{
    if(!id(s.id))halt();
    const row=doc(s);
    // Document ID is the authoritative staff/date identity. A stored
    // shadow "id" field must never override the Firebase document ID.
    if(Object.hasOwn(row,"id")&&row.id!==s.id)halt();
    return {...row,id:s.id};
   });
   const privateProducts=includePrivateCounts?privateSnap.docs.map(sn=>{
    const p=doc(sn);
    if(!id(sn.id)||p.companyId!==partnerCompanyId||
       p.origin!=="partner_custom"||p.visibility!=="private"||
       typeof p.active!=="boolean"||typeof p.name!=="string")
      halt();
    return {id:sn.id,companyId:p.companyId,origin:p.origin,
     visibility:p.visibility,name:p.name,active:p.active};
   }):undefined;
   const summaries=[];
   for(let i=0;i<dailySnaps.length;i++){
    const snapshot=dailySnaps[i];
    if(!snapshot.exists)continue;
    const s=doc(snapshot);
    if(s.date!==days[i])halt();
    summaries.push(s);
   }
   // New individual ledger fields require the same-snapshot Owner public catalog.
   // Older readers must stop rather than publish an incomplete total.
   let individualPublicCatalog;
   if([...entries,...summaries].some(row=>Object.hasOwn(row,"ownerProductCounts")||
      Object.hasOwn(row,"ownerProductTotalCount"))){
    if(!includePrivateCounts)halt();
    const [catalogSnap,visibilitySnap]=await Promise.all([
     tx.get(hub.collection("rankingCountPublicCatalog").doc("shared")),
     tx.get(hub.collection("rankingProductVisibility").doc("shared"))]);
    requireSameTime(catalogSnap,key);requireSameTime(visibilitySnap,key);
    const catalog=doc(catalogSnap),visibility=doc(visibilitySnap);
    if(!id(hubCompany.ownerUid)||catalog.ownerUid!==hubCompany.ownerUid||
       visibility.ownerUid!==hubCompany.ownerUid||visibility.hubCompanyId!==hubCompanyId||
       !Number.isSafeInteger(visibility.version)||visibility.version<1||
       catalog.version!==visibility.version||Object.keys(catalog).some(k=>
        !["schema","hubCompanyId","ownerUid","version","createdAt","updatedAt","products"].includes(k)))halt();
    individualPublicCatalog=catalog;
   }
   // The only two ways to pass are: complete empty month OR every saved
   // entry exactly agrees with the owner company's dated count summary.
   const source=buildPartnerCountRankingSource({
    hubCompanyId,partnerCompanyId,companyLabel:partnerCompany.name,
    period:month,readTime:iso,
    relation,proof:{
     serverVerified:true,countSharingVerified:true,
     completeMonthEntriesRead:true,completeMonthSummariesRead:true,
     historicalTeamsVerified:true,snapshotConsistent:true,
     ...(includePrivateCounts?{completePrivateProductCatalogueRead:true}:{}),
     ...(individualPublicCatalog?{completeIndividualCatalogRead:true}:{})
    },teams,entries,summaries,
    includePrivateCounts,privateProducts,individualPublicCatalog
   });
   // No raw staff documents or user-private data may leave this reader.
   const result={...source,roster:activeRoster,publicNamesVerified};
   auditNoFinancialKeys(result);
   return result;
 };
}

/**
 * Preserve the original standalone read-only loader and its existing API.
 * Both paths share exactly the same validation and source projection.
 */
export function createPartnerMonthReadOnlyLoader({db,clock=()=>new Date()}={}) {
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function")throw Error("missing server Firestore");
 const read=createPartnerMonthTransactionReader({db,clock});
 return async function loadPartnerMonth(args={}) {
  return db.runTransaction(tx=>read({...args,tx}),{readOnly:true});
 };
}
