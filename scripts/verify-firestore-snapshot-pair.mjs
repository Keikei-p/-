#!/usr/bin/env node
/**
 * OFFLINE ONLY: verify two copies of a read-only Firestore document snapshot.
 * Does not call Firebase, modify files or imply production deletion is safe.
 */
import {realpath,stat,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {verifyReadOnlyFirestore} from "./firestore-readonly-snapshot.mjs";

export async function verifySnapshotPair(aPath,bPath,{maxBytes=150*1024*1024}={}){
 if(!aPath||!bPath||typeof aPath!=="string"||typeof bPath!=="string")
  throw Error("Two independent local paths are required");
 const paths=[resolve(aPath),resolve(bPath)];
 const [pa,pb]=await Promise.all(paths.map(p=>realpath(p)));
 const [a,b]=await Promise.all(paths.map(p=>stat(p)));
 if(pa===pb||(a.dev===b.dev&&a.ino===b.ino))
  throw Error("These are the same underlying backup file");
 if(!a.isFile()||!b.isFile()||a.size>maxBytes||b.size>maxBytes)
  throw Error("Backup must be a bounded regular file");
 // Each file is independently decoded and verified, not just hash-compared.
 const [copyA,copyB]=await Promise.all(paths.map(async path=>
  JSON.parse(await readFile(path,"utf8"))));
 const infoA=verifyReadOnlyFirestore(copyA),infoB=verifyReadOnlyFirestore(copyB);
 if(infoA.checksum!==infoB.checksum||
    infoA.documentCount!==infoB.documentCount||
    infoA.scannedCollections!==infoB.scannedCollections||
    infoA.scannedDocumentReferences!==infoB.scannedDocumentReferences)
  throw Error("Two backup versions are not identical");
 return {
  matching:true,documentCount:infoA.documentCount,
  scannedCollections:infoA.scannedCollections,
  checksum:infoA.checksum,completeFirebaseBackup:false,
  deletionAllowed:false,independentPhysicalMediaVerified:false
 };
}
if(process.argv[1]&&process.argv[1].endsWith("verify-firestore-snapshot-pair.mjs")){
 const paths=process.argv.slice(2);
 if(paths.length!==2){
  console.error("Usage: node scripts/verify-firestore-snapshot-pair.mjs <copy-a.json> <copy-b.json>");
  process.exitCode=2;
 }else{
  verifySnapshotPair(...paths).then(result=>{
   console.log("PASS: two independent paths with identical validated Firestore-document snapshots");
   console.log("Document count:",result.documentCount);
   console.log("SHA-256:",result.checksum);
   console.log("NOT verified: two physical media, Firebase Auth/Storage, isolated restoration.");
   console.log("NO source data was modified or deleted. NEVER delete based on this result.");
  }).catch(()=>{
   console.error("BLOCK: damaged, mismatched, unsupported, oversized or duplicate backup files");
   process.exitCode=1;
  });
 }
}
