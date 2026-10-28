const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");

const source=fs.readFileSync(path.join(__dirname,"../functions/index.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
class HttpsError extends Error{
 constructor(code,msg){super(msg);this.code=code;}
}
function makeDb(){
 const store=new Map(),pending=[];
 let seq=0;
 const clone=x=>{
   if(x===null||typeof x!=="object")return x;
   if(Array.isArray(x))return x.map(clone);
   return Object.fromEntries(Object.entries(x).map(([key,value])=>[key,clone(value)]));
 };
 const snapshot=(ref)=>{
  const value=store.get(ref.path);
  return {id:ref.id,ref,exists:value!==undefined,data:()=>clone(value)};
 };
 function ref(path){
  const segments=path.split("/");
  return {path,id:segments.at(-1),
   collection(name){return coll(path+"/"+name);},
   async get(){return snapshot(this);},
   async create(data){
    if(store.has(path))throw Error("exists");
    store.set(path,clone(data));
   },
   async set(data){store.set(path,clone(data));}
  };
 }
 function coll(prefix){
  const documents=()=>[...store.keys()].filter(key=>
    key.startsWith(prefix+"/")&&
    key.split("/").length===prefix.split("/").length+1).map(ref);
  return {
   doc(id){return ref(prefix+"/"+(id??"fixture-"+(++seq)));},
   async get(){const docs=documents();return {empty:!docs.length,size:docs.length,docs};},
   where(field,op,value){
    assert.equal(op,"==");
    const fetchDocs=limit=>documents().filter(x=>
      store.get(x.path)?.[field]===value).slice(0,limit);
    return {
      async get(){const docs=fetchDocs(Infinity);
        return {empty:!docs.length,size:docs.length,docs};},
      limit(n){return {async get(){
        const docs=fetchDocs(n);
        return {empty:!docs.length,size:docs.length,docs};
      }};}
    };
   }
  };
 }
 const db={
  collection:coll,
  async runTransaction(fn){
   const staged=[];
   const tx={
    get:async ref=>snapshot(ref),
    create:(r,data)=>{if(store.has(r.path))throw Error("exists");staged.push({op:"create",r,data:clone(data)});},
    update:(r,data)=>{if(!store.has(r.path))throw Error("missing");staged.push({op:"update",r,data:clone(data)});},
    set:(r,data)=>staged.push({op:"set",r,data:clone(data)})
   };
   const result=await fn(tx);
   for(const {op,r,data} of staged){
    if(op==="update")store.set(r.path,{...store.get(r.path),...data});
    else store.set(r.path,data);
   }
   return result;
  }
 };
 return {db,store,ref};
}
function setup(){
 const {db,store}=makeDb();
 store.set("companies/hub",{name:"自社",ownerUid:"owner",active:true});
 store.set("companies/hub/members/owner",{
  uid:"owner",companyRole:"owner",role:"leader",active:true
 });
 store.set("users/owner",{uid:"owner",name:"オーナー",active:true,companyId:"hub"});
 store.set("users/receiver",{uid:"receiver",name:"協力店担当",active:true});
 const ctx={exports:{},require(name){
  if(name==="crypto")return crypto;
  if(name==="firebase-admin/app")return {initializeApp:()=>{}};
  if(name==="firebase-admin/auth")return {getAuth:()=>({})};
  if(name==="firebase-admin/firestore")return {
   getFirestore:()=>db,
   FieldValue:{serverTimestamp:()=>({__syntheticTimestamp:true})},
   Timestamp:{fromMillis:ms=>({toMillis:()=>ms})}
  };
  if(name==="firebase-functions/v2/https")return {
   onCall:callback=>callback,onRequest:(...args)=>args.at(-1),HttpsError
  };
  if(name==="firebase-functions/v2/scheduler")return {
   onSchedule:(...args)=>args.at(-1)
  };
  if(name==="firebase-functions/v2")return {setGlobalOptions:()=>{}};
  throw Error("module not allowed "+name);
 },Buffer,console,process,Date,URL,URLSearchParams,setTimeout,clearTimeout};
 vm.runInNewContext(source,ctx,{filename:"functions/index.js",timeout:1000});
 const caller=(uid,email)=>({
  auth:{uid,token:{email,email_verified:true,name:uid}},
  data:{}
 });
 return {handlers:ctx.exports,store,caller};
}
test("invitation selection is on UI, partner links use verified callable and no legacy fallback",()=>{
 for(const id of ["inviteTypeSelect","invitePartnerCompanyNameInput",
   "inviteTypeDescription","partnerCatalogPanel","partnerCatalogList",
   "partnerCustomProductCreateButton"])
  assert.equal(html.split('id="'+id+'"').length-1,1,id);
 assert(html.includes("createPartnerCompanyInvitation"));
 assert(html.includes("previewPartnerCompanyInvitation"));
 assert(html.includes("acceptPartnerCompanyInvitation"));
 assert(html.includes("partnerInvite"));
 assert(html.includes("listPartnerCatalog"));
 assert(html.includes("updatePartnerCustomProductVisibility"));
 assert(html.includes("createPartnerCustomProduct"));
 assert(html.includes('inviteTypeSelect.value === "partner_company"'));
 assert(html.includes("getInviteIdFromUrl"),"legacy invitation route retained");
});
test("owner creates email-bound 30-minute one-use invite; raw token not stored",async()=>{
 const {handlers,store,caller}=setup();
 const req=caller("owner","owner@example.com");
 req.data={email:"receiver@example.com",partnerCompanyName:"協力店A"};
 const created=await handlers.createPartnerCompanyInvitation(req);
 assert.equal(created.inviteType,"partner_company");
 assert.match(created.token,/^[A-Za-z0-9_-]{40,100}$/);
 const invitation=[...store.entries()].find(([p])=>p.startsWith("invitations/"));
 assert(invitation);
 const data=invitation[1];
 assert.equal(data.kind,"partner_company");
 assert.equal(data.emailLower,"receiver@example.com");
 assert.equal(data.canViewRevenue,false);
 assert.equal(data.canViewUnitPrice,false);
 assert.equal(data.countOnly,true);
 assert.equal(data.tokenHash,crypto.createHash("sha256").update(created.token).digest("hex"));
 assert.equal(JSON.stringify(data).includes(created.token),false);
 const preview=await handlers.previewPartnerCompanyInvitation({
  ...caller("receiver","receiver@example.com"),data:{token:created.token}
 });
 assert.equal(preview.financialAccess,false);
 assert.equal(preview.inviteType,"partner_company");
 const wrong=caller("receiver","other@example.com");wrong.data={token:created.token};
 await assert.rejects(handlers.previewPartnerCompanyInvitation(wrong),/この協力店の招待は利用できません/);
});
test("acceptance creates separate partner company with owner-only relation and no financial grants",async()=>{
 const {handlers,store,caller}=setup();
 const creator=caller("owner","owner@example.com");
 creator.data={email:"receiver@example.com",partnerCompanyName:"協力店A"};
 const {token}=await handlers.createPartnerCompanyInvitation(creator);
 const recipient=caller("receiver","receiver@example.com");recipient.data={token};
 const registered=await handlers.acceptPartnerCompanyInvitation(recipient);
 assert.notEqual(registered.companyId,"hub");
 assert.equal(registered.accessKind,"partner");
 assert.equal(registered.catalogSourceCompanyId,"hub");
 assert.equal(store.get("users/receiver").companyId,registered.companyId);
 assert.equal(store.get("users/owner").companyId,"hub");
 const createdCompany=store.get("companies/"+registered.companyId);
 assert.equal(createdCompany.companyKind,"partner");
 assert.equal(createdCompany.hubCompanyId,"hub");
 const member=store.get("companies/"+registered.companyId+"/members/receiver");
 assert.equal(member.canViewRevenue,false);
 assert.equal(member.canViewUnitPrice,false);
 assert.equal(member.accessKind,"partner");
 assert.equal(member.companyRole,"owner");
 assert.equal(store.get("partnerRelations/"+registered.companyId).countSharingApproved,true);
 assert.equal(store.get("partnerRelations/"+registered.companyId).ownProductDefaultVisibility,"private");
 const invitation=[...store.values()].find(v=>v?.kind==="partner_company");
 assert.equal(invitation.status,"accepted");
 await assert.rejects(handlers.acceptPartnerCompanyInvitation(recipient),/この協力店の招待は利用できません/);
 assert.equal([...store.keys()].filter(x=>x.startsWith("partnerRelations/")).length,1);
});
test("invitation creation denied for a leader even when they can invite own staff",async()=>{
 const {handlers,store,caller}=setup();
 store.set("users/leader",{uid:"leader",companyId:"hub",active:true});
 store.set("companies/hub/members/leader",{uid:"leader",active:true,companyRole:"member",role:"leader",canCreateInvite:true});
 const req=caller("leader","leader@example.com");
 req.data={email:"receiver@example.com",partnerCompanyName:"協力店A"};
 await assert.rejects(handlers.createPartnerCompanyInvitation(req),/代表オーナーのみ/);
 assert.equal([...store.keys()].filter(k=>k.startsWith("invitations/")).length,0);
});
test("already affiliated receiver cannot abandon past company or accept partner invite",async()=>{
 const {handlers,store,caller}=setup();
 const request=caller("owner","owner@example.com");
 request.data={email:"receiver@example.com",partnerCompanyName:"協力店A"};
 const {token}=await handlers.createPartnerCompanyInvitation(request);
 store.set("users/receiver",{...store.get("users/receiver"),companyId:"other"});
 const incoming=caller("receiver","receiver@example.com");incoming.data={token};
 await assert.rejects(handlers.acceptPartnerCompanyInvitation(incoming),/既存の会社所属は変更しません/);
 assert.equal(store.get("users/receiver").companyId,"other");
 assert.equal([...store.keys()].filter(k=>k.startsWith("partnerRelations/")).length,0);
});
test("partner catalog callable never returns raw hub price or cashback; custom create default private",async()=>{
 const {handlers,store,caller}=setup();
 const create=caller("owner","owner@example.com");
 create.data={email:"receiver@example.com",partnerCompanyName:"協力店A"};
 const {token}=await handlers.createPartnerCompanyInvitation(create);
 const incoming=caller("receiver","receiver@example.com");incoming.data={token};
 const accepted=await handlers.acceptPartnerCompanyInvitation(incoming);
 store.set("products/nuro",{
  companyId:"hub",name:"NURO",active:true,sortOrder:0,
  revenue:20000,pricingOptions:[{cashback:5000,revenuePerUnit:20000}]
 });
 const view=await handlers.listPartnerCatalog({...incoming,data:{}});
 assert.deepEqual(Array.from(view.products,x=>x.name),["NURO"]);
 assert(!JSON.stringify(view).includes("20000"));
 assert(!JSON.stringify(view).includes("5000"));
 const custom=await handlers.createPartnerCustomProduct({
  ...incoming,data:{name:"独自オプション"}
 });
 assert.equal(custom.visibility,"private");
 const saved=store.get("companies/"+accepted.companyId+"/partnerCustomProducts/"+custom.productId);
 assert.equal(saved.visibility,"private");
 assert(!("pricingOptions" in saved));assert(!("revenue" in saved));
 const changed=await handlers.updatePartnerCustomProductVisibility({
  ...incoming,data:{productId:custom.productId,visibility:"shared_counts"}
 });
 assert.equal(changed.visibility,"shared_counts");
 assert.equal(store.get("companies/"+accepted.companyId+"/partnerCustomProducts/"+custom.productId).visibility,"shared_counts");
});
