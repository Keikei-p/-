/**
 * STAGING ONLY / NO DEPLOY.
 * Pure browser-side adapter: the caller must inject two explicitly reviewed
 * Firebase httpsCallable functions. Nothing here creates or discovers a
 * production endpoint, exposes finance, or stores credentials.
 *
 * A verified owner session is still NOT an authorization decision; the
 * backend must independently run trusted-auth.cjs for every invocation.
 */
import {COUNT_KEYS,SB_PARTS,verifiedCount,normalizedSplit} from "./owner-ui.mjs";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/(?:単価|売上|収益|利益|報酬|原価|価格|キャッシュバック|cash\s*back|revenue|unit\s*price|commission|(?:^|[^A-Za-z])CB(?:$|[^A-Za-z])|[¥￥$€]|[0-9][0-9,.]*\s*(?:万|千)?円)/i;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const keys=(value,allowed)=>object(value)&&
 Object.keys(value).sort().join("|")===allowed.slice().sort().join("|");
const safeId=x=>typeof x==="string"&&ID.test(x);
const total=x=>Object.values(x).reduce((a,n)=>a+n,0);
const fail=code=>{throw Error("OWNER_CORRECTION_"+code)};

function safeCounts(raw){
 if(!keys(raw,COUNT_KEYS))fail("COUNT_SCHEMA_UNVERIFIED");
 try{
  return Object.fromEntries(COUNT_KEYS.map(key=>[key,verifiedCount(raw[key])]));
 }catch{fail("COUNT_SCHEMA_UNVERIFIED")}
}
function safeSplit(counts,raw){
 try{return normalizedSplit(counts["SB光・AIR"],raw)}
 catch{fail("SPLIT_UNVERIFIED")}
}
function safeRow(row){
 if(!keys(row,[
  "staffId","staffName","teamIdSnapshot","counts","totalCount",
  "version","sbBreakdown"
 ])||!safeId(row.staffId)||typeof row.staffName!=="string"||
    row.staffName.length>60||MONEY.test(row.staffName.normalize("NFKC"))||
    !(row.teamIdSnapshot===null||safeId(row.teamIdSnapshot))||
    !Number.isSafeInteger(row.version)||row.version<1||row.version>999)
  fail("ROW_UNVERIFIED");
 const counts=safeCounts(row.counts);
 if(row.totalCount!==total(counts))fail("TOTAL_UNVERIFIED");
 const sbBreakdown=safeSplit(counts,row.sbBreakdown);
 return {staffId:row.staffId,staffName:row.staffName,
  teamIdSnapshot:row.teamIdSnapshot,counts,totalCount:row.totalCount,
  version:row.version,sbBreakdown};
}
function safeList(raw,expected){
 if(!keys(raw,[
  "role","scope","date","partnerCompanyId","entries",
  "sbBreakdownSchema","containsFinance"
 ])||raw.role!=="hub"||raw.scope!=="existing-partner-counts-only"||
    raw.date!==expected.date||raw.partnerCompanyId!==expected.partnerCompanyId||
    raw.sbBreakdownSchema!=="sb-separated-v1"||
    raw.containsFinance!==false||
    !Array.isArray(raw.entries)||raw.entries.length>200)
  fail("LIST_UNVERIFIED");
 const entries=raw.entries.map(safeRow);
 if(new Set(entries.map(r=>r.staffId)).size!==entries.length)
  fail("DUPLICATE_STAFF");
 return {role:"hub",scope:"existing-partner-counts-only",
  date:expected.date,partnerCompanyId:expected.partnerCompanyId,
  sbBreakdownSchema:"sb-separated-v1",containsFinance:false,entries};
}
function safeWriteRequest(raw){
 if(!keys(raw,[
  "date","partnerCompanyId","staffId","expectedVersion",
  "counts","sbBreakdown","correctionReason"
 ])||!DATE.test(raw.date)||!safeId(raw.partnerCompanyId)||
    !safeId(raw.staffId)||!Number.isSafeInteger(raw.expectedVersion)||
    raw.expectedVersion<1||raw.expectedVersion>=999||
    typeof raw.correctionReason!=="string"||
    raw.correctionReason.length<6||raw.correctionReason.length>120||
    /[\r\n]/.test(raw.correctionReason)||MONEY.test(raw.correctionReason.normalize("NFKC")))
  fail("REQUEST_UNVERIFIED");
 const counts=safeCounts(raw.counts),split=safeSplit(counts,raw.sbBreakdown);
 return {date:raw.date,partnerCompanyId:raw.partnerCompanyId,
  staffId:raw.staffId,expectedVersion:raw.expectedVersion,
  counts,sbBreakdown:split,correctionReason:raw.correctionReason};
}
function safeWriteResult(raw,req){
 if(!keys(raw,[
  "saved","scope","partnerCompanyId","staffId","date",
  "version","totalCount","containsFinance"
 ])||raw.saved!==true||raw.scope!=="hub-owner-existing-only"||
    raw.partnerCompanyId!==req.partnerCompanyId||raw.staffId!==req.staffId||
    raw.date!==req.date||raw.version!==req.expectedVersion+1||
    raw.totalCount!==total(req.counts)||raw.containsFinance!==false)
  fail("WRITE_RESULT_UNVERIFIED");
 return {saved:true,scope:"hub-owner-existing-only",
  partnerCompanyId:req.partnerCompanyId,staffId:req.staffId,
  date:req.date,version:raw.version,totalCount:raw.totalCount,
  containsFinance:false};
}

export function makeOwnerCorrectionClient({
 auth,listCallable,correctCallable,enabled=()=>false
}={}){
 if(!auth||typeof listCallable!=="function"||
    typeof correctCallable!=="function"||typeof enabled!=="function")
  fail("DEPENDENCIES");
 let disposed=false,writeBusy=false;
 async function session(){
  if(disposed||enabled()!==true)fail("DISABLED");
  const user=auth.currentUser;
  if(!user||!safeId(user.uid)||user.emailVerified!==true||
     typeof user.email!=="string"||typeof user.getIdTokenResult!=="function")
   fail("SIGNIN_REQUIRED");
  let claims;
  try{claims=(await user.getIdTokenResult()).claims}
  catch{fail("SESSION_UNVERIFIED")}
  if(!claims||claims.email_verified!==true||
     typeof claims.email!=="string"||
     claims.email.toLowerCase()!==user.email.toLowerCase()||
     auth.currentUser!==user||disposed||enabled()!==true)
   fail("SESSION_UNVERIFIED");
  return user;
 }
 function current(user){
  if(disposed||enabled()!==true||auth.currentUser!==user||
     auth.currentUser?.emailVerified!==true)
   fail("STALE_SESSION");
 }
 async function list(input){
  if(!keys(input,["date","partnerCompanyId"])||
     !DATE.test(input.date)||!safeId(input.partnerCompanyId))
   fail("REQUEST_UNVERIFIED");
  const req={date:input.date,partnerCompanyId:input.partnerCompanyId};
  const user=await session();
  current(user);
  let response;
  try{response=await listCallable(req)}
  catch{fail("LIST_FAILED")}
  current(user);
  return safeList(response?.data,req);
 }
 async function correct(input){
  const req=safeWriteRequest(input);
  if(writeBusy)fail("WRITE_BUSY");
  const user=await session();
  current(user);
  if(writeBusy)fail("WRITE_BUSY");
  writeBusy=true;
  try{
   let response;
   try{response=await correctCallable(req)}
   catch{fail("WRITE_UNCERTAIN_RELOAD_ONLY")}
   current(user);
   return safeWriteResult(response?.data,req);
  }finally{writeBusy=false}
 }
 return Object.freeze({
  list,correct,
  dispose(){disposed=true}
 });
}
