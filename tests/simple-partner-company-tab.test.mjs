import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const menu=html.slice(html.indexOf('id="managementMenuPanel"'),html.indexOf("</div>\n\n        </div>\n\n      </div>",html.indexOf('id="managementMenuPanel"')));
const source=html.slice(html.indexOf("// A small owner-only company view"),html.indexOf("quickOwnerButton.onclick =",html.indexOf("// A small owner-only company view")));
test("existing app has an owner-only partner company entry",()=>{
 assert.match(menu,/id="quickPartnerButton"[^>]*display:none/);
 assert.match(html,/id="partnerCompanyManagement"/);
 assert.match(source,/if\(!canLoadPartnerRanking\(\)\)return;/);
 assert.match(source,/if\(!canLoadPartnerRanking\(\)\)\{/);
 assert.match(source,/currentUser\?\.uid===uid/);
 assert.match(source,/currentUserData\?\.companyId===hub/);
});
test("partner management reads existing secured count-only callable only",()=>{
 assert.match(source,/readPartnerWorkDay\(\{date\}\)/);
 assert.match(source,/readPartnerWorkDay\(\{\s*date,partnerCompanyId:company\.partnerCompanyId/);
 assert.match(source,/data\.registeredCompanies/);
 assert.match(source,/PARTNER_QUICK_RANK_KEYS/);
 for(const forbidden of ["getDocs(", "getDoc(", "onSnapshot(", "setDoc(", "updateDoc(", "deleteDoc(", "getFirestore(", ".innerHTML", "revenuePerUnit", "unitPrice", "totalRevenue"])
   assert(!source.includes(forbidden),forbidden+" must not appear in partner tab");
 assert.match(source,/textContent/);
});
test("missing company report is never presented as zero",()=>{
 assert.match(source,/未報告・未確認/);
 assert.match(source,/登録済み（0件）/);
 assert.match(source,/partnerCompanyListGeneration/);
 assert.match(html,/id="partnerCompanyDate"/);
 assert.match(html,/href="\/partner-invite\.html"/);
 assert.match(html,/href="\/partner-workspace\.html"/);
});
test("original finance capable UI retains partner exclusion and original owner data",()=>{
 assert.match(html,/function showLegacyFinanceEntryBlocked\(mode\)/);
 assert.match(html,/checkedEntry\.mode!=="internal"/);
 assert.match(html,/function recordsCollectionQuery/);
 assert.match(html,/function persistDailyRecord/);
 assert.match(html,/currentCatalogRevenuePerUnit/);
});
