import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const actual=read("../partner-workspace.html");
const originalBlob="431b200e02934315eda57b6998bdde801252f78f";
const gitBlob=s=>{
 const bytes=Buffer.from(s,"utf8");
 return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0"))
  .update(bytes).digest("hex");
};
const take=(s,from,to)=>{
 const start=s.indexOf(from);
 assert(start>=0,from);
 const end=s.indexOf(to,start+from.length);
 assert(end>start,to);
 return s.slice(start,end);
};
const once=(s,find,replacement,label)=>{
 assert.equal(s.split(find).length-1,1,"single reviewed change: "+label);
 return s.replace(find,replacement);
};

test("undoing ONLY the approved seven count-only additions restores the exact original partner login, counts and finance-free UI bytes",()=>{
 let s=actual;
 assert.equal(s.includes("const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=true;"),false);
 s=once(s,` <section id="countInlineJointCompanies" hidden>
  <h4>🏢 会社ランキング</h4>
  <div id="countCompanyRank" class="scroll" aria-live="polite"></div>
 </section>
`,"","hidden company ranking target");
 s=once(s,`// Current production count saving and older dashboard remain unchanged.
// The existing ranking cards can only use server-verified joint count values.
const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;
`,"","verified OFF flag");
 s=once(s,`if(NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||
    !NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED||`,
  "if(!NICO_PARTNER_JOINT_COUNT_MONTH_RELEASED||","old month-only fallback");
 s=once(s,` if(NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED){
  $("countInlineJointCompanies").hidden=true;
  $("countCompanyRank").replaceChildren();
 }
`,"","new DOM clean on enabled only");
 const joint=take(s,"// The server-verified count contract is the ONLY authority",
   "async function loadCountDashboard(){");
 assert(joint.includes('expectedRole:"partner_owner"'));
 assert(joint.includes("identity===auth.currentUser"));
 assert(joint.includes("window.location.origin==="));
 assert(joint.includes("if(!NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED||"));
 s=once(s,joint,"","shared original-card adapter");
 s=once(s,`  if(NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED)
   await refreshVerifiedJointInlineForPartner({gen,uid,day,today,dates});
`,"","extra verified refresh");
 s=once(s,`$("countProductMode").onchange=()=>{
 if(!NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED)renderProductRankMode();
};`,
  '$("countProductMode").onchange=renderProductRankMode;',"original product mode handler");
 assert.equal(gitBlob(s),originalBlob,
  "login, UI, count editing/saving, Firebase calls and original data flow must be byte-identical");
});
test("feature OFF, only existing verification endpoint can be reached when explicitly enabled",()=>{
 assert.match(actual,/const NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED=false;/);
 assert.match(actual,/if\(!NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED\|\|/);
 assert.match(actual,/if\(NICO_PARTNER_JOINT_INLINE_CARDS_RELEASED\)\s+await refreshVerifiedJointInlineForPartner/);
 assert.match(actual,/expectedRole:"partner_owner"/);
 assert.match(actual,/identity===auth.currentUser/);
 const fn=take(actual,"// The server-verified count contract is the ONLY authority",
  "async function loadCountDashboard(){");
 assert(!/from "firebase\/firestore"|getDocs\(|getDocsFromServer\(|totalRevenue|pricePerUnit|cashback|\bCB\b/.test(fn));
 assert(fn.includes('getVerifiedJointCountRanking'));
});
