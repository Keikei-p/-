#!/usr/bin/env node
/**
 * DANGEROUS INPUT ISOLATION: emulator-only data restoration rehearsal.
 * Production project IDs, non-loopback hosts and missing explicit --confirm-emulator
 * are rejected before Firebase is initialized.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {isDeepStrictEqual} from "node:util";

export function validateEmulatorTarget(env,args){
 const host=String(env.FIRESTORE_EMULATOR_HOST||"");
 const project=String(env.GCLOUD_PROJECT||env.GOOGLE_CLOUD_PROJECT||"");
 if(!/^(?:127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(host))throw Error("Local-only FIRESTORE_EMULATOR_HOST is required");
 if(project!=="demo-sales-archive-rehearsal")throw Error("Must use demo-sales-archive-rehearsal (never production project)");
 if(!args.includes("--confirm-emulator"))throw Error("--confirm-emulator flag is required");
 return {host,project};
}
const [file,...flags]=process.argv.slice(2);
if(process.argv[1]&&process.argv[1].endsWith("rehearse-sales-restore.mjs")&&file){
 const {project}=validateEmulatorTarget(process.env,flags);
 const verification=spawnSync(process.execPath,[new URL("../scripts/verify-sales-archive.mjs",import.meta.url).pathname,resolve(file)],{encoding:"utf8"});
 if(verification.status!==0)throw Error("Archive failed offline verification:\n"+verification.stderr);
 const archive=JSON.parse(await readFile(resolve(file),"utf8"));
 const originals=archive.payload.original;
 const collections=["records","products","recordCorrections","teams"];
 const data=collections.map(name=>({
  name,docs:originals[name].map(d=>({id:d.id,data:Object.fromEntries(Object.entries(d).filter(([k])=>k!=="id"))}))
 }));
 const {initializeApp}=await import("firebase-admin/app");
 const {getFirestore,Timestamp}=await import("firebase-admin/firestore");
 const revive=v=>{
  if(Array.isArray(v))return v.map(revive);
  if(v&&typeof v==="object"){
   const keys=Object.keys(v);
   if(keys.length===2&&keys.includes("seconds")&&keys.includes("nanoseconds")
      &&Number.isInteger(v.seconds)&&Number.isInteger(v.nanoseconds)){
    return new Timestamp(v.seconds,v.nanoseconds);
   }
   return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x)]));
  }
  return v;
 };
 const stable=v=>{
  if(Array.isArray(v))return v.map(stable);
  if(v instanceof Timestamp)return {seconds:v.seconds,nanoseconds:v.nanoseconds};
  if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
  return v;
 };
 const app=initializeApp({projectId:project},"sales-archive-rehearsal");
 const db=getFirestore(app);
 for(const group of data){
  if((await db.collection(group.name).limit(1).get()).size!==0)throw Error("Emulator target is not empty: "+group.name);
 }
 let saved=0;
 for(const group of data){
  for(let i=0;i<group.docs.length;i+=400){
   const batch=db.batch();
   for(const item of group.docs.slice(i,i+400)){
    if(!item.id||String(item.id).includes("/"))throw Error("Invalid original document ID");
    batch.create(db.collection(group.name).doc(item.id),revive(item.data));
   }
   await batch.commit();
   saved+=Math.min(400,group.docs.length-i);
  }
 }
 let checked=0;
 for(const group of data){
  for(const item of group.docs){
   const s=await db.collection(group.name).doc(item.id).get();
   if(!s.exists||!isDeepStrictEqual(stable(s.data()),stable(revive(item.data))))
    throw Error("Restored document mismatch: "+group.name+"/"+item.id);
   checked++;
  }
 }
 if(checked!==saved)throw Error("Restore rehearsal count mismatch");
 process.stdout.write("PASS: restored and read back "+checked+" documents in local emulator ONLY.\n");
 process.stdout.write("Original Firestore and live URLs were never accessed.\n");
}
