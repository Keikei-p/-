import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const start=html.indexOf("const productArchivePendingIds = new Set();");
const end=html.indexOf("\nfunction renderProducts()",start);
assert.ok(start!==-1&&end>start,"exact Owner archive controller is present");
const archiveSource=html.slice(start,end);

function harness({owner=true,confirm=true,draft={},editing=null,stale=false}={}){
  let writes=[],messages=[],dialogCalls=0;
  const store={id:"p-added",companyId:"hub",name:"追加した商材",
    active:true,revenue:25000,pricingOptions:[{cashback:0,revenuePerUnit:25000}],
    createdAt:123,updatedAt:123};
  const copy=o=>structuredClone(o);
  const original=copy(store);
  const context={
    Set,Object,Number,Error,String,
    isCurrentCompanyOwner:()=>owner,
    auth:{currentUser:{uid:"hub-owner"}},
    currentUserData:{companyId:"hub"},
    captureProductInputDraft:()=>draft,
    editingRecordId:editing,
    showError:message=>messages.push("ERROR "+message),
    showSuccess:message=>messages.push("SUCCESS "+message),
    window:{confirm:()=>{dialogCalls++;return confirm;}},
    renderProducts:()=>{},
    doc:(_db,collection,id)=>({collection,id}),
    db:{},
    serverTimestamp:()=>123456,
    async runTransaction(_db,fn){
      const pending=[];
      await fn({
        get:async ref=>({exists:()=>true,data:()=>copy(stale?
          {...store,name:"someone-renamed"}:store)}),
        update(ref,delta){
          assert.equal(ref.collection,"products");
          assert.equal(ref.id,store.id);
          pending.push(copy(delta));
        },
        delete(){throw Error("PROHIBITED_DELETE");},
        set(){throw Error("PROHIBITED_SET");}
      });
      for(const delta of pending){writes.push(copy(delta));Object.assign(store,delta);}
    },
    getDocFromServer:async()=>({exists:()=>true,data:()=>copy(store)}),
    loadProducts:async()=>true,
    prepareProductInputList:()=>{},
    productWriteFailureMessage:async()=> "拒否されました"
  };
  runInNewContext(archiveSource+";globalThis.archiveProduct=changeOwnerProductArchiveState;",context);
  return {
    archive:context.archiveProduct,product:{...original},store,
    writes,messages,dialogCalls:()=>dialogCalls,original
  };
}

test("Owner delete means ONLY inactive and updatedAt, with finance/name/product ID unchanged",async()=>{
  const h=harness();
  await h.archive(h.product,false);
  assert.deepEqual(h.writes,[{active:false,updatedAt:123456}]);
  assert.equal(h.store.active,false);
  assert.equal(h.store.revenue,h.original.revenue);
  assert.equal(h.store.name,h.original.name);
  assert.deepEqual(h.store.pricingOptions,h.original.pricingOptions);
  assert.equal(h.store.createdAt,h.original.createdAt);
  assert.equal(h.dialogCalls(),1);
  assert.ok(h.messages.some(m=>m.startsWith("SUCCESS ")));
});
test("Restore is reversible without modifying price or history",async()=>{
  const h=harness();
  await h.archive(h.product,false);
  await h.archive({...h.product,active:false},true);
  assert.deepEqual(h.writes.map(o=>o.active),[false,true]);
  assert.equal(h.store.revenue,h.original.revenue);
});
test("No Owner permission means no confirmation and no writes",async()=>{
  const h=harness({owner:false});
  await h.archive(h.product,false);
  assert.equal(h.writes.length,0);
  assert.equal(h.dialogCalls(),0);
  assert.ok(h.messages.some(m=>m.startsWith("ERROR ")));
});
test("Cancellation means no writes",async()=>{
  const h=harness({confirm:false});
  await h.archive(h.product,false);
  assert.equal(h.writes.length,0);
  assert.equal(h.dialogCalls(),1);
});
test("Unsaved count on deleted product cannot vanish silently",async()=>{
  const h=harness({draft:{p_added__cb_0:{productId:"p-added",count:5}}});
  await h.archive(h.product,false);
  assert.equal(h.writes.length,0);
  assert.equal(h.dialogCalls(),0);
});
test("Stale product name aborts instead of archiving a renamed product",async()=>{
  const h=harness({stale:true});
  await h.archive(h.product,false);
  assert.equal(h.writes.length,0);
  assert.ok(h.messages.some(m=>m.startsWith("ERROR ")));
});
test("Rules still forbid hard deletes and archive is Owner-only with exactly two editable fields",()=>{
  const productBlock=rules.split("match /products/{productId} {")[1]
    ?.split("match /records/{recordId} {")[0];
  assert.ok(productBlock);
  assert.match(productBlock,/allow delete:\s*if false;/);
  assert.match(productBlock,/isCompanyOwner\(resource\.data\.companyId\)/);
  assert.match(productBlock,/isCompanyMaster\(resource\.data\.companyId\)/);
  assert.match(productBlock,/hasOnly\(\['active', 'updatedAt'\]\)/);
  assert.match(productBlock,/request\.resource\.data\.active is bool/);
});
test("Archived products excluded from fresh count and goal inputs; historical records kept",()=>{
  assert.match(html,/products\.filter\(product => product\.active !== false\)\.forEach/);
  assert.match(html,/if \(!editingRecordId && products\.some\(product =>/);
  assert.match(html,/product\.active === false\) \{\s*return "使用停止した商材には新しい実績を登録できません/);
  assert.match(html,/Object\.values\(\s*existingMap\s*\)\.forEach/);
  assert.match(html,/input\.dataset\.resultKey/);
});
test("Product management has accessible Delete and Restore controls without document deletions",()=>{
  assert.match(html,/toggle\.textContent = product\.active === false \? "元に戻す" : "削除"/);
  assert.match(html,/toggle\.setAttribute\("aria-label"/);
  assert.match(html,/削除しても|実績・件数・売上・単価・ランキング履歴は削除しません/);
  assert.doesNotMatch(archiveSource,/\bdeleteDoc\(|\btransaction\.delete\(/);
});
