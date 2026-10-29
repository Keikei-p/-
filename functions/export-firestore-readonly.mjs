#!/usr/bin/env node
/**
 * MANUAL LOCAL-ONLY READ, NEVER A PRODUCTION DEPLOYMENT.
 *
 * Requires an administrator's explicit CLI confirmation and existing Firebase
 * ADC credentials on their own computer. Does not authenticate the user here.
 * Does not delete, change or import ANY Firestore documents.
 *
 * This captures Firestore documents only, not Auth users, Cloud Storage,
 * Rules, indexes, hosting or backups on independent media.
 */
import {resolve,isAbsolute} from "node:path";
import {writeFile} from "node:fs/promises";
import {captureReadOnlyFirestore,verifyReadOnlyFirestore}
 from "../scripts/firestore-readonly-snapshot.mjs";

const PROJECT="sales-management-cc116";
const args=process.argv.slice(2);
const option=(prefix)=>{
 const matches=args.filter(x=>x.startsWith(prefix));
 if(matches.length!==1)throw Error("Explicit argument required: "+prefix);
 return matches[0].slice(prefix.length);
};
async function main(){
 if(!args.includes("--acknowledge-read-quotas")||
    option("--confirm-readonly-project=")!==PROJECT)
  throw Error("Administrator must confirm project and read quotas");
 const requestedOutput=option("--output=");
 if(!requestedOutput||!isAbsolute(requestedOutput))
  throw Error("Output must be an absolute local file path");
 const output=resolve(requestedOutput);
 if(!output.toLowerCase().endsWith(".json"))
  throw Error("Output filename must end with .json");
 const amount=args.find(x=>x.startsWith("--max-documents="));
 const maxDocuments=amount?Number(amount.split("=",2)[1]):10000;
 if(!Number.isSafeInteger(maxDocuments)||maxDocuments<1||
    maxDocuments>250000)
  throw Error("Invalid maximum read count");
 if(process.env.FIRESTORE_EMULATOR_HOST)
  throw Error("Do not mix this live inventory CLI with emulator credentials");
 if(!process.env.GOOGLE_APPLICATION_CREDENTIALS)
  throw Error("No local service-account credentials path configured");
 // Dynamic imports deliberately happen AFTER all guards, so invalid
 // arguments cannot initialize Firebase or trigger network access.
 const {initializeApp,applicationDefault,deleteApp}=await import("firebase-admin/app");
 const {getFirestore}=await import("firebase-admin/firestore");
 const app=initializeApp({
  credential:applicationDefault(),projectId:PROJECT
 },"nico-offline-readonly-backup");
 try{
  const firestore=getFirestore(app);
  const reader={
   listRootCollections:async()=> (await firestore.listCollections()).map(x=>x.id),
   listDocuments:async p=> (await firestore.collection(p).listDocuments()).map(x=>x.id),
   getDocument:async p=>{
    const snap=await firestore.doc(p).get();
    return snap.exists?{exists:true,data:snap.data()}:{exists:false};
   },
   listSubcollections:async p=> (await firestore.doc(p).listCollections()).map(x=>x.id)
  };
  const backup=await captureReadOnlyFirestore({
   reader,projectId:PROJECT,maxDocuments
  });
  const info=verifyReadOnlyFirestore(backup);
  // wx + 0600 prevents overwriting any existing file. No deletion on errors.
  await writeFile(output,JSON.stringify(backup),{
   encoding:"utf8",flag:"wx",mode:0o600
  });
  console.log("READ-ONLY SNAPSHOT SAVED. Documents:",info.documentCount);
  console.log("Collections scanned:",info.scannedCollections);
  console.log("SHA-256:",info.checksum);
  console.log("NO Firebase writes/deletions/imports were performed.");
  console.log("This is NOT a full Firebase Auth/Storage backup and does NOT permit deletion.");
  console.log("Save TWO verified copies on separate media; restore only to an isolated test environment.");
 }finally{
  await deleteApp(app);
 }
}
main().catch(error=>{
 // Never print user data, tokens, document paths or credential paths.
 console.error("READ-ONLY SNAPSHOT FAILED:",error?.message?.includes("Backup inventory refused")
  ?error.message:"check CLI arguments, read budget, credentials or network");
 process.exitCode=1;
});
