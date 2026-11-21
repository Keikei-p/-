/**
 * STAGING ONLY / NO DEPLOY. Count-only optional partner tab reader.
 * This is called ONLY inside store.readPublishedOptional's read-only
 * transaction, AFTER current trusted membership and Owner policy checks.
 * Existing getPartnerWorkspace remains the count entry / correction API.
 */
const KEYS=Object.freeze(["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"]);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MONEY=/(?:売上|単価|収益|利益|報酬|原価|価格|キャッシュバック|[¥￥$€]|[0-9０-９][0-9０-９.,，]*\s*(?:円|万円)|revenue|unit[\s_-]*price|cash[\s_-]*back|\bCB\s*[:=_-]?\s*[0-9０-９])/i;
const SCHEMA="nico-published-partner-optional-v1";
const stop=()=>{throw Error("PARTNER_OPTIONAL_COUNT_ACCESS_UNVERIFIED");};
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const validId=x=>typeof x==="string"&&ID.test(x)&&
 !["__proto__","constructor","prototype"].includes(x);
const name=x=>typeof x==="string"&&x.trim()===x&&x.length>0&&
 x.length<=80&&!MONEY.test(x.normalize("NFKC"))&&
 !/[\r\n\t\u0000-\u001f\u007f@]/.test(x);
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=9999;
const sum=n=>Number.isSafeInteger(n)&&n>=0;
function exactCounts(value){
 if(!plain(value)||Object.keys(value).length!==KEYS.length||
    KEYS.some(k=>!Object.hasOwn(value,k)||!count(value[k])))stop();
 const total=KEYS.reduce((n,k)=>n+value[k],0);
 if(!sum(total))stop();
 return {counts:Object.fromEntries(KEYS.map(k=>[k,value[k]])),total};
}
function docs(query,size){
 if(!query||!Array.isArray(query.docs)||query.docs.length>size)stop();
 return query.docs;
}
function rowForStaff(staff,identity){
 if(!validId(staff?.id)||!plain(staff.data)||!name(staff.data.name)||
    staff.data.companyId!==identity.partner||
    !["account","managed"].includes(staff.data.kind)||
    typeof staff.data.active!=="boolean")stop();
 if(identity.role==="member")return staff.data.kind==="account"&&
  staff.data.uid===identity.uid&&staff.data.teamId===identity.teamId;
 return true; // authenticated partner owner/leader scope as in getPartnerWorkspace
}
/**
 * Caller MUST use a true Firestore transaction. All three source collections
 * are partner-local; this reader never touches financial or other companies.
 */
export async function readPublishedPartnerOptionalTab({
 tx,db,identity,tab,date
}={}){
 if(!tx||typeof tx.get!=="function"||!db||typeof db.collection!=="function"||
    !plain(identity)||!validId(identity.partner)||!validId(identity.hub)||
    !validId(identity.uid)||!["owner","leader","member"].includes(identity.role)||
    (identity.role!=="owner"&&!validId(identity.teamId))||
    !name(identity.companyName)||typeof date!=="string"||
    !/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)||
    new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date||
    !["report","daily","history","goal"].includes(tab))stop();
 const company=db.collection("companies").doc(identity.partner);
 const staffRef=company.collection("partnerWorkStaff").limit(151);
 const countsRef=company.collection("partnerWorkEntries").where("date","==",date).limit(201);
 const [staffList,entryList]=await Promise.all([tx.get(staffRef),tx.get(countsRef)]);
 const staffRows=docs(staffList,150),entries=docs(entryList,200);
 const eligible=new Map();
 for(const entry of staffRows){
  const data=entry.data?.();
  const staff={id:entry.id,data};
  if(rowForStaff(staff,identity))eligible.set(entry.id,{id:entry.id,...data});
 }
 const products=Object.fromEntries(KEYS.map(k=>[k,0]));
 const stored=new Map(),lineItems=[];
 for(const item of entries){
  const row=item.data?.();
  if(!plain(row)||!validId(row.staffId)||!validId(item.id)||
     row.companyId!==identity.partner||row.date!==date||
     row.hubCompanyId!==identity.hub||!sum(row.totalCount)||
     !Number.isSafeInteger(row.version)||row.version<1||row.version>999)stop();
  if(!eligible.has(row.staffId))continue; // never return another member's rows
  if(item.id!==date+"__"+row.staffId||stored.has(row.staffId))stop();
  const {counts,total}=exactCounts(row.counts);
  if(total!==row.totalCount)stop();
  stored.set(row.staffId,{...row,counts});
  for(const k of KEYS){
   products[k]+=counts[k];if(!sum(products[k]))stop();
  }
  lineItems.push({staffId:row.staffId,name:eligible.get(row.staffId).name,
   version:row.version,totalCount:total});
 }
 const totalCount=lineItems.reduce((n,x)=>n+x.totalCount,0);
 if(!sum(totalCount))stop();
 const reportStatus=lineItems.length===0?"未報告":
  totalCount===0?"確定0件":"報告済";
 const base={schema:SCHEMA,tab,date,companyName:identity.companyName,
  reportStatus,totalCount,reportedStaffCount:lineItems.length};
 if(tab==="history"){
  const auditRef=company.collection("partnerWorkAudits")
   .where("date","==",date).limit(501);
  const auditRows=docs(await tx.get(auditRef),500);
  const history=[],seen=new Set();
  for(const item of auditRows){
   const row=item.data?.();
   if(!plain(row)||row.companyId!==identity.partner||
      row.hubCompanyId!==identity.hub||row.date!==date||
      !validId(row.staffId)||!Number.isSafeInteger(row.version)||
      row.version<1||row.version>999||!sum(row.totalCount))stop();
   if(!eligible.has(row.staffId))continue;
   if(item.id!==date+"__"+row.staffId+"__v"+row.version)stop();
   const key=row.staffId+"|"+row.version;
   if(seen.has(key))stop();seen.add(key);
   const prev=exactCounts(row.previousCounts);
   const next=exactCounts(row.counts);
   if(next.total!==row.totalCount)stop();
   // Never serialize privateCounts, workLocation, correctionReason,
   // actor emails, timestamps or financial classification originals.
   // The audit's original display name wins over a later staff rename.
   // Legacy audits with no name snapshot remain readable but never mutate.
   const historicalName=row.staffNameSnapshot??eligible.get(row.staffId).name;
   if(!name(historicalName))stop();
   history.push({staffId:row.staffId,staffName:historicalName,
    version:row.version,previousTotalCount:prev.total,totalCount:next.total,
    previousCounts:prev.counts,counts:next.counts});
  }
  history.sort((a,b)=>a.staffId.localeCompare(b.staffId)||a.version-b.version);
  return {...base,audits:history};
 }
 const categories=KEYS.map(name=>({name,count:products[name]}));
 if(tab==="daily")return {...base,products:categories};
 if(tab==="goal")return {...base,actualCount:totalCount};
 const lines=[
  identity.companyName+"｜"+date+" 営業実績報告",
  "報告状況："+reportStatus,
  "総件数："+totalCount+"件",
  "報告した担当者："+lineItems.length+"人",
  ...categories.filter(p=>p.count>0).map(p=>p.name+"："+p.count+"件")
 ];
 return {...base,lines};
}
