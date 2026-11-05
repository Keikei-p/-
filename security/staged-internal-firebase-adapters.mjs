/**
 * NO DEPLOY: actual Firebase Admin Auth/Firestore ACL adapters and a
 * read-only REST transport. Inject live SDK clients/credentials only from
 * a future reviewed server entrypoint; never initialize or deploy here.
 */
import {createFirebaseIdTokenVerifier} from './firebase-id-token-verifier.mjs';
import {createStagedInternalCountReadGateway} from './staged-internal-count-read-gateway.mjs';
import {createStagedInternalFirestoreReader,buildStagedInternalRunQuery} from './staged-internal-firestore-reader.mjs';

const URL='https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)/documents:runQuery';
const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const deny=()=>{throw Error('STAGED_INTERNAL_FIREBASE_ADAPTER_DENIED');};
function pathAllowed(path){
 if(typeof path!=='string'||path.length>410)deny();
 const p=path.split('/');
 if(p.length===2&&['users','companies','partnerWorkspaceContexts'].includes(p[0])&&ID.test(p[1]))return path;
 if(p.length===4&&p[0]==='companies'&&ID.test(p[1])&&p[2]==='members'&&ID.test(p[3]))return path;
 deny();
}
/**
 * No generic Firestore proxy: reconstruct the exact allowlisted query
 * shape and reject additional selected fields, OR filters, altered indexes,
 * missing company/day constraints or a forged cursor. This predicate is
 * independent of (and additional to) the signed-user ACL.
 */
export function assertStagedInternalTransportQuery(q){
 if(!q||q.method!=='POST'||q.endpoint!==URL||!q.body?.structuredQuery)deny();
 const sq=q.body.structuredQuery;
 const table=sq.from?.length===1?sq.from[0].collectionId:null;
 if(!['products','records'].includes(table)||
   sq.limit!==(table==='products'?201:51))deny();
 let companyId,day,cursor='';
 if(table==='products'){
  companyId=sq.where?.fieldFilter?.value?.stringValue;
 }else{
  const f=sq.where?.compositeFilter?.filters;
  if(!Array.isArray(f)||f.length!==2)deny();
  companyId=f[0].fieldFilter?.value?.stringValue;
  day=f[1].fieldFilter?.value?.stringValue;
  if(sq.startAt!==undefined){
   const path=sq.startAt?.values?.[0]?.referenceValue;
   const prefix='projects/sales-management-cc116/databases/(default)/documents/records/';
   if(typeof path!=='string'||!path.startsWith(prefix))deny();
   cursor=path.slice(prefix.length);
  }
 }
 let canonical;
 try{
  canonical=buildStagedInternalRunQuery({
   table,companyId,...(table==='records'?{day,cursor}:{}),
   snapshotTime:q.body.readTime??null,limit:sq.limit
  });
 }catch{deny();}
 if(JSON.stringify(q)!==JSON.stringify(canonical))deny();
 return q;
}

export function createStagedInternalFirebaseAdapters({
 auth,db,getAccessToken,fetchFirestore
}={}){
 if(typeof auth?.getUser!=='function'||typeof db?.doc!=='function'||
    typeof getAccessToken!=='function'||typeof fetchFirestore!=='function')deny();
 const loadAuthUser=async uid=>{
  if(typeof uid!=='string'||!ID.test(uid))deny();
  return auth.getUser(uid);
 };
 const readDocument=async path=>{
  const doc=await db.doc(pathAllowed(path)).get();
  if(!doc||typeof doc.exists!=='boolean')deny();
  return doc.exists?doc.data():null;
 };
 const executeRunQuery=async request=>{
  const query=assertStagedInternalTransportQuery(request);
  const token=await getAccessToken();
  if(typeof token!=='string'||token.length<20||/[\r\n]/.test(token))deny();
  const result=await fetchFirestore(URL,{
   method:'POST',redirect:'error',
   headers:{Authorization:'Bearer '+token,
    'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify(query.body)
  });
  if(!result||result.ok!==true||typeof result.json!=='function')deny();
  const rows=await result.json();
  if(!Array.isArray(rows)||rows.length>202)deny();
  return rows;
 };
 return Object.freeze({loadAuthUser,readDocument,
  loadCountPage:createStagedInternalFirestoreReader({executeRunQuery})});
}
export function createStagedInternalFirebaseCountGateway({
 enabled=false,auth,db,getAccessToken,fetchFirestore,
 fetchKeys,subtle,nowSeconds
}={}){
 // Disabled gateway cannot initialize credentials or touch any private data.
 if(enabled!==true)return createStagedInternalCountReadGateway();
 const deps=createStagedInternalFirebaseAdapters({auth,db,getAccessToken,fetchFirestore});
 const authenticateBearer=createFirebaseIdTokenVerifier({
  projectId:'sales-management-cc116',fetchKeys,subtle,nowSeconds});
 return createStagedInternalCountReadGateway({
  enabled:true,authenticateBearer,...deps});
}
