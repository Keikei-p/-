#!/usr/bin/env node
// Read-only anonymous production check. Never attempts a login or looks up
// a user's email; never requests, prints or modifies private Firebase data.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
export function parsePartnerAuthSurface(html){
  const key=html.match(/apiKey:\s*"([^"]+)"/)?.[1];
  const project=html.match(/projectId:\s*"([^"]+)"/)?.[1];
  const domain=html.match(/authDomain:\s*"([^"]+)"/)?.[1];
  const version=html.match(/firebasejs\/([0-9.]+)\/firebase-auth\.js/)?.[1];
  if(!key||!version||project!=="sales-management-cc116"||
     domain!=="sales-management-cc116.firebaseapp.com")
    throw Error("AUTH_DIAG_BAD_PROJECT_OR_CLIENT");
  return {key,project,domain,version};
}
export async function inspectPartnerPublicAuth(html,{request=fetch,log=console.log}={}){
  const conf=parsePartnerAuthSurface(html);
  const get=async(url)=>{
    try{
      const response=await request(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000)});
      return response;
    }catch{return null;}
  };
  const sdkFiles=["firebase-app.js","firebase-auth.js","firebase-functions.js"];
  let pass=true;
  for(const name of sdkFiles){
    const r=await get("https://www.gstatic.com/firebasejs/"+conf.version+"/"+name);
    log("PUBLIC_FIREBASE_SDK_"+name.replace(".js","").toUpperCase()+"_HTTP="+(r?.status??"network_error"));
    if(!r?.ok)pass=false;
  }
  const page=await get("https://nico-factory.web.app/partner-invite.html");
  log("PUBLIC_PARTNER_INVITE_HTTP="+(page?.status??"network_error"));
  if(!page?.ok)pass=false;
  const project=await get("https://identitytoolkit.googleapis.com/v1/projects?key="+encodeURIComponent(conf.key));
  log("FIREBASE_PUBLIC_AUTH_CONFIG_HTTP="+(project?.status??"network_error"));
  if(project?.ok){
    let body;
    try{body=await project.json();}catch{body={};}
    if(body.projectId&&body.projectId!==conf.project){pass=false;log("PUBLIC_AUTH_WRONG_PROJECT=true");}
    if(Array.isArray(body.authorizedDomains)){
      const allowed=body.authorizedDomains.includes("nico-factory.web.app");
      log("NICO_AUTHORIZED_DOMAIN="+allowed);
      if(!allowed)pass=false;
    }else log("NICO_AUTHORIZED_DOMAIN=unknown");
    if(body.signIn?.email?.enabled===false){
      pass=false;log("EMAIL_PASSWORD_PROVIDER_ENABLED=false");
    }else log("EMAIL_PASSWORD_PROVIDER_ENABLED="+(body.signIn?.email?.enabled===true?"true":"unknown"));
  }else log("FIREBASE_AUTH_PUBLIC_CONFIGURATION=not_verifiable");
  log("READ_ONLY_NO_USER_LOOKUP_OR_LOGIN=true");
  return {publicAssetsVerified:pass,authConfigurationVerified:project?.ok===true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  inspectPartnerPublicAuth(readFileSync(new URL("../../partner-invite.html",import.meta.url),"utf8"))
    .then(x=>{if(!x.publicAssetsVerified)process.exitCode=1;})
    .catch(e=>{console.error(e.message?.startsWith("AUTH_DIAG_")?e.message:"AUTH_DIAG_UNEXPECTED");process.exitCode=1;});
}
