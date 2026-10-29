#!/usr/bin/env node
/**
 * NEVER connects to or writes Firebase production.
 * Restores only raw Firestore document fields and IDs to a separate localhost
 * Firestore emulator project. createTime/updateTime cannot be restored.
 * No credentials, billing, cloud APIs or actual-data logging.
 */
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {canonical,fingerprint,unseal,PROJECT} from "./backup.mjs";

export const TEST_PROJECT="demo-sales-restore";
const MAX_DOCS=10000;

export function emulatorBase(host,projectId){
  // Fail closed: no user-supplied hostname, cloud endpoint, or real project ID.
  if(projectId!==TEST_PROJECT||typeof host!=="string"||
     !/^127\.0\.0\.1:(?:[1-9]\d{0,4})$/.test(host))
    throw Error("BLOCK: only a local Firestore emulator and demo project are allowed");
  const port=Number(host.slice(host.indexOf(":")+1));
  if(port>65535)throw Error("BLOCK: invalid emulator port");
  return "http://"+host+"/v1/projects/"+TEST_PROJECT+"/databases/(default)/documents/";
}
function checkedDocuments(snapshot,maxDocuments){
  fingerprint(snapshot);
  if(!Number.isSafeInteger(maxDocuments)||maxDocuments<1||maxDocuments>MAX_DOCS)
    throw Error("BLOCK: invalid emulator-only document limit");
  if(!snapshot.documents.length||snapshot.documents.length>maxDocuments)
    throw Error("BLOCK: document count outside the local restore budget");
  const unique=new Set();
  return snapshot.documents.map(row=>{
    const parts=row.path.split("/");
    if(parts.length<2||parts.length%2!==0||parts.some(part=>!part||part==="."||part===".."))
      throw Error("BLOCK: malformed document path in archive");
    if(unique.has(row.path))throw Error("BLOCK: repeated document path");
    unique.add(row.path);
    const fields=row.value?.fields;
    if(!fields||typeof fields!=="object"||Array.isArray(fields))
      throw Error("BLOCK: incomplete stored Firestore fields");
    return {segments:parts,fields};
  });
}
export async function restoreToLocalEmulator(snapshot,{
  emulatorHost,projectId=TEST_PROJECT,send=fetch,maxDocuments=MAX_DOCS
}={}){
  const base=emulatorBase(emulatorHost,projectId);
  // Complete preflight before the first emulator write.
  const docs=checkedDocuments(snapshot,maxDocuments);
  const digest=fingerprint(snapshot);
  for(const row of docs){
    const endpoint=base+row.segments.map(encodeURIComponent).join("/");
    // A production Firestore endpoint cannot be constructed by this function.
    const response=await send(endpoint,{
      method:"PATCH",
      headers:{"Content-Type":"application/json","Authorization":"Bearer owner"},
      body:JSON.stringify({fields:row.fields})
    });
    if(!response?.ok)throw Error("BLOCK: emulator restore write failed");
    const saved=await response.json();
    if(canonical(saved.fields??{})!==canonical(row.fields))
      throw Error("BLOCK: emulator stored fields differ from archive");
  }
  let verified=0;
  for(const row of docs){
    const endpoint=base+row.segments.map(encodeURIComponent).join("/");
    const response=await send(endpoint,{method:"GET",
      headers:{"Authorization":"Bearer owner"}});
    if(!response?.ok)throw Error("BLOCK: emulator restore readback failed");
    const saved=await response.json();
    if(canonical(saved.fields??{})!==canonical(row.fields))
      throw Error("BLOCK: emulator readback fields differ from archive");
    verified++;
  }
  return {destinationProject:TEST_PROJECT,documentCount:verified,
    sourceInventoryFingerprint:digest,fieldsAndIdsVerified:true,
    metadataTimestampsPreserved:false,productionTouched:false};
}
async function main(args){
  const flag=name=>{
    const index=args.indexOf(name);
    return index<0?null:args[index+1]??null;
  };
  if(flag("--confirm")!=="LOCAL_EMULATOR_ONLY")throw Error("BLOCK: explicit emulator-only confirmation required");
  const file=flag("--file");
  if(!file||!path.isAbsolute(file)||!file.endsWith(".salesbak"))
    throw Error("BLOCK: encrypted local .salesbak absolute path required");
  const pass=process.env.SALES_BACKUP_PASSPHRASE;
  if(!pass||pass.length<20)throw Error("BLOCK: backup passphrase required");
  const input=unseal(fs.readFileSync(file),pass);
  const result=await restoreToLocalEmulator(input,{
    emulatorHost:process.env.FIRESTORE_EMULATOR_HOST,
    projectId:process.env.GCLOUD_PROJECT,
    maxDocuments:Number(flag("--max-documents")??"10000")
  });
  console.log("PASS: isolated local emulator fields and document IDs checked");
  console.log("Number of documents:",result.documentCount);
  console.log("Source archive SHA-256:",result.sourceInventoryFingerprint);
  console.log("Limit: original create/update metadata, Auth, Functions, Rules, real production coverage NOT restored");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(()=>{
    // User content, keys, paths and underlying API error bodies must not print.
    console.error("BLOCK: emulator-only restore validation failed. No Firebase production API used.");
    process.exitCode=1;
  });
}
