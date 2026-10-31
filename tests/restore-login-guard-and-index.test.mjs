import test from "node:test";
import assert from "node:assert/strict";
import {validateManifest,uploadLoginRecovery,ASSET,GUARD} from "../tools/hosting/restore-login-guard-and-index.mjs";
const hex=c=>c.repeat(64);
const originals=[
 {path:"/index.html",hash:hex("a")},
 {path:"/partner-invite.html",hash:hex("b")},
 {path:"/partner-counts.html",hash:hex("c")},
 {path:"/partner-workspace.html",hash:hex("d")},
 {path:"/service-worker.js",hash:hex("1")},
 {path:"/manifest.webmanifest",hash:hex("2")},
 {path:"/favicon.ico",hash:hex("3")},
 {path:"/assets/app.js",hash:hex("4")},
 {path:"/assets/theme.css",hash:hex("5")},
 {path:"/icons/app.svg",hash:hex("6")},
 {path:"/robots.txt",hash:hex("7")}
];
const additions=new Map([[ASSET,hex("e")],[GUARD,hex("f")]]);
test("atomic recovery adds missing finance guard, changes only index and retains every other original hash",()=>{
 const {original,next}=validateManifest(originals,additions,11);
 assert.equal(next.size,12);
 assert.equal(next.get("/index.html"),hex("e"));
 assert.equal(next.get(GUARD),hex("f"));
 for(const [path,hash] of original)
   if(path!=="/index.html")assert.equal(next.get(path),hash);
});
test("fail closed on any pre-existing finance guard, changed old file, bad original or more assets",()=>{
 assert.throws(()=>validateManifest([...originals,{path:GUARD,hash:hex("9")}],additions,12),/EXISTING_GUARD_ASSET_REQUIRES_REVIEW/);
 assert.throws(()=>validateManifest(originals,new Map([[ASSET,hex("a")],[GUARD,hex("f")]]),11),/NO_INDEX_CHANGE/);
 assert.throws(()=>validateManifest(originals,additions,10),/SOURCE_FILE_COUNT_MISMATCH/);
 assert.throws(()=>validateManifest(originals,new Map([[ASSET,hex("e")],[GUARD,hex("f")],["/other",hex("1")]]),11),/ONLY_INDEX_AND_NEW_GUARD_ALLOWED/);
 assert.throws(()=>validateManifest(originals,new Map([[ASSET,hex("e")],["/other",hex("f")]]),11),/ONLY_INDEX_AND_NEW_GUARD_ALLOWED/);
 assert.throws(()=>validateManifest(originals.slice(1),additions,10),/LIVE_INDEX_MISSING/);
});
const index=Buffer.from(('mergedPartnerRankingDay partnerInviteInline 営業実績管理 from "./legacy-finance-entry-guard.mjs" const memberForCheck=trustedMember.companyId==null').repeat(20));
const guard=Buffer.from(('export function classifyLegacySalesEntrypoint(){}').repeat(20));
const mock=(version="sites/nico-factory/versions/9039213fe6907270",fileCountMissing=true)=>{
 const seen=[];
 const request=async(method,url)=>{
   seen.push({method,url});
   if(method!=="GET")throw Error("MOCK_REMOTE_WRITE");
   if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
     return {releases:[{version:{name:version}}]};
   if(url.endsWith("/"+version))
     return {name:version,status:"FINALIZED",config:{headers:[]},
       ...(fileCountMissing?{}:{fileCount:originals.length})};
   if(url.includes("/"+version+"/files?"))return {files:originals};
   throw Error("MOCK_UNRECOGNIZED_URL "+url);
 };
 return {seen,request};
};
test("read-only dry run accepts audited 11-file source and never writes",async()=>{
 const m=mock();
 const r=await uploadLoginRecovery({assetBytes:index,guardBytes:guard,request:m.request,release:false,log:()=>{}});
 assert.equal(r.released,false);
 assert.equal(r.originalCount,11);
 assert.equal(m.seen.every(x=>x.method==="GET"),true);
});
test("reject unreviewed missing-count source and missing valid guard without deployment",async()=>{
 const m=mock("sites/nico-factory/versions/not_reviewed_123");
 await assert.rejects(uploadLoginRecovery({assetBytes:index,guardBytes:guard,request:m.request,log:()=>{}}),/UNREVIEWED_LIVE_VERSION_MISSING_COUNT/);
 assert.equal(m.seen.every(x=>x.method==="GET"),true);
 const n=mock();
 await assert.rejects(uploadLoginRecovery({assetBytes:index,guardBytes:Buffer.from("not a guard"),request:n.request,log:()=>{}}),/INVALID_OR_MISSING_FINANCE_GUARD/);
 assert.equal(n.seen.length,0);
});
