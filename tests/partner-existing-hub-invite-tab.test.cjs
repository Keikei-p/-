"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const begin="/* Registered partner-company staff invites:";
const end="\ncopyInviteButton.onclick =";
const start=html.indexOf(begin),stop=html.indexOf(end,start);
assert.ok(start>=0&&stop>start,"must preserve only the isolated invite logic");
const source=html.slice(start,stop);

function harness(companies,{owner=true,rejectRead=false,rejectManage=false}={}){
 const elements=new Map(),calls=[],writes=[];
 function element(id){
  if(!elements.has(id)){
   const node={
    id,value:id==="partnerExistingRole"?"leader":"",
    hidden:["partnerExistingFields","partnerExistingControls","partnerExistingResult"].includes(id),
    disabled:false,textContent:"",
    children:[],
    replaceChildren(){this.children=[];this.value="";},
    append(child){this.children.push(child);if(!this.value)this.value=child.value;},
    select(){},
   };
   elements.set(id,node);
  }
  return elements.get(id);
 }
 const uid="hub-owner";
 const auth=owner?{uid,emailVerified:true}:null;
 const ctx={
  document:{getElementById:element,createElement:()=>({value:"",textContent:""})},
  currentUser:auth,
  currentCompanyData:{ownerUid:uid,companyKind:"internal"},
  currentUserData:{accessKind:"internal"},
  getTodayString:()=>"2026-11-01",
  readPartnerWorkDay:async payload=>{
   calls.push({type:"read",payload});
   if(rejectRead)throw Error("unavailable");
   return {data:{role:"hub",registeredCompanies:companies}};
  },
  managePartnerWork:async payload=>{
   calls.push({type:"manage",payload});
   if(rejectManage)throw Error("permission-denied");
   writes.push(payload);
   return {data:payload.action==="hubCreateInvite"?
     {token:"a".repeat(43)}:{teamId:"new-team"}};
  },
  location:{origin:"https://nico-factory.web.app"},
  URL,
  navigator:{clipboard:{writeText:async text=>calls.push({type:"copy",text})}},
 };
 vm.runInNewContext(source,ctx,{timeout:1000});
 return {element,calls,writes,ctx};
}
const existing={
 partnerCompanyId:"company-previous",name:"以前登録した協力店",
 active:true,teams:[{id:"team-existing",name:"第1班"}]
};
const pending={
 partnerCompanyId:"company-pending",name:"承認待ちの協力店",
 active:false,teams:[]
};

test("existing company and role invite share a server-verified company ID, no new company creation",async()=>{
 const h=harness([existing,pending]);
 await h.element("partnerExistingLoad").onclick();
 assert.equal(h.calls[0].payload.date,"2026-11-01");
 assert.equal(h.element("partnerExistingCompanySelect").children.length,2);
 assert.equal(h.element("partnerExistingTeamSelect").value,"team-existing");
 h.element("partnerExistingRole").value="leader";
 h.element("partnerExistingEmail").value="Leader@Example.com";
 await h.element("partnerExistingCreate").onclick();
 assert.equal(h.writes.length,1);
 assert.equal(h.writes[0].action,"hubCreateInvite");
 assert.equal(h.writes[0].partnerCompanyId,"company-previous");
 assert.equal(h.writes[0].teamId,"team-existing");
 assert.equal(h.writes[0].role,"leader");
 assert.equal(h.writes[0].email,"leader@example.com");
 assert.match(h.element("partnerExistingLink").value,
   /^https:\/\/nico-factory\.web\.app\/partner-workspace\.html\?invite=/);
 assert.equal(h.element("partnerExistingResult").hidden,false);
 assert.equal(h.writes.some(x=>x.action==="createPartnerCompanyInvitation"),false);
});
test("a pending company is listed but cannot invite or silently activate",async()=>{
 const h=harness([pending]);
 await h.element("partnerExistingLoad").onclick();
 assert.equal(h.element("partnerExistingControls").hidden,true);
 assert.match(h.element("partnerExistingStatus").textContent,/承認待ち/);
 h.element("partnerExistingRole").value="member";
 h.element("partnerExistingEmail").value="member@example.com";
 await h.element("partnerExistingCreate").onclick();
 assert.equal(h.writes.length,0);
});
test("a staff invite refuses malformed emails and remains tied to the selected team",async()=>{
 const h=harness([existing]);
 await h.element("partnerExistingLoad").onclick();
 h.element("partnerExistingRole").value="member";
 h.element("partnerExistingEmail").value="not-an-address";
 await h.element("partnerExistingCreate").onclick();
 assert.equal(h.writes.length,0);
 h.element("partnerExistingEmail").value="member@example.com";
 await h.element("partnerExistingCreate").onclick();
 assert.equal(h.writes.length,1);
 assert.equal(h.writes[0].role,"member");
 assert.equal(h.writes[0].teamId,"team-existing");
});
test("owner may add a team only to an approved previously registered company",async()=>{
 const h=harness([existing]);
 await h.element("partnerExistingLoad").onclick();
 h.element("partnerExistingTeamName").value="新しい班";
 await h.element("partnerExistingAddTeam").onclick();
 assert.equal(h.writes.length,1);
 assert.equal(h.writes[0].action,"hubAddTeam");
 assert.equal(h.writes[0].partnerCompanyId,existing.partnerCompanyId);
 assert.equal(h.writes[0].name,"新しい班");
});
test("failed or unauthorized reads never present fictitious company or invite",async()=>{
 for(const options of [{rejectRead:true},{owner:false}]){
  const h=harness([existing],options);
  await h.element("partnerExistingLoad").onclick();
  assert.equal(h.element("partnerExistingFields").hidden,true);
  assert.equal(h.writes.length,0);
  assert.equal(h.calls.some(x=>x.type==="manage"),false);
 }
});
test("server rejection never claims link creation",async()=>{
 const h=harness([existing],{rejectManage:true});
 await h.element("partnerExistingLoad").onclick();
 h.element("partnerExistingEmail").value="worker@example.com";
 await h.element("partnerExistingCreate").onclick();
 assert.equal(h.element("partnerExistingResult").hidden,true);
 assert.equal(h.element("partnerExistingLink").value,"");
 assert.match(h.element("partnerExistingStatus").textContent,/作れません/);
});
test("new invite UI never directly reads or mutates Firestore financial originals",()=>{
 assert.match(html,/id="partnerExistingInvitePanel"/);
 assert.match(html,/id="partnerExistingCompanySelect"/);
 assert.match(html,/const managePartnerWork = httpsCallable\(partnerCountFunctions,"managePartnerWorkspace"\)/);
 assert.match(source,/readPartnerWorkDay\(\{date:getTodayString\(\)\}\)/);
 assert.match(source,/managePartnerWork\(\{action:"hubCreateInvite"/);
 assert.doesNotMatch(source,/\b(getFirestore|deleteDoc|setDoc|updateDoc|collection|doc)\s*\(/);
});
