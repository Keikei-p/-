/**
 * NO DEPLOY. Server-side, count-only bridge for historical internal records.
 * Reuses the existing projection without rewriting originals or publishing
 * raw prices. Dependencies must be SERVER-OWNED Admin/verification adapters.
 *
 * A real adapter must query a bounded company/day page at ONE snapshot, sort
 * strictly by document ID, and supply a fully verified product catalog.
 * No Firebase initialization, credentials, or browser bundle here.
 */
import {projectLegacyCountDay} from './legacy-internal-count-bridge.mjs';

const ORIGIN='https://nico-factory.web.app';
const ROUTE='/v1/internal-counts';
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const TOKEN=/^Bearer ([A-Za-z0-9._-]{20,12000})$/;
const MAX_PAGE=50;
const deny=status=>{throw Object.assign(new Error('internal_counts_blocked'),{status});};
const validId=v=>typeof v==='string'&&ID.test(v);
function validDay(day){
 if(typeof day!=='string'||!DATE.test(day))return false;
 const d=new Date(day+'T00:00:00Z');
 return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===day;
}
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function answer(status,body,origin){
 const headers={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'};
 if(origin===ORIGIN)headers['Access-Control-Allow-Origin']=ORIGIN;
 return new Response(JSON.stringify(body),{status,headers});
}
function checkAccount(account,auth){
 if(!plain(account)||account.uid!==auth.uid||account.disabled!==false||
   account.emailVerified!==true||!Number.isSafeInteger(auth.authTime)||
   auth.authTime<1||typeof account.tokensValidAfterTime!=='string')deny(403);
 const after=Date.parse(account.tokensValidAfterTime);
 if(!Number.isFinite(after)||Math.floor(after/1000)>=auth.authTime)deny(403);
}
function strictInternal(principal){
 const {uid,user,company,member}=principal;
 if(!plain(user)||!plain(company)||!plain(member)||
   user.uid!==uid||member.uid!==uid||
   !validId(user.companyId)||user.companyId!==member.companyId||
   user.active===false||member.active===false||company.active===false||
   user.companyRole!==member.companyRole)deny(403);
 // Match legacy internal identities without inventing any partner rights.
 if(![undefined,'internal'].includes(company.companyKind)||
   ![undefined,'internal'].includes(user.accessKind)||
   ![undefined,'internal'].includes(member.accessKind)||
   ![undefined,'internal','direct','member','managed'].includes(user.memberType)||
   ![undefined,'internal','direct','member','managed'].includes(member.memberType))
   deny(403);
 return user.companyId;
}
export function createStagedInternalCountReadGateway({
 enabled=false,authenticateBearer,loadAuthUser,readDocument,loadCountPage
}={}){
 if(enabled!==true)return async request=>
  answer(503,{error:'service_disabled'},request?.headers?.get?.('Origin')||'');
 if([authenticateBearer,loadAuthUser,readDocument,loadCountPage]
   .some(fn=>typeof fn!=='function'))throw Error('INTERNAL_COUNT_SERVER_ADAPTER_MISSING');
 return async function handle(request){
  const origin=request?.headers?.get?.('Origin')||'';
  try{
   if(!request||request.method!=='GET'||origin!==ORIGIN)deny(403);
   const url=new URL(request.url);
   if(url.protocol!=='https:'||url.origin!==ORIGIN||url.pathname!==ROUTE||
      url.hash)deny(403);
   const q=url.searchParams,keys=[...q.keys()];
   if(keys.length<1||keys.some(k=>!['day','cursor','snapshot'].includes(k))||
      new Set(keys).size!==keys.length)deny(400);
   const day=q.get('day'),cursor=q.get('cursor')||'';
   const snapshot=q.get('snapshot')||'';
   if(!validDay(day)||(cursor&&!validId(cursor))||
      Boolean(cursor)!==Boolean(snapshot)||
      (snapshot&&!TIME.test(snapshot)))deny(400);
   const token=request.headers.get('Authorization')?.match(TOKEN)?.[1];
   if(!token)deny(401);
   let auth;
   try{auth=await authenticateBearer(token);}catch{deny(401);}
   if(!plain(auth)||!validId(auth.uid)||auth.emailVerified!==true)deny(401);
   const account=await loadAuthUser(auth.uid);
   checkAccount(account,auth);
   // A secondary context vetoes the *old internal identity*, even when
   // a stale Owner/Master flag and active=false context still exist.
   const [user,secondary]=await Promise.all([
    readDocument('users/'+auth.uid),
    readDocument('partnerWorkspaceContexts/'+auth.uid)
   ]);
   if(secondary!==null&&secondary!==undefined)deny(403);
   if(!plain(user)||!validId(user.companyId))deny(403);
   const [company,member]=await Promise.all([
    readDocument('companies/'+user.companyId),
    readDocument('companies/'+user.companyId+'/members/'+auth.uid)
   ]);
   const companyId=strictInternal({uid:auth.uid,user,company,member});
   const page=await loadCountPage({
    companyId,day,cursor,snapshotTime:snapshot||null,limit:MAX_PAGE
   });
   // The trusted reader must attest a complete, consistently read slice.
   // Missing pages and stale snapshots are NEVER interpreted as 0 records.
   if(!plain(page)||page.complete!==true||
      !Array.isArray(page.records)||page.records.length>MAX_PAGE||
      !Array.isArray(page.products)||page.products.length>200||
      typeof page.readTime!=='string'||!TIME.test(page.readTime)||
      (snapshot&&snapshot!==page.readTime))deny(503);
   let last=cursor;
   for(const record of page.records){
    if(!plain(record)||!validId(record.id)||record.id<=last||
       record.companyId!==companyId||record.date!==day)deny(503);
    last=record.id;
   }
   const projected=projectLegacyCountDay({
    principal:{uid:auth.uid,companyId,firebaseIdTokenVerified:true,
      emailVerified:true,serverMembershipVerified:true,
      serverVerifiedInternalCompany:true,user,member,company},
    day,readTime:page.readTime,records:page.records,products:page.products
   });
   // Product IDs in the historic record must be confirmed against catalog;
   // no missing products, invented categories or truncated saved totals.
   const ids=new Set(projected.products.map(p=>p.sourceId));
   if(projected.lines.length>2000||
      projected.lines.some(line=>!ids.has(line.productId)))deny(503);
   return answer(200,{
    day,records:projected.records,lines:projected.lines,products:projected.products,
    nextCursor:page.records.length===MAX_PAGE?last:null,
    snapshotTime:page.readTime
   },origin);
  }catch(e){
   return answer(Number.isInteger(e?.status)?e.status:503,
     {error:'request_blocked'},origin);
  }
 };
}
