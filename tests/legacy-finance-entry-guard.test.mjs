import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {classifyLegacySalesEntrypoint} from "../legacy-finance-entry-guard.mjs";
const original=()=>{
 const uid="internalUser",companyId="internalCompany";
 return {uid,authEmailVerified:true,
  user:{uid,companyId,active:true,companyRole:"owner",role:"leader",teamId:null},
  member:{uid,companyId,active:true,companyRole:"owner",role:"leader",teamId:null},
  company:{active:true,companyKind:"internal",ownerUid:uid}
 };
};
test("existing legitimate internal owner, leader and member retain legacy page access",()=>{
 for(const role of ["owner","member"]){
  const data=original();
  data.user.companyRole=role;
  data.member.companyRole=role;
  for(const memberType of [undefined,"internal","direct","member","managed"]){
   if(memberType!==undefined){
    data.user.memberType=memberType;data.member.memberType=memberType;
   }else{delete data.user.memberType;delete data.member.memberType;}
   assert.equal(classifyLegacySalesEntrypoint(data).mode,"internal");
  }
 }
});
test("a partner COMPANY, owner, leader, master or an old revenue grant never opens raw-finance page",()=>{
 const scenarios=[
  v=>{v.company.companyKind="partner";v.company.ownerUid=v.uid;},
  v=>{v.user.accessKind="partner";},
  v=>{v.member.accessKind="partner";},
  v=>{v.user.memberType="partner";},
  v=>{v.member.memberType="partner";},
  v=>{v.user.memberType="cooperator";},
  v=>{v.member.memberType="cooperator";}
 ];
 for(const mutate of scenarios){
  const data=original();data.user.canViewRevenue=true;
  data.member.canViewRevenue=true;data.user.canViewUnitPrice=true;
  data.member.canViewUnitPrice=true;mutate(data);
  const result=classifyLegacySalesEntrypoint(data);
  assert.equal(result.mode,"partner");
  assert.equal(Object.isFrozen(result),true);
 }
});
test("unknown markers, partial membership, invalid email and stale role/team consistency fail closed",()=>{
 const invalid=[
  v=>{v.company.companyKind="franchise-unknown";},
  v=>{v.user.accessKind="unknown";},
  v=>{v.member.accessKind="owner-with-finance";},
  v=>{v.user.memberType="future-new-group";},
  v=>{v.member.memberType="future-new-group";},
  v=>{v.user.active=false;},
  v=>{v.member.active=false;},
  v=>{v.company.active=false;},
  v=>{v.user.uid="another";},
  v=>{v.member.uid="another";},
  v=>{v.member.companyId="another";},
  v=>{v.user.companyId="another";},
  v=>{v.authEmailVerified=false;},
  v=>{v.member.teamId="team1";v.user.teamId="team2";},
  v=>{v.member.companyRole="member";v.user.companyRole="owner";},
  v=>{v.member=null;},
  v=>{v.company=null;}
 ];
 for(const mutate of invalid){
  const data=original();mutate(data);
  assert.equal(classifyLegacySalesEntrypoint(data).mode,"blocked");
 }
});
test("legacy UI requests three fresh server Firestore docs before any price catalogue or live records subscription",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const job=readFileSync(new URL("../.github/workflows/nico-factory-sync.yml",import.meta.url),"utf8");
 const canonicalGuard=readFileSync(new URL("../legacy-finance-entry-guard.mjs",import.meta.url),"utf8")
   .replace("export function classifyLegacySalesEntrypoint","function classifyLegacySalesEntrypoint");
 assert(html.includes(canonicalGuard),
   "production index must contain the full unmodified partner-safe finance guard");
 assert(!html.includes('from "./legacy-finance-entry-guard.mjs"'),
   "production login may not depend on a missing external guard module");
 assert.match(html,/\bgetDocFromServer\b/);
 const load=html.indexOf("async function loadUserData(");
 const read=html.indexOf("const checkedEntry=await checkLegacyEntryAgainstServer(user);",load);
 const price=html.indexOf("await loadProducts(",load);
 assert(load>=0&&read>load&&price>read,"trusted check must precede any raw price read");
 const start=html.indexOf("async function checkLegacyEntryAgainstServer");
 const end=html.indexOf("function showLegacyFinanceEntryBlocked",start);
 const source=html.slice(start,end);
 assert.match(source,/getDocFromServer\(doc\(db,"users",user\.uid\)\)/);
 assert.match(source,/getDocFromServer\(doc\(db,"companies",profile\.companyId,"members",user\.uid\)\)/);
 assert.match(source,/getDocFromServer\(doc\(db,"companies",profile\.companyId\)\)/);
 assert.match(source,/auth\.currentUser\?\.uid!==user\.uid/);
 assert.match(html,/if \(checkedEntry\.mode!=="internal"\) \{\s*showLegacyFinanceEntryBlocked\(checkedEntry\.mode\);\s*return false;/);
 assert(html.includes('signout.id="legacyFinanceSafeSignout"'),
   "blocked authenticated partner must retain an explicit logout action");
 assert(html.includes('signout.onclick=()=>signOut(auth)'),
   "partner safety stop cannot trap user in a signed-in state");
 assert(job.includes("'legacy-finance-entry-guard.mjs'"));
 assert(job.includes("legacy-finance-entry-guard.mjs archive-output-policy.mjs"));
 const prod=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
 assert(!prod.includes("function isInternalFinanceReader(companyId)"),
  "candidate finance Rules must not be silently substituted into production");
});

test("real legacy login accepts member documents without companyId but rejects partner and mismatched members",async()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const a=html.indexOf("async function checkLegacyEntryAgainstServer(user)");
 const b=html.indexOf("function showLegacyFinanceEntryBlocked",a);
 assert(a>=0&&b>a);
 const fn=html.slice(a,b);
 const uid="internalUser",companyId="internalCompany";
 const user={uid,companyId,active:true,role:"leader",companyRole:"owner",teamId:null};
 const baseMember={uid,active:true,role:"leader",companyRole:"owner",teamId:null};
 const company={active:true,ownerUid:uid,companyKind:"internal"};
 const run=async(memberInfo,companyInfo=company)=>{
  const files={
   ["users/"+uid]:user,
   ["companies/"+companyId+"/members/"+uid]:memberInfo,
   ["companies/"+companyId]:companyInfo
  };
  const scope={
   db:{},auth:{currentUser:{uid}},user:{uid,emailVerified:true},
   doc:(_,...parts)=>parts.join("/"),
   getDocFromServer:async key=>({exists:()=>files[key]!=null,data:()=>files[key]}),
   classifyLegacySalesEntrypoint
  };
  return await runInNewContext(fn+"\ncheckLegacyEntryAgainstServer(user);",scope,{timeout:2000});
 };
 assert.equal((await run({...baseMember})).mode,"internal",
  "legacy users must log in even when member document has no redundant companyId");
 assert.equal((await run({...baseMember,companyId})).mode,"internal");
 assert.equal((await run({...baseMember,companyId:"anotherCompany"})).mode,"blocked",
  "an explicit mismatched companyId must never be normalized away");
 assert.equal((await run({...baseMember,accessKind:"partner"})).mode,"partner");
 assert.equal((await run({...baseMember},{...company,companyKind:"partner"})).mode,"partner");
 assert.equal((await run({...baseMember,uid:"another"})).mode,"blocked");
 assert.equal((await run(null)).mode,"blocked");
});

test("partner count entry links only to count-only workspace and preserves finance guard",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert.match(html,/id="partnerCountWorkspaceEntry"/);
 assert.match(html,/id="partnerCountWorkspaceLink" href="\/partner-workspace\.html"/);
 assert.match(html,/partnerLink\.href="\/partner-workspace\.html"/);
 assert.match(html,/partnerLink\.hidden=mode!=="partner"/);
 assert.match(html,/if \(checkedEntry\.mode!=="internal"\)/);
 assert.match(html,/showLegacyFinanceEntryBlocked\(checkedEntry\.mode\)/);
 assert.doesNotMatch(html,/件数専用画面の本番切替まで/);
});


test("count-only partner login does not require direct partner company reads",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const begin=html.indexOf("async function loadUserData(");
 const end=html.indexOf("/* =====================================================\n   個人テーマ",begin);
 assert.ok(begin>=0&&end>begin);
 const login=html.slice(begin,end);
 assert.match(login,/const userSnap =\s*await getDocFromServer\(\s*userRef/);
 const partner=login.indexOf('currentUserData.accessKind === "partner"');
 const internal=login.indexOf("await checkLegacyEntryAgainstServer(user)");
 assert.ok(partner>=0 && partner<internal,
  "the isolated count-only partner path must precede the internal finance rules check");
 assert.match(login,/currentUserData.memberType !== "cooperator"/);
 assert.match(login,/currentUserData.canViewRevenue !== false/);
 assert.match(login,/currentUserData.canViewUnitPrice !== false/);
 assert.match(login,/await openSameAppPartnerWorkspace\(user\)/);
 assert.match(login,/showLegacyFinanceEntryBlocked\("blocked"\)/);
});


test("existing member tab exposes owner-scoped partner groups without monetary originals",()=>{
 const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 assert.match(html,/id="memberManagementContent"[\s\S]*id="partnerMemberCompanySection"/);
 const a=html.indexOf("// Read-only owner roster inside");
 const b=html.indexOf("function renderMembers()",a);
 assert.ok(a>=0&&b>a);
 const roster=html.slice(a,b);
 assert.match(roster,/!canLoadPartnerRanking\(\)/);
 assert.match(roster,/await readPartnerWorkDay\(\{date:getTodayString\(\)\}\)/);
 assert.match(roster,/result\?\.role!=="hub"/);
 assert.match(roster,/members\)/);
 assert.match(roster,/company\.name|item\.name/);
 for(const f of ["getDocs(", "setDoc(", "updateDoc(", "writeBatch(", "collection(db", "revenuePerUnit", "unitPrice"])
  assert.equal(roster.includes(f),false,"forbidden finance/read-write access "+f);
 assert.match(html,/function canCurrentUserViewRevenue\(\)/);
 assert.match(html,/function canCurrentUserViewUnitPrice\(\)/);
});
