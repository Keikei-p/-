/**
 * STAGED COUNT-ONLY HTTP GATEWAY (NOT WIRED TO LIVE WORKERS).
 * Implements end-user pagination without letting a browser query finance originals.
 *
 * Deployment adapter responsibilities (NOT client inputs):
 * - authenticateBearer: VERIFY Firebase ID token signature, issuer, audience,
 *   expiry and email verification using Google's public signing keys.
 * - loadMembership: READ BOTH current user and current company-member records;
 *   assert same company, active state, and confirm owner/company ownership.
 * - queryPublicDocuments: QUERY ONLY the specified public collection using
 *   server-side company + (when supplied) team filters and ordered doc IDs.
 *   Never use a browser-supplied Firestore query or raw finance collection.
 *
 * Neither a credential, client-configured role, company ID nor an unrestricted
 * Firestore document is ever returned. Entire read fails closed on bad data.
 */
import {assertPublicSchema} from "./public-projection.mjs";

// The legacy GitHub Pages app is retired. Only the canonical NICO origin
// may receive browser CORS headers; authorization is always checked separately.
const ALLOWED_ORIGINS=new Set([
  "https://nico-factory.web.app"
]);
const COLLECTIONS=new Set([
  "publicRecords","publicRecordLines","publicProducts","publicRankEntries"
]);
const TEAM_SCOPED=new Set(["publicRecords","publicRecordLines"]);
const PUBLIC_PATH="/v1/public-counts";
const MAX_PAGE=50;
const MAX_CURSOR=200;

class Reject extends Error{
  constructor(status=403){super("request_blocked");this.status=status;}
}
function validId(v,max=200){
  return typeof v==="string"&&v.length>=1&&v.length<=max &&
    /^[a-zA-Z0-9_:-]+$/.test(v);
}
function header(request,key){
  return request?.headers?.get?.(key)??null;
}
function response(status,object,origin=""){
  const headers={
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "Vary":"Origin"
  };
  if(ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"]=origin;
  return new Response(JSON.stringify(object),{status,headers});
}
function checkIdentity(identity,authenticated){
  if(!identity || !authenticated || !validId(authenticated.uid,128)
    || identity.uid!==authenticated.uid
    || !validId(identity.companyId,128)
    || identity.userActive!==true||identity.memberActive!==true
    || identity.userCompanyId!==identity.companyId
    || identity.memberCompanyId!==identity.companyId)
    throw new Reject();
  const owner=identity.serverVerifiedOwner===true &&
    identity.companyOwnerUid===authenticated.uid &&
    identity.userCompanyRole==="owner" && identity.memberCompanyRole==="owner";
  const teams=identity.teamIds;
  if(!Array.isArray(teams)||teams.length>100||teams.some(x=>!validId(x,128)) ||
    new Set(teams).size!==teams.length)
    throw new Reject();
  return {companyId:identity.companyId,owner,teams};
}
function safePublicItem(collection,item){
  assertPublicSchema(collection,[item]);
  if(collection==="publicRecords")return {
    sourceId:item.sourceId,date:item.date,teamId:item.teamId,
    totalCount:item.totalCount,reportStatus:item.reportStatus
  };
  if(collection==="publicRecordLines")return {
    sourceId:item.sourceId,recordId:item.recordId,productId:item.productId,
    teamId:item.teamId,date:item.date,count:item.count
  };
  if(collection==="publicProducts")return {
    sourceId:item.sourceId,name:item.name,active:item.active,
    sortOrder:item.sortOrder
  };
  return {
    sourceId:item.sourceId,period:item.period,kind:item.kind,
    displayName:item.displayName,rank:item.rank
  };
}
/**
 * No Work/Cloudflare secrets or Firebase live credentials. Tests pass stubbed
 * trusted adapters and record a safe user-visible response, never raw data.
 */
export function createCountOnlyReadHandler({
  enabled=false,authenticateBearer,loadMembership,queryPublicDocuments
}={}){
  return async request=>{
    const origin=header(request,"Origin")??"";
    try{
      if(enabled!==true)throw new Reject(503);
      if(!request||request.method!=="GET")throw new Reject(405);
      if(origin&&!ALLOWED_ORIGINS.has(origin))throw new Reject();
      if(typeof request.url!=="string")throw new Reject(400);
      const url=new URL(request.url);
      if(url.pathname!==PUBLIC_PATH)throw new Reject(404);
      const params=url.searchParams;
      const keys=[...params.keys()];
      if(keys.some(k=>!["collection","teamId","cursor","limit","snapshot"].includes(k))
        || new Set(keys).size!==keys.length)throw new Reject(400);
      const collection=params.get("collection");
      if(!COLLECTIONS.has(collection))throw new Reject(400);
      const teamId=params.get("teamId"),cursor=params.get("cursor")??"";
      const snapshot=params.get("snapshot")??"";
      // Multi-page list must use one consistent Firestore read timestamp.
      // A backend that cannot pin snapshots must refuse, not show partial totals.
      if(Boolean(cursor)!==Boolean(snapshot) ||
        (snapshot&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(snapshot)))
        throw new Reject(400);
      if(cursor&&!validId(cursor,MAX_CURSOR))throw new Reject(400);
      if(TEAM_SCOPED.has(collection)!==Boolean(teamId) ||
        (teamId&&!validId(teamId,128)))throw new Reject(400);
      const limitText=params.get("limit")??"25";
      if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitText))throw new Reject(400);
      const limit=Number(limitText);
      const token=(header(request,"Authorization")??"").match(/^Bearer ([A-Za-z0-9._-]{20,12000})$/)?.[1];
      if(!token)throw new Reject(401);
      if(typeof authenticateBearer!=="function"||
         typeof loadMembership!=="function"||
         typeof queryPublicDocuments!=="function")throw new Reject(503);

      // No claim from caller is accepted: adapters must prove identity and
      // load current membership directly from Firestore every request.
      let auth;
      try {
        auth=await authenticateBearer(token);
      } catch {
        // Reject an invalid or unverifiable signed token as unauthenticated,
        // not as a data-store error. Never send verifier details to callers.
        throw new Reject(401);
      }
      if(!auth||auth.emailVerified!==true)throw new Reject(401);
      const identity=await loadMembership(auth.uid);
      const scope=checkIdentity(identity,auth);
      if(teamId&&!scope.owner&&!scope.teams.includes(teamId))throw new Reject();
      const page=await queryPublicDocuments({
        collection,companyId:scope.companyId,teamId:teamId??null,
        startAfter:cursor,snapshotTime:snapshot||null,limit
      });
      if(!page||typeof page!=="object"||!Array.isArray(page.items)||page.items.length>limit ||
        typeof page.readTime!=="string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(page.readTime) ||
        (snapshot && snapshot!==page.readTime))throw new Reject(503);
      const items=page.items;
      let last=cursor;
      const projected=[];
      for(const item of items){
        if(!item||item.companyId!==scope.companyId ||
          !validId(item.sourceId) || item.sourceId<=last ||
          (TEAM_SCOPED.has(collection)&&item.teamId!==teamId))
          throw new Reject(503);
        last=item.sourceId;
        projected.push(safePublicItem(collection,item));
      }
      // Return no partial pages if any entry violates schema/scope.
      return response(200,{
        collection,teamId:teamId??null,items:projected,
        nextCursor:items.length===limit?last:null,
        snapshotTime:page.readTime
      },origin);
    }catch(err){
      // No error messages / backend responses containing PII, paths or money.
      const status=err instanceof Reject?err.status:503;
      return response(status,{error:"request_blocked"},origin);
    }
  };
}
