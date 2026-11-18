import test from "node:test";
import assert from "node:assert/strict";
import {applyExactTwoTsubasaRecords as apply} from
  "../tools/production/apply-tsubasa-two-records-atomic.mjs";

const hub="hub_nico";
const fieldValue={serverTimestamp:()=>({__serverTimestamp:true})};
const old=()=>({productId:"old",productName:"つばさ",count:1,
  cashback:0,revenuePerUnit:20000});
const other=()=>({productId:"nuro",productName:"NURO",count:4,
  cashback:0,revenuePerUnit:10000});
const sample=(id,team,date,additional={})=>({
  companyId:hub,uid:"staff_"+id,teamId:team,
  teamNameSnapshot:"班名を変えない",memberNameSnapshot:"本人名を変えない",
  date,workLocation:"現在の訪問先",reportStatus:"submitted",
  results:{old__cb_0:old(),...additional},
  totalCount:1+Object.values(additional).reduce((a,x)=>a+x.count,0),
  totalRevenue:20000+Object.values(additional)
    .reduce((a,x)=>a+x.count*x.revenuePerUnit,0),
  createdByUid:"original_owner",updatedByUid:"original_owner",
  createdAt:"ORIGINAL_DATE",updatedAt:"ORIGINAL_DATE",reportedAt:"ORIGINAL_DATE"
});
const clone=x=>structuredClone(x);
function fakeFirestore({extraRecord,price=20000}={}){
  const store=new Map();
  const put=(collection,id,data)=>store.set(collection+"/"+id,clone(data));
  put("companies",hub,{ownerUid:"owner",companyKind:"hub",active:true});
  put("companies","partner_foreign",{ownerUid:"partner",companyKind:"partner",active:true});
  put("products","old",{companyId:hub,name:"つばさ",active:false,revenue:20000});
  put("products","electric",{companyId:hub,name:"つばさ電気",active:true,revenue:price});
  put("products","nuro",{companyId:hub,name:"NURO",active:true,revenue:10000});
  put("records","r1",sample("r1","team1","2025-10-15",{nuro__cb_0:other()}));
  put("records","r2",sample("r2","team4","2026-11-18"));
  put("records","r3",{...sample("r3","team2","2026-01-01"),
    results:{nuro__cb_0:other()},totalCount:4,totalRevenue:40000});
  put("records","partner",{...sample("r1","partner_team","2026-11-17"),
    companyId:"partner_foreign"});
  if(extraRecord)put("records","r4",sample("r4","team2","2026-06-01"));
  const query=(name)=>({
    name,filter:[],
    select(...fields){void fields;return this;},
    where(k,op,value){this.filter.push([k,op,value]);return this;},
    limit(n){this.max=n;return this;},
    doc(id){return {name,id};}
  });
  const db={
    collection(name){return query(name);},
    async runTransaction(fn,opts){
      const operations=[];
      const tx={
        get:async q=>{
          if(q.id!==undefined){
            const val=store.get(q.name+"/"+q.id);
            return {exists:!!val,id:q.id,data:()=>clone(val)};
          }
          const docs=[...store.entries()].filter(([key,value])=>
            key.startsWith(q.name+"/")&&
            (q.filter||[]).every(([field,op,v])=>op==="=="&&value[field]===v))
            .slice(0,q.max??100000).map(([key,v])=>{
              const id=key.slice(q.name.length+1);
              return {id,data:()=>clone(v)};
            });
          return {docs};
        },
        create(ref,data){
          if(opts.readOnly===true)throw Error("READONLY_WRITE_PROHIBITED");
          operations.push({operation:"create",ref,data});
        },
        update(ref,data){
          if(opts.readOnly===true)throw Error("READONLY_WRITE_PROHIBITED");
          operations.push({operation:"update",ref,data});
        },
        delete(){throw Error("DELETE_PROHIBITED");},
        set(){throw Error("SET_PROHIBITED");}
      };
      const result=await fn(tx);
      if(opts.readOnly===true)assert.equal(operations.length,0);
      if(operations.some(op=>op.operation==="create"&&
          store.has(op.ref.name+"/"+op.ref.id)))
        throw Error("PREEXISTING_AUDIT");
      for(const op of operations){
        const path=op.ref.name+"/"+op.ref.id;
        if(op.operation==="create")store.set(path,clone(op.data));
        if(op.operation==="update"){
          if(!store.has(path))throw Error("UNKNOWN_DOCUMENT");
          store.set(path,{...store.get(path),...clone(op.data)});
        }
      }
      return result;
    }
  };
  return {db,store};
}

test("exact two-record atomic migration preserves all other rows, dates and finance",async()=>{
  const {db,store}=fakeFirestore();
  const before=new Map([...store.entries()].map(([k,v])=>[k,clone(v)]));
  const result=await apply({db,FieldValue:fieldValue});
  assert.equal(result.status,"EXACT_TWO_MOVED_ATOMIC_AND_VERIFIED");
  assert.equal(result.updatedRecords,2);
  assert.equal(result.movedCount,2);
  assert.equal(result.auditDocumentsCreated,2);
  assert.equal(result.otherDocumentsDeleted,0);
  assert.equal(result.otherProductsModified,0);
  for(const key of ["r1","r2"]){
    const original=before.get("records/"+key);
    const after=store.get("records/"+key);
    assert.equal(after.date,original.date);
    assert.equal(after.teamId,original.teamId);
    assert.equal(after.uid,original.uid);
    assert.equal(after.totalCount,original.totalCount);
    assert.equal(after.totalRevenue,original.totalRevenue);
    assert.equal(after.reportedAt,original.reportedAt);
    assert.equal(after.results.old__cb_0,undefined);
    assert.equal(after.results.electric__cb_0.count,1);
    if(key==="r1")assert.deepEqual(after.results.nuro__cb_0,original.results.nuro__cb_0);
  }
  for(const [key,val] of before){
    if(key==="records/r1"||key==="records/r2")continue;
    assert.deepEqual(store.get(key),val,"unrelated doc changed: "+key);
  }
  const audits=[...store.entries()].filter(([k])=>k.startsWith("recordCorrections/"));
  assert.equal(audits.length,2);
  for(const [,audit] of audits){
    assert.equal(audit.before.results.old__cb_0.count,1);
    assert.equal(audit.after.results.electric__cb_0.count,1);
    assert.equal(audit.recordDate==="2025-10-15"||audit.recordDate==="2026-11-18",true);
    assert.equal(audit.changedByUid,"owner");
  }
});

test("third affected record causes hard stop and zero writes",async()=>{
  const {db,store}=fakeFirestore({extraRecord:true});
  const before=clone([...store.entries()]);
  await assert.rejects(()=>apply({db,FieldValue:fieldValue}),
    /STOP_TSUBASA_ATOMIC_EXACT_TWO_PREVIEW_DRIFT/);
  assert.deepEqual([...store.entries()],before);
});

test("changed target product price blocks entire transaction",async()=>{
  const {db,store}=fakeFirestore({price:35000});
  const before=clone([...store.entries()]);
  await assert.rejects(()=>apply({db,FieldValue:fieldValue}),
    /STOP_TSUBASA_RECLASS_DISPLAYED_REVENUE_DRIFT/);
  assert.deepEqual([...store.entries()],before);
});

test("second execution cannot duplicate audit or move an unrelated record",async()=>{
  const {db,store}=fakeFirestore();
  await apply({db,FieldValue:fieldValue});
  const once=clone([...store.entries()]);
  await assert.rejects(()=>apply({db,FieldValue:fieldValue}),
    /STOP_TSUBASA_ATOMIC_EXACT_TWO_PREVIEW_DRIFT/);
  assert.deepEqual([...store.entries()],once);
});

test("executor refuses absent transaction or server audit timestamp dependency",async()=>{
  await assert.rejects(()=>apply({db:{},FieldValue:fieldValue}),
    /STOP_TSUBASA_ATOMIC_DEPENDENCY/);
});
