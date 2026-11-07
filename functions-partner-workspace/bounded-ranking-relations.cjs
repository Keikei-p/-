"use strict";
// Count-only relation pagination for provisional monthly rankings.
// Never silently rank a subset; hard limit bounds Firestore read cost.
const MAX_RANKING_COMPANIES=125;
const PAGE_SIZE=25;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
function fail(reason){const e=Error("RANKING_RELATIONS_UNVERIFIED");e.reason=reason;throw e;}
async function readBoundedRankingRelations(db,hubId){
 if(!db||typeof db.collection!=="function"||!ID.test(hubId||""))fail("argument");
 const base=db.collection("partnerRelations")
  .where("hubCompanyId","==",hubId).orderBy("__name__");
 let cursor="",pages=0;
 const rows=[],seen=new Set();
 while(true){
  // Each request returns at most 25 accepted rows + one lookahead.
  const q=cursor?base.startAfter(cursor):base;
  const snapshot=await q.limit(PAGE_SIZE+1).get();
  const docs=snapshot?.docs;
  if(!Array.isArray(docs)||snapshot.size!==docs.length||docs.length>PAGE_SIZE+1)
   fail("malformed_page");
  const page=docs.slice(0,PAGE_SIZE);
  if(rows.length+page.length>MAX_RANKING_COMPANIES||
     (rows.length===MAX_RANKING_COMPANIES&&docs.length))
   fail("too_many_companies");
  let previous=cursor;
  for(const doc of page){
   const cid=doc?.id,rel=doc?.data?.();
   if(!ID.test(cid||"")||cid<=previous||seen.has(cid)||
      !rel||rel.partnerCompanyId!==cid||rel.hubCompanyId!==hubId)
    fail("invalid_relation");
   previous=cid;seen.add(cid);
   rows.push(doc);
  }
  pages++;
  if(docs.length<=PAGE_SIZE)break;
  if(!page.length||pages>=Math.ceil(MAX_RANKING_COMPANIES/PAGE_SIZE))
   fail("too_many_companies");
  cursor=previous;
 }
 return rows;
}
module.exports={readBoundedRankingRelations,MAX_RANKING_COMPANIES,PAGE_SIZE};
