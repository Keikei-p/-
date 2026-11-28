import test from "node:test";
import assert from "node:assert/strict";
import {historicalCountGroup,withHistoricalCountProducts} from "../ranking/historical-count-publication-groups.mjs";

test("only the nine exact historical identities produce count-only labels, never inferred commercial mappings",()=>{
 assert.equal(historicalCountGroup("realProduct"),null);
 for(const bad of ["legacyPartnerSku:partnerSku10","legacyPartnerSku:__proto__","legacyPartnerSku:partnerPrivate:x"])
  assert.throws(()=>historicalCountGroup(bad),/UNVERIFIED/);
 const original=[{id:"real",name:"HTB",active:true}],copy=structuredClone(original);
 const rows=withHistoricalCountProducts(original,"hub");assert.equal(rows.length,10);
 assert.deepEqual(original,copy);assert(!original.some(x=>x.id.startsWith("legacyPartnerSku:")));
 assert(rows.some(x=>x.name==="SB光・AIR（過去合算）"));
 assert(rows.some(x=>x.name==="つばさ・HTB（過去合算）"));
 assert.deepEqual(withHistoricalCountProducts(rows,"hub"),rows);
 assert.throws(()=>withHistoricalCountProducts([{id:"legacyPartnerSku:partnerSku07",name:"HTB",active:true}],"hub"),/UNVERIFIED/);
 assert.throws(()=>withHistoricalCountProducts(Array.from({length:1000},(_,i)=>({id:"r"+i,name:"商材",active:true})),"hub"),/UNVERIFIED/);
});

test("historical source metadata is bounded, source-scoped and rejects collisions before publication",()=>{
 const source=[{companyId:"hub",sourceId:"real",name:"HTB",active:true,sortOrder:1}],before=structuredClone(source);
 const rows=withHistoricalCountProducts(source,"hub",{source:true});
 assert.deepEqual(source,before);assert.equal(rows.length,10);
 assert(rows.every(r=>r.companyId==="hub"));
 for(const bad of [
  [...source,...source],
  [{...rows[1],companyId:"foreign"}],
  [{...rows[1],active:false}],
  [{...rows[1],name:"新規商材"}]
 ])assert.throws(()=>withHistoricalCountProducts(bad,"hub",{source:true}),/UNVERIFIED/);
 for(const hub of ["__proto__","constructor","prototype","hub/other"])
  assert.throws(()=>withHistoricalCountProducts(source,hub,{source:true}),/UNVERIFIED/);
});
