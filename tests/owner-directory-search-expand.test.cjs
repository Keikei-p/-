"use strict";
// Synthetic browser-only integration of the existing Owner directory UI.
// No Firebase project, credentials, accounts, saved counts, sales or writes.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const start=html.indexOf("let ownerDirNonce=0,ownerDirCursor=null");
const end=html.indexOf("let partnerCompanyListGeneration=0",start);
assert(start>=0&&end>start,"owner directory code boundaries must exist");
const ownerCode=html.slice(start,end);
function setup(total=200){
 const nodes=new Map(),shown=[],calls=[],writes=[];
 const makeNode=()=>({
  hidden:false,disabled:false,value:"",style:{},textContent:"",
  children:[],append(...items){this.children.push(...items);},
  replaceChildren(){this.children=[];},
  addEventListener(name,handler){this["on"+name]=handler;}
 });
 const document={
  getElementById(id){if(!nodes.has(id))nodes.set(id,makeNode());return nodes.get(id);},
  createElement(){return makeNode();}
 };
 const all=Array.from({length:total},(_,i)=>{
  const n=i+1,id="company_"+String(n).padStart(4,"0");
  return {partnerCompanyId:id,name:"協力店"+n,approved:true};
 });
 const sandbox={
  document,partnerCompanyManagement:{style:{display:"block"}},
  currentUser:{uid:"owner"},currentUserData:{companyId:"hub"},
  canLoadPartnerRanking:()=>true,
  partnerMainValidId:id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(id),
  async readOwnerPartnerCompaniesPage({cursor}){
   calls.push(cursor);
   const offset=cursor?all.findIndex(x=>x.partnerCompanyId===cursor)+1:0;
   if(offset<0)throw Error("bad cursor");
   const rows=all.slice(offset,offset+25),hasMore=offset+25<all.length;
   return {data:{scope:"hub_owner_partner_directory_counts_only",
    financialFieldsIncluded:false,productionDocumentWrites:0,pageSize:25,
    companies:rows,hasMore,nextCursor:hasMore?rows.at(-1).partnerCompanyId:null}};
  },
  openOwnerPartnerProxy:async()=>{},openOwnerPartnerQuickProxy:async()=>{}
 };
 const context=vm.createContext(sandbox);
 vm.runInContext(ownerCode,context,{timeout:1000});
 const run=(expr)=>vm.runInContext(expr,context,{timeout:1000});
 return {context,nodes,shown,calls,writes,run};
}
test("Owner explicitly searches 125 additional companies per click; no background fetch",async()=>{
 assert.equal((html.match(/id="ownerPartnerDirectorySearchMore"/g)||[]).length,1);
 assert.match(html,/最大125社/);
 const t=setup(202);
 await t.run("ownerDirFetch(true)");
 assert.equal(t.calls.length,1);
 assert.equal(t.run("ownerDirCompanies.size"),25);
 t.nodes.get("ownerPartnerDirectoryFilter").value="協力店130";
 t.nodes.get("ownerPartnerDirectoryFilter").oninput();
 assert.equal(t.calls.length,1,"typing never scans Firestore");
 assert.equal(t.nodes.get("ownerPartnerDirectorySearchMore").disabled,false);
 await t.run("ownerDirSearchMore()");
 assert.equal(t.calls.length,6,"one click fetches at most five pages");
 assert.equal(t.run("ownerDirCompanies.size"),150);
 assert.equal(t.nodes.get("ownerPartnerDirectoryRows").children.length,1);
 assert.match(t.nodes.get("ownerPartnerDirectoryRows").children[0].children[0].textContent,/協力店130/);
 assert.equal(t.nodes.get("ownerPartnerDirectoryNext").disabled,false);
 await t.run("ownerDirSearchMore()");
 assert.equal(t.calls.length,9,"bounded pages stop at end");
 assert.equal(t.run("ownerDirCompanies.size"),202);
 assert.equal(t.run("ownerDirHasMore"),false);
 assert.equal(t.nodes.get("ownerPartnerDirectorySearchMore").hidden,true);
 assert.equal(t.writes.length,0);
});
test("Owner search requires a nonempty filter and never scans for invalid session",async()=>{
 const t=setup();
 await t.run("ownerDirFetch(true)");
 await t.run("ownerDirSearchMore()");
 assert.equal(t.calls.length,1);
 t.nodes.get("ownerPartnerDirectoryFilter").value="探す";
 t.context.currentUser={uid:null};
 await t.run("ownerDirSearchMore()");
 assert.equal(t.calls.length,1);
 assert.equal(t.writes.length,0);
});
test("Reset cancels an outstanding search and prevents stale results crossing sessions",async()=>{
 const t=setup(150);
 await t.run("ownerDirFetch(true)");
 t.nodes.get("ownerPartnerDirectoryFilter").value="協力店";
 let release;
 t.context.readOwnerPartnerCompaniesPage=()=>new Promise(resolve=>{release=resolve;});
 const pending=t.run("ownerDirSearchMore()");
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof release,"function");
 t.run("ownerDirReset()");
 release({data:{scope:"hub_owner_partner_directory_counts_only",
  financialFieldsIncluded:false,productionDocumentWrites:0,pageSize:25,
  companies:[],hasMore:false,nextCursor:null}});
 await pending;
 assert.equal(t.run("ownerDirCompanies.size"),0);
 assert.equal(t.run("ownerDirSearchRunning"),false);
 assert.equal(t.nodes.get("ownerPartnerDirectoryFilter").value,"");
 assert.equal(t.writes.length,0);
});
test("Owner search UI never switches authentication or handles sales information",()=>{
 assert.doesNotMatch(ownerCode,/\b(?:signOut|signIn|setDoc|updateDoc|deleteDoc)\s*\(/);
 assert.doesNotMatch(ownerCode,/\b(?:revenue|cashback|unitPrice|totalRevenue)\b/);
 assert.match(ownerCode,/page<5&&ownerDirHasMore/);
 assert.match(ownerCode,/uid!==currentUser\?\.uid/);
 assert.match(ownerCode,/hub!==currentUserData\?\.companyId/);
});