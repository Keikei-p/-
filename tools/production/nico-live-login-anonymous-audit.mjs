// Public anonymous GET only. No Firebase credentials, Auth request, Firestore,
// product/record reads, session mutation, deployment or code execution.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
const URL_BASE="https://nico-factory.web.app";
const PAGES=[
  {key:"home",path:"/",markers:["id=\"authScreen\"","onAuthStateChanged(","signInWithEmailAndPassword(","checkLegacyEntryAgainstServer","openSameAppPartnerWorkspace"]},
  {key:"selfcheck",path:"/login-self-check.html",markers:["loginForm","signInWithEmailAndPassword(","getDocFromServer("]},
  {key:"partner",path:"/partner-workspace.html",markers:["getPartnerWorkspace","submitPartnerWorkspaceCounts"]}
];
export async function inspectPublicLogin({fetcher=fetch,root=URL_BASE}={}){
 if(root!==URL_BASE)throw Error("PUBLIC_LOGIN_AUDIT_HOST_DRIFT");
 const statuses={};
 for(const p of PAGES){
  let resp;
  try{resp=await fetcher(root+p.path+"?audit="+Date.now()+"-"+p.key,{
    redirect:"follow",cache:"no-store",credentials:"omit",
    headers:{"Cache-Control":"no-cache"},signal:AbortSignal.timeout(15000)});
  }catch(e){statuses[p.key]={reachable:false,error:e?.name||"network-error"};continue;}
  const body=await resp.text();
  const mime=resp.headers?.get?.("content-type")||"";
  statuses[p.key]={
   status:resp.status,html:mime.includes("text/html"),
   bytes:Buffer.byteLength(body),
   sha256:createHash("sha256").update(body).digest("hex"),
   markers:Object.fromEntries(p.markers.map(m=>[m,body.includes(m)])),
   // An HTML SPA rewrite of self-check is NOT successful diagnosis availability.
   dedicated:p.key==="selfcheck"?body.includes('id="loginForm"')&&
     body.includes('id="status"'):undefined,
   probableLoginFailureRoutes:p.key==="home"?{
    userMembershipServerRead:body.includes("checkLegacyEntryAgainstServer"),
    partnerCallableRead:body.includes("openSameAppPartnerWorkspace"),
    errorRecovery:body.includes("ログイン後の読み込みに失敗しました")
   }:undefined
  };
 }
 const local=readFileSync(new URL("../../index.html",import.meta.url));
 const expectedHash=createHash("sha256").update(local).digest("hex");
 statuses.home.repositorySourceMatchesLive=statuses.home.sha256===expectedHash;
 const home=statuses.home;
 return {source:"public-anonymous-get",project:"sales-management-cc116",
  site:root,pages:statuses,
  publicLoginShellPresent:home.status===200&&home.html===true&&
    Object.values(home.markers||{}).every(Boolean),
  // We have NO user token or Firebase Auth; an HTTP200 does not prove login works.
  firebaseUserLoginVerified:false,
  partnerLoginVerified:false,
  requestsMade:3,authenticatedRequests:0,
  firestoreReads:0,firestoreWrites:0,deployments:0};
}
if(process.argv.includes("--read-only")){
 const r=await inspectPublicLogin();
 console.log(JSON.stringify(r,null,2));
 if(!r.publicLoginShellPresent)process.exitCode=1;
}
