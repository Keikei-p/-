import {projectLegacyCountDay} from "../../security/legacy-internal-count-bridge.mjs";

/**
 * Internal count-only daily paging route. No Firestore SDK, Auth credentials,
 * or raw financial payloads can be supplied by a browser.
 *
 * The actual Worker must provide VERIFIED Firebase token + current Firestore
 * user/member/company reads and scoped snapshot-pinned queries. The
 * endpoint stays OFF until the verified rollout is explicitly approved.
 */
const deny=code=>{const e=new Error("internal_counts_"+code);e.status=code==="unauthenticated"?401:code==="forbidden"?403:503;throw e;};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export function createInternalCountPage({
 enabled=false,authenticate,loadMembership,queryDailyRecords,queryProducts
}={}){
 if(enabled!==true)return async()=>deny("unavailable");
 for(const fn of [authenticate,loadMembership,queryDailyRecords,queryProducts]){
  if(typeof fn!=="function")deny("backend_missing");
 }
 return async ({bearer,day,cursor="",readTime=""}={})=>{
  if(typeof bearer!=="string"||bearer.length<20||bearer.length>12000)deny("unauthenticated");
  if(typeof day!=="string"||!DATE.test(day)||Number.isNaN(Date.parse(day+"T00:00:00Z"))||
     new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day)
    deny("invalid_date");
  if(typeof cursor!=="string"||cursor.length>450||
     typeof readTime!=="string"||readTime.length>60||
     ((cursor.length===0)!==(readTime.length===0)))deny("page_cursor");
  const who=await authenticate(bearer);
  if(!who?.uid||who.emailVerified!==true)deny("unauthenticated");
  const principal=await loadMembership(who.uid);
  if(!principal||principal.uid!==who.uid||principal.firebaseIdTokenVerified!==true||
     principal.serverMembershipVerified!==true)deny("forbidden");
  // Query client never chooses the company to read; only the live membership.
  const companyId=principal.companyId;
  const [page,products]=await Promise.all([
   queryDailyRecords({companyId,date:day,cursor,readTime,pageSize:50}),
   queryProducts({companyId})
  ]);
  if(!page||!Array.isArray(page.records)||page.records.length>50||
     !Array.isArray(products)||products.length>200||
     typeof page.readTime!=="string"||
     !/^\d{4}-\d{2}-\d{2}T/.test(page.readTime)||
     (readTime&&readTime!==page.readTime)||
     typeof page.hasMore!=="boolean"||
     (page.hasMore&&(page.records.length!==50||typeof page.nextCursor!=="string"||
                      page.nextCursor.length<1))||
     (!page.hasMore&&page.nextCursor))deny("snapshot");
  const projected=projectLegacyCountDay({
   principal,day,records:page.records,products,readTime:page.readTime
  });
  return {...projected,hasMore:page.hasMore,
   nextCursor:page.hasMore?page.nextCursor:null};
 };
}
