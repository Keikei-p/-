/**
 * NO DEPLOY: actual Firebase Admin Auth/Firestore ACL adapters and a
 * read-only REST transport. Inject live SDK clients/credentials only from
 * a future reviewed server entrypoint; never initialize or deploy here.
 */
import {createFirebaseIdTokenVerifier} from './firebase-id-token-verifier.mjs';
import {createStagedInternalCountReadGateway} from './staged-internal-count-read-gateway.mjs';
import {createStagedInternalFirestoreReader} from './staged-internal-firestore-reader.mjs';

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
function queryAllowed(q){
 if(!q||q.method!=='POST'||q.endpoint!==URL||!q.body?.structuredQuery)deny();
 const structure=q.body.structuredQuery;
 const table=structure.from?.length===1?structure.from[0].collectionId:null;
 if(!['products','records'].includes(table)||structure.limit!==(table==='products'?201:50)||
   structure.from[0].allDescendants===true)deny();
 // This is a transport for one internal query family, never a client proxy.
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
  const query=queryAllowed(request);
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
