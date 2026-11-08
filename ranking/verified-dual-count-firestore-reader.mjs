/**
 * STAGING ONLY — trusted Firebase Admin Firestore single-snapshot reader.
 * Existing sales and count collections are READ ONLY, including the monetary
 * legacy hub records which are projected to strict count-only records in RAM.
 *
 * Must be called only after verifyIdToken(token,true) + getUser and fresh
 * createFreshCombinedRankingContext. Context and both owner consents are
 * independently checked AGAIN inside this exact same read-only transaction.
 * There is no deploy, mutation, writable endpoint, or browser Firestore API.
 */
import {projectPublicRecordHeader,projectPublicRecordLines,
 projectPublicProduct,assertPublicSchema} from "../security/public-projection.mjs";
import {PARTNER_RANK_SKUS} from "./partner-workspace-count-source.mjs";
import {buildVerifiedCountDashboard,verifiedDualCountWindow}
 from "./verified-dual-count-dashboards.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const KEYS=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const BLOCKED=()=>{throw Error("SINGLE_SNAPSHOT_COUNT_SOURCE_NOT_APPROVED_OR_INCOMPLETE");};
const id=x=>typeof x==="string"&&ID.test(x);
const number=x=>{if(!Number.isSafeInteger(x)||x<0||x>1_000_000)BLOCKED();return x;};
const name=x=>{
 if(typeof x!=="string"||!x.trim()||x.length>80||
    /(?:売上|単価|キャッシュバック|[¥￥$€]|CB\s*[0-9０-９]|[0-9０-９]+\s*円)/i.test(x))BLOCKED();
 return x.replace(/[\r\n\t]/g," ").trim();
};
const read=s=>s?.exists===true&&typeof s.data==="function"?s.data():null;
function verifiedApproval(x,cid,hub,pid,owner){
 return !!x&&x.companyId===cid&&x.hubCompanyId===hub&&
  x.partnerCompanyId===pid&&x.approvedByUid===owner&&
  x.active===true&&x.combinedRankingApproved===true&&
  x.individualNamesApproved===true&&x.scope==="combined_rank_only"&&
  Number.isSafeInteger(x.version)&&x.version>=1&&x.version<=999;
}
function validRelation(x,hub,pid){
 return x&&x.hubCompanyId===hub&&x.partnerCompanyId===pid&&
  x.active===true&&x.countSharingApproved===true&&
  x.combinedRankingApprovedByHub===true&&
  x.combinedRankingApprovedByPartner===true&&
  x.individualNamesApprovedByHub===true&&
  x.individualNamesApprovedByPartner===true;
}
const dayList=(from,to)=>{
 const dates=[],d=new Date(from+"T12:00:00Z"),end=Date.parse(to+"T12:00:00Z");
 while(d.getTime()<=end&&dates.length<=70){
  dates.push(d.toISOString().slice(0,10));
  d.setUTCDate(d.getUTCDate()+1);
 }
 if(!dates.length||dates.length>70||dates.at(-1)!==to)BLOCKED();
 return dates;
};
function countMap(counts){
 if(!counts||typeof counts!=="object"||Array.isArray(counts)||
    Object.keys(counts).sort().join("|")!==[...KEYS].sort().join("|"))BLOCKED();
 let total=0;
 for(const k of KEYS){total+=number(counts[k]);if(!Number.isSafeInteger(total))BLOCKED();}
 return total;
}
const safeTime=s=>{
 const t=s?.readTime;
 if(!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds)||
    t.nanoseconds<0||t.nanoseconds>=1_000_000_000||
    typeof t.toDate!=="function")BLOCKED();
 const d=t.toDate();
 if(!(d instanceof Date)||!Number.isFinite(d.getTime()))BLOCKED();
 return {key:t.seconds+":"+t.nanoseconds,iso:d.toISOString()};
};
export function createVerifiedDualCountSnapshotReader({db}={}){
 if(!db||typeof db.collection!=="function"||
    typeof db.runTransaction!=="function")BLOCKED();
 const collection=x=>db.collection(x);
 const company=x=>collection("companies").doc(x);
 const docRows=(snap,max)=>{if(!Array.isArray(snap?.docs)||snap.docs.length>max)BLOCKED();return snap.docs;};
 return async function readDualCountSnapshot({
  principal,context,period,filters={},loadCanonicalMapping=()=>[]
 }={}){
  if(!principal||!id(principal.uid)||principal.emailVerified!==true||
     typeof principal.email!=="string"||
     !context||context.serverVerified!==true||
     context.viewerUid!==principal.uid||
     context.userActive!==true||context.memberActive!==true||
     context.companyActive!==true||context.reciprocalOwnersApproved!==true||
     context.individualNamesApproved!==true||
     context.completeSnapshotBudgetApproved!==true||
     !id(context.hubCompanyId)||!id(context.viewerCompanyId)||
     !Array.isArray(context.approvedCompanyIds)||
     context.approvedCompanyIds.length<1||
     context.approvedCompanyIds.length>8||
     new Set(context.approvedCompanyIds).size!==context.approvedCompanyIds.length||
     !context.approvedCompanyIds.includes(context.hubCompanyId)||
     !context.approvedCompanyIds.includes(context.viewerCompanyId)||
     context.approvedCompanyIds.some(x=>!id(x))||
     typeof loadCanonicalMapping!=="function")BLOCKED();
  const win=verifiedDualCountWindow(period),allDays=dayList(win.previousStart,win.end);
  const hubId=context.hubCompanyId,viewerId=context.viewerCompanyId;
  return db.runTransaction(async tx=>{
   let moment=null,iso=null;
   const get=async ref=>{
    const snap=await tx.get(ref),time=safeTime(snap);
    if(moment!==null&&time.key!==moment)BLOCKED();
    moment=time.key;iso=time.iso;
    return snap;
   };
   const [userSnap,secondarySnap,viewerCompanySnap,memberSnap,hubSnap]=
    await Promise.all([
     get(collection("users").doc(principal.uid)),
     get(collection("partnerWorkspaceContexts").doc(principal.uid)),
     get(company(viewerId)),
     get(company(viewerId).collection("members").doc(principal.uid)),
     get(company(hubId))
    ]);
   const user=read(userSnap),sec=read(secondarySnap),
     viewer=read(viewerCompanySnap),member=read(memberSnap),hub=read(hubSnap);
   if(!user||!viewer||!member||!hub||
      user.uid!==principal.uid||user.companyId!==viewerId||
      (member.uid!=null&&member.uid!==principal.uid)||
      (member.companyId!=null&&member.companyId!==viewerId)||
      user.active!==true||member.active!==true||viewer.active===false||
      user.companyRole!=="owner"||member.companyRole!=="owner"||
      viewer.ownerUid!==principal.uid||
      (typeof user.email==="string"&&user.email.toLowerCase()!==principal.email)||
      (secondarySnap.exists&&sec?.active!==false)||
      hub.active===false||!id(hub.ownerUid)||
      ![undefined,"internal","direct"].includes(hub.companyKind))BLOCKED();
   const role=viewerId===hubId?"hub_owner":"partner_owner";
   if(role==="partner_owner"&&(
      viewer.companyKind!=="partner"||viewer.hubCompanyId!==hubId||
      user.accessKind!=="partner"||member.accessKind!=="partner"||
      user.memberType!=="cooperator"||member.memberType!=="cooperator"||
      user.canViewRevenue!==false||member.canViewRevenue!==false||
      user.canViewUnitPrice!==false||member.canViewUnitPrice!==false))BLOCKED();
   if(role==="hub_owner"&&(
      ![undefined,"internal"].includes(user.accessKind)||
      ![undefined,"internal"].includes(member.accessKind)))BLOCKED();
   const checkedPartners=new Map();
   for(const pid of context.approvedCompanyIds.filter(x=>x!==hubId)){
    const [partnerSnap,relationSnap,hubApprovalSnap,partnerApprovalSnap]=
     await Promise.all([
      get(company(pid)),get(collection("partnerRelations").doc(pid)),
      get(company(hubId).collection("rankingApprovals").doc(pid)),
      get(company(pid).collection("rankingApprovals").doc(hubId))
     ]);
    const partner=read(partnerSnap),relation=read(relationSnap);
    if(!partner||partner.companyKind!=="partner"||partner.active!==true||
       partner.hubCompanyId!==hubId||!id(partner.ownerUid)||
       !validRelation(relation,hubId,pid)||
       !verifiedApproval(read(hubApprovalSnap),hubId,hubId,pid,hub.ownerUid)||
       !verifiedApproval(read(partnerApprovalSnap),pid,hubId,pid,partner.ownerUid))
     BLOCKED();
    checkedPartners.set(pid,partner);
   }
   const queries={
    records:collection("records").where("companyId","==",hubId)
     .where("date",">=",win.previousStart).where("date","<=",win.end).limit(2001),
    products:collection("products").where("companyId","==",hubId).limit(301),
    teams:collection("teams").where("companyId","==",hubId).limit(151),
    members:company(hubId).collection("members").limit(1001)
   };
   const [recordSnap,productSnap,teamSnap,hubMembers]=await Promise.all([
    get(queries.records),get(queries.products),get(queries.teams),get(queries.members)
   ]);
   const originalRecords=docRows(recordSnap,2000);
   const originalProducts=docRows(productSnap,300);
   const ownTeams=docRows(teamSnap,150);
   const ownMembers=docRows(hubMembers,1000);
   const teamMap=new Map(),roster=new Map(),productMap=new Map();
   for(const s of ownTeams){
    const t=read(s);
    if(!id(s.id)||!t||t.companyId!==hubId||teamMap.has(s.id))BLOCKED();
    teamMap.set(s.id,{id:s.id,name:name(t.name),goalCount:null});
   }
   for(const s of ownMembers){
    const m=read(s);
    if(!id(s.id)||!m)BLOCKED();
    if(m.active===false)continue;
    const uid=s.id;
    const display=typeof m.name==="string"&&m.name.trim()?name(m.name):
     typeof m.memberName==="string"&&m.memberName.trim()?name(m.memberName):"担当者";
    if(id(m.teamId)&&teamMap.has(m.teamId))
     roster.set(uid,{uid,teamId:m.teamId,name:display});
   }
   for(const s of originalProducts){
    if(!id(s.id)||productMap.has(s.id))BLOCKED();
    productMap.set(s.id,projectPublicProduct({id:s.id,...read(s)}));
   }
   const headers=[],lines=[],seenOwnerDays=new Set();
   for(const s of originalRecords){
    if(!id(s.id))BLOCKED();
    const raw={...read(s),id:s.id};
    if(raw.companyId!==hubId)BLOCKED();
    const k=raw.uid+":"+raw.date;
    if(seenOwnerDays.has(k))BLOCKED();
    seenOwnerDays.add(k);
    const h=projectPublicRecordHeader(raw);
    if(!teamMap.has(h.teamId))
     teamMap.set(h.teamId,{id:h.teamId,name:name(
       h.teamNameSnapshot||"過去所属班"),goalCount:null});
    if(!roster.has(h.uid))
     roster.set(h.uid,{uid:h.uid,name:name(h.memberNameSnapshot||"担当者"),
      teamId:h.teamId});
    headers.push(h);lines.push(...projectPublicRecordLines(raw));
   }
   assertPublicSchema("publicRecords",headers);
   assertPublicSchema("publicRecordLines",lines);
   const ownSource={companyId:hubId,companyLabel:name(hub.name),kind:"own",
    consentVerified:true,isComplete:true,readTime:iso,
    teams:[...teamMap.values()],records:headers,lines,
    products:[...productMap.values()],roster:[...roster.values()],
    completeWindows:{current:true,previous:true}};
   const partnerSources=[];
   const unidentified=[];
   for(const [pid,partner] of checkedPartners){
    const base=company(pid),teamsRef=base.collection("partnerWorkTeams"),
     staffRef=base.collection("partnerWorkStaff"),
     entryRef=base.collection("partnerWorkEntries");
    const [teamRows,staffRows,entryRows,...daySnaps]=await Promise.all([
     get(teamsRef.limit(151)),get(staffRef.limit(301)),
     get(entryRef.where("date",">=",win.previousStart)
       .where("date","<=",win.end).limit(2001)),
     ...allDays.map(day=>get(company(hubId).collection("partnerWorkCountDays")
       .doc(day).collection("reports").doc(pid)))
    ]);
    const teams=new Map(),staff=new Map(),records=[],pLines=[],
     daily=new Map();
    for(const t of docRows(teamRows,150)){
     const row=read(t);
     if(!id(t.id)||!row||row.companyId!==pid||teams.has(t.id))BLOCKED();
     teams.set(t.id,{id:t.id,name:name(row.name),goalCount:null});
    }
    for(const t of docRows(staffRows,300)){
     const row=read(t);
     if(!id(t.id)||!row||row.companyId!==pid)BLOCKED();
     if(!id(row.teamId)||!teams.has(row.teamId))continue;
     staff.set(t.id,{uid:t.id,name:name(row.name),teamId:row.teamId});
    }
    const unique=new Set();
    for(const entry of docRows(entryRows,2000)){
     const row=read(entry),day=row?.date,uid=row?.staffId;
     if(!row||!id(uid)||!id(row.teamIdSnapshot)||!row.counts||
        row.companyId!==pid||row.hubCompanyId!==hubId||
        entry.id!==day+"__"+uid||unique.has(entry.id)||
        !Number.isSafeInteger(row.version)||row.version<1||
        row.version>999||row.totalCount!==countMap(row.counts))BLOCKED();
     unique.add(entry.id);
     if(!teams.has(row.teamIdSnapshot))teams.set(row.teamIdSnapshot,{
      id:row.teamIdSnapshot,name:name(row.teamNameSnapshot||"過去所属班"),
      goalCount:null
     });
     if(!staff.has(uid))staff.set(uid,{uid,
      name:name(row.staffNameSnapshot||"担当者"),teamId:row.teamIdSnapshot});
     records.push({companyId:pid,sourceId:entry.id,uid,date:day,
      teamId:row.teamIdSnapshot,totalCount:row.totalCount,
      reportStatus:row.totalCount===0?"no_result":"submitted",
      memberNameSnapshot:name(row.staffNameSnapshot||"担当者"),
      teamNameSnapshot:teams.get(row.teamIdSnapshot).name,workLocation:""});
     for(let i=0;i<KEYS.length;i++){
      const n=number(row.counts[KEYS[i]]);
      if(n>0)pLines.push({
       companyId:pid,sourceId:entry.id+"__"+String(i).padStart(4,"0"),
       recordId:entry.id,date:day,uid,teamId:row.teamIdSnapshot,
       productId:PARTNER_RANK_SKUS[i].id,count:n
      });
     }
     if(!daily.has(day))daily.set(day,Object.fromEntries(KEYS.map(x=>[x,0])));
     for(const k of KEYS)daily.get(day)[k]+=row.counts[k];
    }
    for(let i=0;i<allDays.length;i++){
     const snap=daySnaps[i],day=allDays[i];
     if(!snap.exists){
      if(daily.has(day))BLOCKED();
      continue;
     }
     const row=read(snap);
     if(!row||row.source!=="staff-entries-v1"||
        row.hubCompanyId!==hubId||row.partnerCompanyId!==pid||
        row.date!==day||row.totalCount!==countMap(row.counts))BLOCKED();
     const wanted=daily.get(day);
     if(!wanted||KEYS.some(k=>row.counts[k]!==wanted[k]))BLOCKED();
    }
    const pProducts=PARTNER_RANK_SKUS.map(s=>({
     companyId:pid,sourceId:s.id,name:s.name,active:true,sortOrder:0
    }));
    assertPublicSchema("publicRecords",records);
    assertPublicSchema("publicRecordLines",pLines);
    assertPublicSchema("publicProducts",pProducts);
    partnerSources.push({
     companyId:pid,companyLabel:name(partner.name),kind:"partner",
     consentVerified:true,isComplete:true,readTime:iso,
     teams:[...teams.values()],roster:[...staff.values()],
     records,lines:pLines,products:pProducts,
     completeWindows:{current:true,previous:true}
    });
   }
   const productGroups=await loadCanonicalMapping({
    tx,hubCompanyId:hubId,approvedCompanyIds:context.approvedCompanyIds,
    readTime:iso
   });
   if(!Array.isArray(productGroups))BLOCKED();
   return buildVerifiedCountDashboard({
    context:{...context,role},hubCompanyId:hubId,
    approvedCompanyIds:context.approvedCompanyIds,
    period,filters,sources:[ownSource,...partnerSources],
    productGroups,unassigned:unidentified
   });
  },{readOnly:true});
 };
}
