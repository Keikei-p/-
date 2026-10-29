#!/usr/bin/env node
/**
 * OFFLINE ONLY: independently validate two byte-for-byte identical sales
 * archive backups. This cannot establish they are on separate physical media
 * or prove their source matches current live Firestore.
 * No network, Firebase imports, writes, or deletions.
 */
import {createReadStream,statSync,realpathSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";

const args=process.argv.slice(2);
const fail=(reason)=>{console.error("BLOCK: "+reason);process.exitCode=1;};
if(args.length!==2){
 console.error("Usage: node scripts/verify-sales-archive-pair.mjs <copy-1.json> <copy-2.json>");
 process.exit(2);
}
const paths=args.map(p=>resolve(p));
try{
 const [a,b]=paths.map(p=>({name:realpathSync(p),stat:statSync(p)}));
 if(a.name===b.name||(a.stat.dev===b.stat.dev&&a.stat.ino===b.stat.ino))
   throw Error("同じ実体ファイルは2つの独立したコピーではありません");
 for(const p of paths){
   if(!statSync(p).isFile())throw Error("バックアップ対象が通常のファイルではありません");
   const v=spawnSync(process.execPath,[resolve("scripts/verify-sales-archive.mjs"),p],{
     encoding:"utf8",maxBuffer:1024*1024,
     timeout:30000,env:{PATH:process.env.PATH||""}
   });
   if(v.error||v.status!==0)throw Error("保存原票の完全性・単価・件数の照合が不合格");
 }
 const hash=async name=>new Promise((ok,bad)=>{
   const h=createHash("sha256");
   const stream=createReadStream(name);
   stream.on("error",bad);
   stream.on("data",data=>h.update(data));
   stream.on("end",()=>ok(h.digest("hex")));
 });
 const digests=await Promise.all(paths.map(hash));
 if(digests[0]!==digests[1])throw Error("2コピーのSHA-256が一致しません");
 console.log("PASS: 2 copies have matching file hashes and each archive passed source/totals validation.");
 console.log("No Firebase access, restore, or deletion performed.");
 console.log("IMPORTANT: separate physical media and real-data restore MUST still be independently confirmed.");
}catch(error){fail(error.message);}
