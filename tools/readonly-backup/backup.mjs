#!/usr/bin/env node
/**
 * Manual, local-only Firestore REST inventory. NEVER schedules, deploys,
 * writes Firestore data, uploads archives, or makes public backups.
 * Uses only GET documents:list and POST documents:listCollectionIds.
 * The latter is a read-only Firestore method despite HTTP POST.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash,createCipheriv,createDecipheriv,randomBytes,scryptSync} from "node:crypto";

export const PROJECT="sales-management-cc116";
const ROOT="projects/"+PROJECT+"/databases/(default)/documents";
const MAGIC=Buffer.from("SALEBKP1");
const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");

export function canonical(value){
  if(value===null || typeof value==="string" || typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number" && Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value && typeof value==="object"){
    return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
  }
  throw Error("Invalid snapshot JSON");
}
const hash=(x)=>createHash("sha256").update(x).digest("hex");

function safeApiPath(resource){
  if(!resource.startsWith(ROOT))throw Error("Unexpected Firestore resource");
  return resource.split("/").map(encodeURIComponent).join("/");
}
export function validateSafeCall(method,uri,body){
  const u=new URL(uri);
  if(u.origin!=="https://firestore.googleapis.com" ||
    !u.pathname.startsWith("/v1/projects/"+PROJECT+"/databases/(default)/documents") ||
    u.username || u.password || u.hash)return false;
  if(method==="GET"){
    if(u.pathname.includes(":") || body!==undefined)return false;
    if([...u.searchParams.keys()].some(k=>!["pageSize","pageToken","showMissing"].includes(k)))return false;
    return true;
  }
  if(method==="POST" && u.pathname.endsWith(":listCollectionIds") &&
    u.search==="" && body && typeof body==="object" && !Array.isArray(body) &&
    Object.keys(body).every(k=>["pageSize","pageToken"].includes(k)))return true;
  return false;
}
function assertSafe(method,uri,body){
  if(!validateSafeCall(method,uri,body))throw Error("Blocked non-read-only Firestore request");
}
function pageTokenSeen(seen,token){
  if(!token)return;
  if(seen.has(token))throw Error("Duplicate API page token");
  seen.add(token);
}
/**
 * Walks all collection IDs and documents, including descendants of a missing
 * parent document (showMissing=true). No credentials or network in this helper.
 * GET/POST response format is the official Firestore REST v1 JSON wire format.
 */
export async function collect(getJson,{maxDocuments=10000}={}){
  if(!Number.isSafeInteger(maxDocuments) || maxDocuments<1 || maxDocuments>50000)
    throw Error("Invalid maximum documents");
  const documents=[];
  const seenPaths=new Set();
  let references=0,requests=0;
  async function request(method,url,body){
    assertSafe(method,url,body);
    requests++;
    if(requests>maxDocuments*8+400)throw Error("Too many API requests. Backup incomplete");
    return getJson(method,url,body);
  }
  async function collectionIds(parent){
    const ids=new Set(),seen=new Set();
    let pageToken="";
    do{
      const url="https://firestore.googleapis.com/v1/"+safeApiPath(parent)+":listCollectionIds";
      const payload={pageSize:100};
      if(pageToken)payload.pageToken=pageToken;
      const page=await request("POST",url,payload);
      if(!page || !Array.isArray(page.collectionIds??[]))throw Error("Invalid collection listing");
      for(const id of page.collectionIds??[]){
        if(typeof id!=="string" || !id || id.includes("/"))throw Error("Invalid collection ID");
        ids.add(id);
      }
      pageToken=page.nextPageToken||"";
      pageTokenSeen(seen,pageToken);
    }while(pageToken);
    return [...ids].sort();
  }
  async function walk(parent){
    for(const id of await collectionIds(parent)){
      const prefix=parent+"/"+id+"/";
      const seen=new Set();
      let pageToken="";
      do{
        const url=new URL("https://firestore.googleapis.com/v1/"+safeApiPath(parent)+"/"+encodeURIComponent(id));
        url.searchParams.set("pageSize","100");
        url.searchParams.set("showMissing","true");
        if(pageToken)url.searchParams.set("pageToken",pageToken);
        const page=await request("GET",url.toString());
        if(!page || !Array.isArray(page.documents??[]))throw Error("Invalid document listing");
        for(const doc of page.documents??[]){
          if(typeof doc.name!=="string" || !doc.name.startsWith(prefix) ||
            doc.name.slice(prefix.length).includes("/") || doc.name===prefix)
            throw Error("Invalid document path in Firestore response");
          references++;
          if(references>maxDocuments*3+500)throw Error("Too many document references. Backup incomplete");
          if(seenPaths.has(doc.name))throw Error("Repeated Firestore path");
          seenPaths.add(doc.name);
          const exists=doc.createTime!==undefined || doc.updateTime!==undefined || doc.fields!==undefined;
          if(exists){
            if(!doc.createTime || !doc.updateTime || typeof(doc.fields??{})!=="object")
              throw Error("Invalid Firestore document fields or times");
            if(documents.length>=maxDocuments)throw Error("Document read budget exceeded. Backup incomplete");
            // Keep original Firestore REST wire values (integers as strings,
            // timestamps, bytes, GeoPoints and references are preserved).
            documents.push({
              path:doc.name.slice(ROOT.length+1),
              value:{
                fields:doc.fields??{},
                createTime:doc.createTime,
                updateTime:doc.updateTime
              }
            });
          }
          // Traverse even a missing parent, whose children may still exist.
          await walk(doc.name);
        }
        pageToken=page.nextPageToken||"";
        pageTokenSeen(seen,pageToken);
      }while(pageToken);
    }
  }
  await walk(ROOT);
  if(documents.length===0)throw Error("No documents found; refusing an empty backup");
  documents.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {projectId:PROJECT,format:"firestore-rest-typed-v1",documents};
}
export function fingerprint(snapshot){
  if(!snapshot || snapshot.projectId!==PROJECT ||
    snapshot.format!=="firestore-rest-typed-v1" || !Array.isArray(snapshot.documents))
    throw Error("Unknown archive project or format");
  const paths=new Set();
  for(const doc of snapshot.documents){
    if(typeof doc.path!=="string" || paths.has(doc.path) ||
      !doc.value || typeof doc.value!=="object")throw Error("Invalid or duplicate document");
    paths.add(doc.path);
  }
  return hash(canonical(snapshot.documents.slice().sort((a,b)=>a.path.localeCompare(b.path))));
}
function requirePassphrase(){
  const pass=process.env.SALES_BACKUP_PASSPHRASE;
  if(!pass || pass.length<20)throw Error("SALES_BACKUP_PASSPHRASE needs at least 20 characters");
  return pass;
}
export function seal(data,passphrase){
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(passphrase,salt,32);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),"utf8"),cipher.final()]);
  return Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),ciphertext]);
}
export function unseal(payload,passphrase){
  if(payload.length<=52 || !payload.subarray(0,8).equals(MAGIC))throw Error("Invalid encrypted archive format");
  const salt=payload.subarray(8,24),iv=payload.subarray(24,36),tag=payload.subarray(36,52);
  const decipher=createDecipheriv("aes-256-gcm",scryptSync(passphrase,salt,32),iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(52)),decipher.final()]).toString("utf8"));
}
function archiveFile(file){
  return unseal(fs.readFileSync(file),requirePassphrase());
}
function safeOutput(dest){
  if(!dest || !path.isAbsolute(dest))throw Error("Backup output must be an absolute local path");
  if(!dest.endsWith(".salesbak"))throw Error("Output must end with .salesbak");
  const rel=path.relative(REPO_ROOT,path.resolve(dest));
  if(rel==="" || (!rel.startsWith(".."+path.sep) && rel!==".." && !path.isAbsolute(rel)))
    throw Error("Never store backups inside the GitHub repository");
  if(fs.existsSync(dest))throw Error("Refusing to overwrite existing backup");
}
function argValue(args,flag){
  const i=args.indexOf(flag);
  return i<0?null:args[i+1]??null;
}
async function main(args){
  const command=args[0];
  if(command==="verify"){
    const file=argValue(args,"--file");
    if(!file)throw Error("Specify --file");
    const snap=archiveFile(file);
    console.log("Archive authenticity: PASS (AES-256-GCM)");
    console.log("Project:",snap.projectId,"Documents:",snap.documents?.length);
    console.log("SHA-256:",fingerprint(snap));
    return;
  }
  if(command==="compare"){
    const before=argValue(args,"--before"),after=argValue(args,"--after");
    if(!before||!after)throw Error("Specify --before and --after");
    const a=archiveFile(before),b=archiveFile(after);
    const fa=fingerprint(a),fb=fingerprint(b);
    console.log("Before documents:",a.documents.length,"After documents:",b.documents.length);
    console.log("SHA-256 match:",fa===fb?"YES":"NO");
    if(fa!==fb)throw Error("BLOCK: supplied backups do not match");
    console.log("PASS: supplied backups match; live database completeness is NOT proven");
    return;
  }
  if(command!=="backup")throw Error("Use: backup, verify or compare");
  if(argValue(args,"--project")!==PROJECT ||
    argValue(args,"--confirm")!=="READ_ONLY_LOCAL_BACKUP")
    throw Error("Explicit project and confirmation required; nothing executed");
  const output=argValue(args,"--out");
  safeOutput(output);
  const max=Number(argValue(args,"--max-documents")??"10000");
  if(!Number.isSafeInteger(max)||max<1||max>50000)throw Error("Invalid document limit");
  const pass=requirePassphrase();
  const creds=process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if(!creds || !fs.existsSync(creds))throw Error("Local Google credentials file not found");
  const credential=JSON.parse(fs.readFileSync(creds,"utf8"));
  if(credential.project_id!==PROJECT)throw Error("Credentials belong to another project");
  // Deliberately import after all local safety checks. No call to Firebase
  // Admin write APIs, Cloud Storage, import, deploy or rules endpoints.
  const {GoogleAuth}=await import("google-auth-library");
  const auth=new GoogleAuth({projectId:PROJECT,scopes:["https://www.googleapis.com/auth/datastore"]});
  const getJson=async(method,url,body)=>{
    const response=await auth.request({
      url,method,...(body?{data:body}:{}),
      timeout:30000
    });
    return response.data;
  };
  const snapshot=await collect(getJson,{maxDocuments:max});
  const digest=fingerprint(snapshot);
  const encrypted=seal(snapshot,pass);
  fs.writeFileSync(output,encrypted,{flag:"wx",mode:0o600});
  try{
    const verified=archiveFile(output);
    if(fingerprint(verified)!==digest)throw Error("Archive verification failure");
  }catch(err){fs.rmSync(output,{force:true});throw err;}
  console.log("PASS: local encrypted read-only archive created and verified");
  console.log("Project:",PROJECT,"Documents:",snapshot.documents.length,"SHA-256:",digest);
  console.log("IMPORTANT: this is not an atomic point-in-time snapshot or tested restore");
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(err=>{
    // Never print credential paths, API response bodies, PII or individual docs.
    const safe=err.message.startsWith("BLOCK") ||
      /^(Backup output|Output must|Never store|Refusing|Specify|Use:|Explicit|Invalid|Local Google|Credentials|No documents|Document read budget|Too many)/.test(err.message);
    console.error("BLOCK:",safe?err.message:"Read-only backup failed. Inspect local credentials, permissions, or network privately.");
    process.exitCode=1;
  });
}
