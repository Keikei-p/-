#!/usr/bin/env node
/**
 * Production-candidate session-bound diagnostic display, not a new Auth flow.
 * Reads original STRICT four-source proof HTML byte-for-byte and changes only
 * per-account status invalidation and stale async-probe guards.
 * No Firestore writes, no account IDs or finance values persisted in reports.
 */
import {strictFour} from "../finance-diagnostic-v3/build-strict.mjs";
import {createHash} from "node:crypto";
const one=(src,oldText,newText,code)=>{
 const n=src.split(oldText).length-1;
 if(n!==1)throw Error("SESSION_PROOF_SOURCE_MISMATCH_"+code);
 return src.replace(oldText,newText);
};
export const strictBaseline=()=>strictFour();
export function sessionSafeFour(source=strictBaseline()){
 if(source!==strictBaseline())throw Error("SESSION_PROOF_UNREVIEWED_INPUT");
 let html=source;
 html=one(html,
 'let ownerHandoff=null; // Owner-verified finance document IDs only (no values)',
 'let ownerHandoff=null; // Owner-verified finance document IDs only (no values)\n'+
 'let lastAuthUid=null,probeEpoch=0; // In-memory UI state, never persisted',
 "ADD_EPOCH");
 html=one(html,
 '    const user=auth.currentUser;\n    if(!user||!user.emailVerified||location.origin!=="https://nico-factory.web.app")',
 '    const user=auth.currentUser;\n'+
 '    const currentEpoch=probeEpoch;\n'+
 '    const assertCurrent=()=>{\n'+
 '      if(probeEpoch!==currentEpoch||auth.currentUser?.uid!==user?.uid)\n'+
 '        throw Error("STALE_AUTH_PROBE");\n'+
 '    };\n'+
 '    if(!user||!user.emailVerified||location.origin!=="https://nico-factory.web.app")',
 "CAPTURE_EPOCH");
 html=one(html,
 '    const token=await user.getIdToken(true);\n    const account=await readCompany(token,user.uid);\n    if(!account)',
 '    const token=await user.getIdToken(true);\n    assertCurrent();\n'+
 '    const account=await readCompany(token,user.uid);\n    assertCurrent();\n    if(!account)',
 "CHECK_ACCOUNT");
 html=one(html,
 '      const result=await checkCollection(token,name,account.company,handoffId);\n      results[name]=result;',
 '      const result=await checkCollection(token,name,account.company,handoffId);\n'+
 '      assertCurrent();\n      results[name]=result;',
 "CHECK_FINANCE");
 html=one(html,
 '    const deniedEvery=FINANCE_COLLECTIONS.every(name=>',
 '    assertCurrent();\n    const deniedEvery=FINANCE_COLLECTIONS.every(name=>',
 "CHECK_OVERALL");
 html=one(html,
 'onAuthStateChanged(auth,user=>{\n  if(previousUid&&user?.uid!==previousUid)clearBinding();',
 'onAuthStateChanged(auth,user=>{\n'+
 '  // A badge belongs to exactly one signed-in UID; never carry a previous\n'+
 '  // account verdict into a new sign-in or a signed-out screen.\n'+
 '  const incomingUid=user?.uid??null;\n'+
 '  if(incomingUid!==lastAuthUid){\n'+
 '    lastAuthUid=incomingUid;probeEpoch++;\n'+
 '    clearBinding();\n'+
 '    $("workspace").value="";\n'+
 '    for(const name of ["identity",...FINANCE_COLLECTIONS,"counts","overall"])\n'+
 '      label(name,"未確認","unknown");\n'+
 '    // Keep ownerHandoff only in this tab: the next partner needs the\n'+
 '    // actual Owner-verified document IDs to test both GET and LIST.\n'+
 '    // No Owner token, document fields or sales values are retained.\n'+
 '  }',
 "RESET_ON_AUTH");
 if(html.length<10000||!html.includes('id="overall"')||
    !html.includes("STALE_AUTH_PROBE")||
    !html.includes('label(name,"未確認","unknown")')||
    !html.includes("mask.fieldPaths")||
    !html.includes("getIdToken(true)")||
    /localStorage|sessionStorage|console\.log\(|\b(?:setDoc|updateDoc|deleteDoc|writeBatch)\s*\(/.test(html))
  throw Error("SESSION_PROOF_READ_ONLY_CONTRACT");
 return html;
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=="--check")
  throw Error("SESSION_PROOF_NO_DEPLOY");
 const result=sessionSafeFour();
 console.log("SESSION_BOUND_FOUR_SHA256="+createHash("sha256").update(result).digest("hex"));
}
