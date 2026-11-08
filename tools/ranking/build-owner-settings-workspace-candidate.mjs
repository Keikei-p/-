#!/usr/bin/env node
/**
 * STAGING ONLY — build an inlined candidate from reviewed partner HTML.
 * Do not write to source HTML and NEVER deploy production Hosting.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));
export const REVIEWED_PARTNER_HTML_BLOB="00d6d503f9061dba2b6113e52b99cb9c4ea3aedf";
const gitBlob=text=>createHash("sha1").update("blob "+
  Buffer.byteLength(text,"utf8")+"\u0000").update(text).digest("hex");
function exactlyOnce(src,needle,replacement,label){
 if(src.split(needle).length!==2)
  throw Error("STOP_RANKING_UI_UNREVIEWED_ANCHOR_"+label);
 return src.replace(needle,replacement);
}
function moduleCode(src,{bridge=false}={}){
 if(typeof src!=="string"||src.length<2500||
    src.includes("</script>")||src.includes("</style>"))
  throw Error("STOP_RANKING_UI_UNSAFE_MODULE_TEXT");
 let next=src;
 if(bridge){
  next=exactlyOnce(next,
    'import {validateOwnerRankingConsentStatus} from "./owner-ranking-consent-panel.mjs";',
    "","BRIDGE_IMPORT");
 }
 if(!/export function create(?:OwnerRankingConsentPanel|RankingOwnerFirebaseBridge)/.test(next))
   throw Error("STOP_RANKING_UI_MODULE_EXPORT");
 next=next.replaceAll("export function ","function ");
 if(/^(?:import|export)\s+/m.test(next))
   throw Error("STOP_RANKING_UI_MODULE_STILL_UNBUNDLED");
 return next;
}
export function buildRankingOwnerWorkspaceCandidate({
 original,panel,bridge,css
}={}){
 if(typeof original!=="string"||
    gitBlob(original)!==REVIEWED_PARTNER_HTML_BLOB)
  throw Error("STOP_RANKING_UI_ORIGINAL_BLOB_CHANGED");
 if(typeof css!=="string"||css.length<800||css.includes("</style>")||
    /@import|url\s*\(/i.test(css))
  throw Error("STOP_RANKING_UI_UNSAFE_STYLE");
 const modules=[
 "/* STAGING ONLY: reviewed inline owner settings modules (not deployed). */",
 "const RankingOwnerPanelModule=(()=>{",
 moduleCode(panel),
 "return {createOwnerRankingConsentPanel,validateOwnerRankingConsentStatus};",
 "})();",
 "const RankingOwnerBridgeModule=(({validateOwnerRankingConsentStatus})=>{",
 moduleCode(bridge,{bridge:true}),
 "return {createRankingOwnerFirebaseBridge};",
 "})(RankingOwnerPanelModule);",
 "const RankingOwnerIntegration={",
 " createOwnerRankingConsentPanel:RankingOwnerPanelModule.createOwnerRankingConsentPanel,",
 " createRankingOwnerFirebaseBridge:RankingOwnerBridgeModule.createRankingOwnerFirebaseBridge",
 "};",
 "let rankingOwnerPanel=null;",
 "function rankingOwnerAllowed(){",
 ' return Boolean(data&&(data.role==="hub"||data.role==="owner")&&',
 "   auth.currentUser?.emailVerified===true&&",
 "   !activeCodeSession&&!workspaceCompanyId);",
 "}",
 "function closeRankingOwnerPanel(){",
 " if(rankingOwnerPanel){",
 "  rankingOwnerPanel.destroy();rankingOwnerPanel=null;",
 " }",
 ' const box=$("rankingOwnerContent");if(box)box.replaceChildren();',
 "}",
 "async function openRankingOwnerPanel(){",
 " closeRankingOwnerPanel();",
 " if(!rankingOwnerAllowed())return false;",
 " const identity=auth.currentUser;",
 " const currentNonce=nonce;",
 " const bridge=RankingOwnerIntegration.createRankingOwnerFirebaseBridge({",
 "  auth,functions,httpsCallable,",
 "  sharedCodeSession:()=>Boolean(activeCodeSession||workspaceCompanyId)",
 " });",
 " rankingOwnerPanel=RankingOwnerIntegration.createOwnerRankingConsentPanel({",
 '  document,root:$("rankingOwnerContent"),',
 "  loadStatus:bridge.loadStatus,saveConsent:bridge.saveConsent",
 " });",
 " const thisPanel=rankingOwnerPanel;",
 " const ok=await thisPanel.refresh();",
 " if(nonce!==currentNonce||auth.currentUser!==identity||",
 '    activeWorkspaceTab!=="RankingSettings"||!rankingOwnerAllowed()){',
 "  if(rankingOwnerPanel===thisPanel)closeRankingOwnerPanel();",
 "  return false;",
 " }",
 " return ok;",
 "}",
 '$("tabRankingSettings").onclick=()=>{',
 " if(!rankingOwnerAllowed())return;",
 ' activeTab("RankingSettings");',
 " void openRankingOwnerPanel();",
 "};"
 ].join("\n");
 let html=original;
 html=exactlyOnce(html,"</style></head><body>",
  css+"\n</style></head><body>","STYLE");
 html=exactlyOnce(html,
  '<button type="button" id="tabMissing" aria-pressed="false">⚠️ 報告漏れ</button></div></section>',
  '<button type="button" id="tabMissing" aria-pressed="false">⚠️ 報告漏れ</button>\n'+
  '<button type="button" id="tabRankingSettings" aria-pressed="false" hidden>🔐 合同ランキング公開設定</button></div></section>',
  "NAV");
 html=exactlyOnce(html,'<section id="dashboardBox" hidden>',
  '<section id="rankingOwnerBox" hidden aria-label="合同ランキング公開設定">'+
  '<p class="muted">金額・単価・CBは公開しません。新APIの本番検証完了まではこの設定は利用できません。</p>'+
  '<div id="rankingOwnerContent" aria-live="polite"></div></section>\n'+
  '<section id="dashboardBox" hidden>',"BOX");
 html=exactlyOnce(html,
  'if(data?.role==="hub"&&name!=="Missing")name="View";',
  'if(name==="RankingSettings"&&!rankingOwnerAllowed())'+
  'name=data?.role==="hub"?"View":"Dashboard";\n '+
  'if(data?.role==="hub"&&name!=="Missing"&&name!=="RankingSettings")name="View";\n '+
  'if(name!=="RankingSettings")closeRankingOwnerPanel();',"HUB_TAB");
 html=exactlyOnce(html,
  'for(const x of ["Dashboard","Records","People","View","Missing"])\n  $("tab"+x).setAttribute("aria-pressed",String(x===name));',
  'for(const x of ["Dashboard","Records","People","View","Missing","RankingSettings"])\n  $("tab"+x).setAttribute("aria-pressed",String(x===name));\n '+
  '$("rankingOwnerBox").hidden=name!=="RankingSettings";',"TAB_STATES");
 html=exactlyOnce(html,
  '$("hubBox").hidden=data?.role!=="hub"||name==="Missing";',
  '$("hubBox").hidden=data?.role!=="hub"||name==="Missing"||name==="RankingSettings";',
  "HUB_BOX");
 html=exactlyOnce(html,
  '$("tabDashboard").hidden=hub;$("tabRecords").hidden=hub;$("tabPeople").hidden=hub||data.role==="member";$("tabView").hidden=hub;',
  '$("tabDashboard").hidden=hub;$("tabRecords").hidden=hub;$("tabPeople").hidden=hub||data.role==="member";$("tabView").hidden=hub;\n '+
  '$("tabRankingSettings").hidden=!rankingOwnerAllowed();',
  "DRAW_VISIBILITY");
 html=exactlyOnce(html,
  'activeTab(activeWorkspaceTab==="Missing"?"Missing":"View");const table=document.createElement("table");',
  'activeTab(activeWorkspaceTab==="RankingSettings"&&rankingOwnerAllowed()?"RankingSettings":activeWorkspaceTab==="Missing"?"Missing":"View");const table=document.createElement("table");',
  "DRAW_HUB");
 html=exactlyOnce(html,
  'activeTab(needsSetup?"People":$("tabMissing").getAttribute("aria-pressed")==="true"?"Missing":',
  'activeTab(activeWorkspaceTab==="RankingSettings"&&rankingOwnerAllowed()?"RankingSettings":needsSetup?"People":$("tabMissing").getAttribute("aria-pressed")==="true"?"Missing":',
  "DRAW_PARTNER");
 html=exactlyOnce(html,
  'data=res;countDayCache.set((activeCodeSession?"code-session":"email-"+auth.currentUser.uid)+"|"+res.date,{savedAt:Date.now(),response:res});draw();notice("最新の件数を読み込みました。");',
  'closeRankingOwnerPanel();data=res;countDayCache.set((activeCodeSession?"code-session":"email-"+auth.currentUser.uid)+"|"+res.date,{savedAt:Date.now(),response:res});draw();\n '+
  'if(activeWorkspaceTab==="RankingSettings"&&rankingOwnerAllowed())void openRankingOwnerPanel();\n '+
  'notice("最新の件数を読み込みました。");',
  "REFRESH_RESULT");
 html=exactlyOnce(html,
  'data=null;$("appBox").hidden=true;\n  if(activeCodeSession',
  'closeRankingOwnerPanel();data=null;$("appBox").hidden=true;\n  if(activeCodeSession',
  "REFRESH_FAIL");
 html=exactlyOnce(html,
  'onAuthStateChanged(auth,async u=>{\n // Every new authentication state must require a FRESH membership decision.',
  'onAuthStateChanged(auth,async u=>{\n closeRankingOwnerPanel();\n $("rankingOwnerBox").hidden=true;\n $("tabRankingSettings").hidden=true;\n // Every new authentication state must require a FRESH membership decision.',
  "AUTH_CHANGE");
 html=exactlyOnce(html,"</script></body></html>",
  modules+"\n</script></body></html>","INLINE_INTEGRATION");
 if(html.includes('src="./ranking/')||
    !html.includes('RankingOwnerIntegration.createRankingOwnerFirebaseBridge')||
    !html.includes('activeTab("RankingSettings")')||
    html.includes('getFirestore(')||html.includes('firebase-firestore.js'))
   throw Error("STOP_RANKING_UI_BOUNDARY");
 return html;
}
export function buildCandidateFromRepo(){
 return buildRankingOwnerWorkspaceCandidate({
  original:readFileSync(path.join(ROOT,"partner-workspace.html"),"utf8"),
  panel:readFileSync(path.join(ROOT,"ranking/owner-ranking-consent-panel.mjs"),"utf8"),
  bridge:readFileSync(path.join(ROOT,"ranking/owner-ranking-consent-firebase-bridge.mjs"),"utf8"),
  css:readFileSync(path.join(ROOT,"ranking/owner-ranking-consent-panel.css"),"utf8")
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4||process.argv[2]!=="--out"||
    !path.isAbsolute(process.argv[3])||
    !/^\/(?:tmp|mnt\/data|home\/runner\/work\/_temp)\/[A-Za-z0-9._-]+[.]html$/.test(process.argv[3]))
  throw Error("STOP_STAGING_OUTPUT_PATH_ONLY");
 const content=buildCandidateFromRepo();
 writeFileSync(process.argv[3],content,{encoding:"utf8",flag:"w",mode:0o600});
 console.log("RANKING_OWNER_STAGING_CANDIDATE_CREATED_NO_FIREBASE_DEPLOY");
 console.log("CANDIDATE_BYTES="+Buffer.byteLength(content,"utf8"));
}
