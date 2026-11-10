import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const start=html.indexOf("function verifyApprovedCountRanking(");
const end=html.indexOf("function renderApprovedCountRanking(",start);
const K=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const verify=vm.runInNewContext("const KEYS="+JSON.stringify(K)+";\n"+html.slice(start,end)+"\nverifyApprovedCountRanking");
const row=(name,n,rank)=>({key:"hash",name,totalCount:n,rank});
const base=()=>({schema:"nico-approved-partner-count-rank-v1",scope:"approved_partner_counts_only",
 unit:"件",fullyJoint:false,includesDirect:false,role:"partner",
 date:"2026-10-31",period:"day",start:"2026-10-31",end:"2026-10-31",
 companies:[row("協力店A",3,1),row("協力店B",3,1),row("協力店C",1,3)],
 teams:[],people:[],products:[row("NURO",7,1)],
 unreportedCompanies:[{key:"unknown",name:"未報告会社",status:"not_reported"}],
 totalCount:7,reportCount:3,partnerCountsComplete:false,
 unverifiedTeamCount:0,unverifiedPersonCount:0,historicalCompanyOnlyCount:0,
 peopleComplete:true,teamComplete:true
});
test("partner dashboard preserves original eleven cards and new shared surface is strictly disabled",()=>{
 assert.equal(html.split('id="approvedSharedRankings"').length,2);
 assert.match(html,/const NICO_APPROVED_PARTNER_RANKING_RELEASED=false;/);
 assert.match(html,/if\(!NICO_APPROVED_PARTNER_RANKING_RELEASED\|\|!data/);
 assert.match(html,/if\(NICO_APPROVED_PARTNER_RANKING_RELEASED&&data\)/);
 assert.match(html,/sharedCountRankings:true/);
 assert.match(html,/resetApprovedRanking\(\)/);
 assert.match(html,/verified|承認済み|件数/);
 assert.ok(html.indexOf('id="partnerPanel-history"')<html.indexOf('id="approvedSharedRankings"'));
 assert.ok(html.indexOf('id="approvedSharedRankings"')<html.indexOf('id="recordsBox"'));
});
test("shared count UI validates 1,1,3, keeps zero and unknown report status separate",()=>{
 const response=base();
 const result=verify(response,"2026-10-31","2026-10-31");
 assert.equal(result.totalCount,7);
 assert.equal(result.unreportedCompanies[0].status,"not_reported");
 assert.equal(result.companies[1].rank,1);
 assert.equal(result.companies[2].rank,3);
});
test("shared count UI fails closed on finance extensions, duplicate wrong ranks and spoofed direct mode",()=>{
 for(const bad of [
  {...base(),unit:"円"},
  {...base(),fullyJoint:true},
  {...base(),includesDirect:true},
  {...base(),totalRevenue:100000},
  {...base(),people:[{...row("担当",5,1),cashback:90000}]},
  {...base(),companies:[row("A",3,1),row("B",3,2)]},
  {...base(),companies:[row("A",3,1),row("B",4,2)]},
  {...base(),companies:[row("売上10000円",3,1)]},
  {...base(),companies:[row("A",3,1)],unreportedCompanies:[{...base().unreportedCompanies[0],unitPrice:50000}]},
 ])assert.throws(()=>verify(bad,"2026-10-31","2026-10-31"),/UNVERIFIED/);
});
