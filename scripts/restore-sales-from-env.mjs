#!/usr/bin/env node
/**
 * LOCAL EMULATOR ONLY. Pass a file path via environment variables to avoid
 * exposing it in shell command strings. Never uses production credentials.
 */
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {isAbsolute} from "node:path";

export function assertLocalRestoreEnvironment(env){
  const path=env?.SALES_BACKUP_FILE;
  if(typeof path!=="string"||!isAbsolute(path)||!path.endsWith(".salesbak"))
    throw Error("Local absolute encrypted backup path required");
  if(env?.GCLOUD_PROJECT!=="demo-sales-restore"||
     !/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(env?.FIRESTORE_EMULATOR_HOST||""))
    throw Error("Local demo project and localhost Firestore emulator required");
  if(Number(env.FIRESTORE_EMULATOR_HOST.split(":")[1])>65535)
    throw Error("Invalid local port");
  return path;
}
function main(){
  const archive=assertLocalRestoreEnvironment(process.env);
  const program=fileURLToPath(new URL("../tools/readonly-backup/restore-emulator.mjs",import.meta.url));
  const run=spawnSync(process.execPath,[program,"--file",archive,
    "--confirm","LOCAL_EMULATOR_ONLY"],{
    shell:false,stdio:"inherit",
    env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:""}
  });
  if(run.error||run.status!==0)throw Error("Isolated restore verification failed");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{main();}catch{
    console.error("BLOCK: local emulator-only backup restoration check was not completed.");
    process.exitCode=1;
  }
}
