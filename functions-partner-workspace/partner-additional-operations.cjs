"use strict";
// Isolated NEW product ledger; copied from reviewed partner product source.
// Does NOT write old 9-category entries, summaries, original sales/CB or history.
const {loadPublication,projectMasterProducts}=require("./catalog-publication.cjs");
const {readLinks}=require("./catalog-count-links.cjs");
const {normalizeExtraCounts,applyExtraCounts,projectedExtraRead}=
 require("./additional-counts.cjs");
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const legacyAliases=["NURO","NURO光","ニューロ","ニューロ光","SBMNP",
 "YMMNP","YM純新規","SB光・AIR","SB光AIR","SB光","ソフトバンク光",
 "ソフトバンクAIR","ウォーター","ウォーターサーバー","フレシャス",
 "つばさ・HTB","つばさ電気","HTBエナジー",
 "太陽光・蓄電池AP","U-NEXT","UNEXT"];
const norm=x=>String(x||"").normalize("NFKC").toUpperCase()
 .replace(/[\s　・、，,./／+＋_-]/g,"");
const legacyKeys=new Set(legacyAliases.map(norm));
const isLegacyCategoryName=name=>legacyKeys.has(norm(name));
function makePartnerAdditionalOperations({db,actor,scope,collection,fail,FieldValue,
 validDate,validName,canStaff,jstToday,KEYS}={}){
 if(!db||typeof actor!=="function"||typeof scope!=="function"||
    typeof collection!=="function"||typeof fail!=="function"||
    typeof validDate!=="function"||typeof validName!=="function"||
    typeof canStaff!=="function"||typeof jstToday!=="function"||
    !Array.isArray(KEYS)||KEYS.length!==9||!FieldValue)
  throw Error("PARTNER_ADDITIONAL_DEPENDENCY_INVALID");
 const clean=x=>typeof x==="string"?x.trim():"";
 const publicationRef=hub=>collection(hub,"partnerCatalogSettings").doc("publication");
 const countLinksRef=hub=>collection(hub,"partnerCatalogSettings").doc("countLinks");
 const staffRef=(cid,id)=>collection(cid,"partnerWorkStaff").doc(id);
 const teamRef=(cid,id)=>collection(cid,"partnerWorkTeams").doc(id);
 const entryRef=(cid,date,id)=>collection(cid,"partnerWorkEntries").doc(date+"__"+id);
 const extraEntryRef=(cid,date,id)=>collection(cid,"partnerAdditionalCountEntries").doc(date+"__"+id);
 const extraUsageRef=(hub,id)=>collection(hub,"partnerAdditionalProductUsage").doc(id);
 async function approvedExtraCatalog(s,tx=null){
  if(s.kind!=="partner")fail();
  const get=ref=>tx?tx.get(ref):ref.get(),hub=s.hubId;
  const [master,pubDoc,linksDoc]=await Promise.all([
   get(db.collection("products").where("companyId","==",hub).limit(1001)),
   get(publicationRef(hub)),get(countLinksRef(hub))
  ]);
  if(master.size>1000)fail("resource-exhausted");
  if(master.docs.some(doc=>doc.data()?.companyId!==hub))fail("data-loss");
  let products,linked;
  try{
   const pub=loadPublication(pubDoc.exists?pubDoc.data():null);
   const links=readLinks(linksDoc.exists?linksDoc.data():null,KEYS);
   linked=new Set(links.links.map(link=>link.productId));
   products=projectMasterProducts(master.docs.map(doc=>({...doc.data(),id:doc.id})),
    pub.productIds,true).filter(product=>!linked.has(product.id)&&
      !isLegacyCategoryName(product.name))
    .map(({id,name,sortOrder})=>({id,name,sortOrder}));
  }catch{fail("data-loss");}
  const blocked=new Set([...linked]);
  for(const doc of master.docs){
   if(isLegacyCategoryName(doc.data()?.name))blocked.add(doc.id);
  }
  return {products,blockedIds:[...blocked]};
 }
 async function viewAdditionalCounts(request){
  const a=await actor(request),d=request?.data||{},date=validDate(d.date);
  if(Object.keys(d).some(key=>!["date","workspaceCompanyId","codeSessionToken"].includes(key)))
   fail("invalid-argument");
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner")fail();
  const catalog=await approvedExtraCatalog(s);
  const [staffSnap,extraSnap]=await Promise.all([
   collection(s.cid,"partnerWorkStaff").limit(151).get(),
   collection(s.cid,"partnerAdditionalCountEntries").where("date","==",date)
    .limit(201).get()
  ]);
  if(staffSnap.size>150||extraSnap.size>200)fail("resource-exhausted");
  const accessible=new Set();
  for(const doc of staffSnap.docs){
   const person=doc.data()||{};
   if(!ID.test(doc.id)||person.companyId!==s.cid||!validName(person.name))
    fail("data-loss");
   if(canStaff(s,person))accessible.add(doc.id);
  }
  const ids=catalog.products.map(p=>p.id);
  const records=[];
  for(const doc of extraSnap.docs){
   const row=doc.data()||{};
   if(row.companyId!==s.cid||row.hubCompanyId!==s.hubId||
    row.date!==date||!ID.test(row.staffId||"")||
    doc.id!==date+"__"+row.staffId||
    !Number.isSafeInteger(row.version)||row.version<1||
    !Number.isSafeInteger(row.totalCount)||row.totalCount<0)fail("data-loss");
   if(!accessible.has(row.staffId))continue;
   let result;
   try{result=projectedExtraRead(row.counts,{visibleIds:ids});}
   catch{fail("data-loss");}
   if(result.totalCount!==row.totalCount)fail("data-loss");
   records.push({staffId:row.staffId,version:row.version,
    counts:result.counts,archivedTotal:result.archivedTotal,
    totalCount:result.totalCount,teamIdSnapshot:row.teamIdSnapshot||null});
  }
  return {scope:"partner_extra_counts",date,role:s.role,
   companyName:s.companyName,products:catalog.products,records};
 }
 async function submitAdditionalCounts(request){
  const a=await actor(request),d=request?.data||{},
   date=validDate(d.date),staffId=clean(d.staffId);
  if(!ID.test(staffId)||!Number.isSafeInteger(d.expectedVersion)||
     d.expectedVersion<0||d.expectedVersion>=999||
     !d.changes||Object.keys(d.changes).length===0)fail("invalid-argument");
  let patch;
  try{patch=normalizeExtraCounts(d.changes);}
  catch{fail("invalid-argument");}
  const s=await scope(a.uid,null,d.workspaceCompanyId);
  if(s.kind!=="partner")fail();
  return db.runTransaction(async tx=>{
   const live=await scope(a.uid,tx,d.workspaceCompanyId);
   if(live.kind!=="partner"||live.cid!==s.cid||live.hubId!==s.hubId)fail();
   const sr=staffRef(s.cid,staffId),er=extraEntryRef(s.cid,date,staffId);
   const [staffSnap,prevSnap,legacySnap,catalog]=await Promise.all([
    tx.get(sr),tx.get(er),tx.get(entryRef(s.cid,date,staffId)),
    approvedExtraCatalog(live,tx)
   ]);
   const person=staffSnap.data()||{},previous=prevSnap.data()||{};
   if(!staffSnap.exists||person.active!==true||person.companyId!==s.cid||
      !validName(person.name)||!canStaff(live,person))fail();
   if(prevSnap.exists){
    if(previous.date!==date||previous.companyId!==s.cid||
       previous.hubCompanyId!==s.hubId||previous.staffId!==staffId||
       !Number.isSafeInteger(previous.version)||previous.version<1||
       previous.version!==d.expectedVersion)fail("aborted");
   }else if(d.expectedVersion!==0)fail("aborted");
   let old,next;
   try{
    old=normalizeExtraCounts(prevSnap.exists?previous.counts:{});
    if(prevSnap.exists&&old.total!==previous.totalCount)
     fail("data-loss");
    next=applyExtraCounts({previous:old.counts,changes:patch.counts,
     allowedIds:catalog.products.map(p=>p.id),blockedLegacyIds:catalog.blockedIds});
   }catch(e){if(e?.code==="data-loss")throw e;fail("failed-precondition");}
   if(JSON.stringify(old.counts)===JSON.stringify(next.counts))
    return {saved:false,unchanged:true,staffId,date,
     version:prevSnap.exists?previous.version:0,totalCount:old.total};
   if(Object.keys(next.counts).length>100)fail("resource-exhausted");
   const usedIds=Object.keys(next.counts).filter(id=>next.counts[id]>0);
   // Permanent usage marker prevents an Owner mapping an already-counted
   // extra product into a legacy bucket (which would double-count it).
   const usedSnaps=await Promise.all(usedIds.map(id=>tx.get(extraUsageRef(s.hubId,id))));
   for(let i=0;i<usedIds.length;i++){
    const doc=usedSnaps[i],value=doc.data()||{};
    if(doc.exists&&(value.hubCompanyId!==s.hubId||value.productId!==usedIds[i]))
     fail("data-loss");
   }
   // A saved historical sales-team snapshot is authoritative. Never attach
   // extra counts for an old date to the worker\u0027s CURRENT team.
   const legacy=legacySnap.data()||{};
   if(legacySnap.exists&&(legacy.companyId!==s.cid||
      legacy.staffId!==staffId||legacy.date!==date))fail("data-loss");
   const teamIdSnapshot=prevSnap.exists?previous.teamIdSnapshot:
    legacySnap.exists?legacy.teamIdSnapshot:
    date===jstToday()?person.teamId:null;
   const staffNameSnapshot=prevSnap.exists?previous.staffNameSnapshot:
    legacySnap.exists?legacy.staffNameSnapshot:
    date===jstToday()?person.name:null;
   if(!ID.test(teamIdSnapshot||"")||!validName(staffNameSnapshot))fail("data-loss");
   if(!prevSnap.exists){
    const team=await tx.get(teamRef(s.cid,teamIdSnapshot));
    if(!team.exists||team.data()?.companyId!==s.cid||team.data()?.active!==true)
      fail("failed-precondition");
   }
   const nowStamp=FieldValue.serverTimestamp(),version=d.expectedVersion+1;
   const row={companyId:s.cid,hubCompanyId:s.hubId,date,staffId,
    counts:next.counts,totalCount:next.total,version,
    staffNameSnapshot,teamIdSnapshot,updatedByUid:a.uid,updatedAt:nowStamp};
   if(prevSnap.exists)tx.update(er,row);
   else tx.create(er,{...row,createdAt:nowStamp});
   const audit=collection(s.cid,"partnerAdditionalCountAudits")
    .doc(date+"__"+staffId+"__v"+version);
   tx.create(audit,{...row,previousCounts:old.counts,
    previousTotalCount:old.total,createdAt:nowStamp});
   for(let i=0;i<usedIds.length;i++){
    if(!usedSnaps[i].exists)
     tx.create(extraUsageRef(s.hubId,usedIds[i]),
      {hubCompanyId:s.hubId,productId:usedIds[i],
       firstCompanyId:s.cid,firstDate:date,createdAt:nowStamp});
   }
   return {saved:true,staffId,date,version,totalCount:next.total};
  });
 }
 // The caller must verify its Owner/partner scope before calling this helper.
 // This does not expose private originals to a browser, only approved IDs/names.
 const getExtraPolicy=hubId=>approvedExtraCatalog({kind:"partner",hubId});
 return Object.freeze({viewAdditionalCounts,submitAdditionalCounts,getExtraPolicy});
}
module.exports={makePartnerAdditionalOperations,isLegacyCategoryName};
