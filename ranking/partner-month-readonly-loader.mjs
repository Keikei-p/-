/**
 * STAGING ONLY — trusted-server, read-only Firestore adapter.
 * Not registered in any Cloud Function, route, Hosting asset or Worker.
 *
 * Reads the EXISTING partner day/person ledger + hub daily reports in one
 * Firestore read-only transaction. Both owners must approve ranking/names
 * explicitly in the server-owned partnerRelations document; the older
 * countSharingApproved flag alone NEVER authorizes public ranking.
 *
 * The existing account, sales originals, audit history, Rules and Functions
 * are never written or modified. No client-provided proof or company label.
 */
import {buildPartnerCountRankingSource} from "./partner-workspace-count-source.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONTH=/^(20\d\d)-(0[1-9]|1[0-2])$/;
const MAX_ENTRIES=2000,MAX_TEAMS=150;
const halt=()=>{throw Error("PARTNER_RANK_LIVE_MONTH_NOT_APPROVED_OR_INCOMPLETE");};
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
    r.active!==true||r.countSharingApproved!==true||
    r.combinedRankingApprovedByHub!==true||
    r.combinedRankingApprovedByPartner!==true||
    r.individualNamesApprovedByHub!==true||
    r.individualNamesApprovedByPartner!==true)halt();
}
function requireSameTime(snapshot,key) {
 if(isoTime(snapshot).key!==key)halt();
}
function approvedServerContext(ctx,hub,partner) {
 if(!ctx||ctx.serverVerified!==true||ctx.userActive!==true||
    ctx.memberActive!==true||ctx.companyActive!==true||
    ctx.reciprocalOwnersApproved!==true||
    ctx.individualNamesApproved!==true||
    ctx.completeSnapshotBudgetApproved!==true||
    ctx.hubCompanyId!==hub||!Array.isArray(ctx.approvedCompanyIds)||
    !ctx.approvedCompanyIds.includes(hub)||
    !ctx.approvedCompanyIds.includes(partner)||
    ctx.approvedCompanyIds.length>30)halt();
}
/**
 * Must be called from a trusted server after verifyIdToken + fresh membership
 * and reciprocal company approval. This module independently rechecks the
 * company and owner consents in one transaction to prevent a stale context.
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
export function createPartnerMonthTransactionReader({db}={}) {
 if(!db||typeof db.collection!=="function")throw Error("missing server Firestore");
 return async function readPartnerMonthInTransaction({
  tx,hubCompanyId,partnerCompanyId,month,context
 }={}){
  if(!tx||typeof tx.get!=="function")halt();
  if(!id(hubCompanyId)||!id(partnerCompanyId)||
     hubCompanyId===partnerCompanyId)halt();
  const days=monthDays(month);
  approvedServerContext(context,hubCompanyId,partnerCompanyId);
  const c=id=>db.collection("companies").doc(id);
  const hub=c(hubCompanyId),partner=c(partnerCompanyId);
  const rel=db.collection("partnerRelations").doc(partnerCompanyId);
  const teamQuery=partner.collection("partnerWorkTeams").limit(MAX_TEAMS+1);
  const entryQuery=partner.collection("partnerWorkEntries")
   .where("date",">=",days[0])
   .where("date","<=",days.at(-1)).limit(MAX_ENTRIES+1);
  const daily=days.map(day=>hub.collection("partnerWorkCountDays").doc(day)
   .collection("reports").doc(partnerCompanyId));
  // Every result is from the SAME caller-owned read-only transaction. No
   // independent client GETs can supply faux completeness/readTime proof.
   const [hubSnap,partnerSnap,relSnap,teamSnap,entrySnap,...dailySnaps]=
    await Promise.all([
     tx.get(hub),tx.get(partner),tx.get(rel),
     tx.get(teamQuery),tx.get(entryQuery),
     ...daily.map(ref=>tx.get(ref))
    ]);
   const {key,iso}=isoTime(entrySnap);
   for(const snap of [hubSnap,partnerSnap,relSnap,teamSnap,...dailySnaps])
    requireSameTime(snap,key);
   const hubCompany=doc(hubSnap),partnerCompany=doc(partnerSnap),
     relation=doc(relSnap);
   if(hubCompany.active===false||
      !["internal","direct"].includes(hubCompany.companyKind??"internal")||
      partnerCompany.active!==true||partnerCompany.companyKind!=="partner"||
      partnerCompany.hubCompanyId!==hubCompanyId)halt();
   verifiedRelation(relation,hubCompanyId,partnerCompanyId);
   if(!Array.isArray(entrySnap?.docs)||!Array.isArray(teamSnap?.docs)||
      entrySnap.docs.length>MAX_ENTRIES||teamSnap.docs.length>MAX_TEAMS)halt();
   const teams=teamSnap.docs.map(s=>{
    const t=doc(s);
    if(!id(s.id)||t.companyId!==partnerCompanyId)halt();
    return {id:s.id,name:t.name,goalCount:null};
   });
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
   const summaries=[];
   for(let i=0;i<dailySnaps.length;i++){
    const snapshot=dailySnaps[i];
    if(!snapshot.exists)continue;
    const s=doc(snapshot);
    if(s.date!==days[i])halt();
    summaries.push(s);
   }
   // The only two ways to pass are: complete empty month OR every saved
   // entry exactly agrees with the owner company's dated count summary.
   return buildPartnerCountRankingSource({
    hubCompanyId,partnerCompanyId,companyLabel:partnerCompany.name,
    period:month,readTime:iso,
    relation,proof:{
     serverVerified:true,reciprocalOwnersApproved:true,
     completeMonthEntriesRead:true,completeMonthSummariesRead:true,
     historicalTeamsVerified:true,snapshotConsistent:true
    },teams,entries,summaries
   });
  };
 };
}

/**
 * Preserve the original standalone read-only loader and its existing API.
 * Both paths share exactly the same validation and source projection.
 */
export function createPartnerMonthReadOnlyLoader({db}={}) {
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function")throw Error("missing server Firestore");
 const read=createPartnerMonthTransactionReader({db});
 return async function loadPartnerMonth(args={}) {
  return db.runTransaction(tx=>read({...args,tx}),{readOnly:true});
 };
}
