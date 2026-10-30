import test from "node:test";
import assert from "node:assert/strict";
import {validateManifest} from "../tools/hosting/surgical-existing-index.mjs";
const hash=c=>String(c).repeat(64);
const originals=[
  {path:"/index.html",hash:hash("a")},
  {path:"/partner-invite.html",hash:hash("b")},
  {path:"/partner-counts.html",hash:hash("c")},
  {path:"/partner-workspace.html",hash:hash("d")}
];
test("only existing index is replaced; all other live files and hashes retained",()=>{
 const {original,next}=validateManifest(originals,new Map([["/index.html",hash("e")]]),4);
 assert.equal(next.size,original.size);
 assert.equal(next.get("/index.html"),hash("e"));
 for(const [path,sha] of original)if(path!=="/index.html")assert.equal(next.get(path),sha);
 assert.equal(next.get("/partner-workspace.html"),hash("d"));
});
test("stop when index is missing, unchanged, count unexpected or additive path attempted",()=>{
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("a")]]),4),/NO_INDEX_CHANGE/);
 assert.throws(()=>validateManifest(originals.slice(1),new Map([["/index.html",hash("e")]]),3),/LIVE_INDEX_MISSING/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")]]),3),/SOURCE_FILE_COUNT_MISMATCH/);
 assert.throws(()=>validateManifest(originals,new Map([["/foo.html",hash("e")]]),4),/ONLY_ONE_REPLACED_INDEX_ALLOWED/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")],["/partner-counts.html",hash("f")]]),4),/ONLY_ONE_REPLACED_INDEX_ALLOWED/);
});
