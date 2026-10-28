import {buildCombinedReportPlan,buildCombinedReportData,formatCombinedCountsReport,formatCombinedMissingReminder} from "./combine.mjs";

// Cloudflare Workers (staging only). No public HTTP endpoint.
// Default is DRY RUN: no LINE messages or Firestore writes unless two independent switches are enabled.
const TASKS={"0 0 * * *":"morning","0 10 * * *":"final","5 10 * * *":"missing"};
const BASE="https://firestore.googleapis.com/v1/projects/";
function todayTokyo(ms){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).formatToParts(new Date(ms));
 const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {date:v.year+"-"+v.month+"-"+v.day,month:v.year+"-"+v.month,
 weekday:({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[v.weekday]};
}
function encodeB64URL(bytes){
 const value=Array.from(new Uint8Array(bytes),x=>String.fromCharCode(x)).join("");
 return btoa(value).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function pemBytes(pem){
 const s=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
 return Uint8Array.from(atob(s),c=>c.charCodeAt(0));
}
async function googleToken(env){
 const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||"null");
 if(!account?.client_email||!account?.private_key||!env.FIREBASE_PROJECT_ID)throw Error("Server credentials not configured");
 const now=Math.floor(Date.now()/1000);
 const header=encodeB64URL(new TextEncoder().encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
 const claims=encodeB64URL(new TextEncoder().encode(JSON.stringify({
  iss:account.client_email,scope:"https://www.googleapis.com/auth/datastore",
  aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3000
 })));
 const signingInput=header+"."+claims;
 const key=await crypto.subtle.importKey("pkcs8",pemBytes(account.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(signingInput));
 const resp=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:signingInput+"."+encodeB64URL(signature)})});
 if(!resp.ok)throw Error("Google authentication failed (HTTP "+resp.status+")");
 const value=await resp.json();
 if(!value.access_token)throw Error("Missing Google token");
 return value.access_token;
}
function parseValue(x){
 if(!x||typeof x!=="object")return null;
 if("stringValue"in x)return x.stringValue;
 if("integerValue"in x)return Number(x.integerValue);
 if("doubleValue"in x)return Number(x.doubleValue);
 if("booleanValue"in x)return x.booleanValue;
 if("nullValue"in x)return null;
 if("timestampValue"in x)return x.timestampValue;
 if("arrayValue"in x)return (x.arrayValue.values||[]).map(parseValue);
 if("mapValue"in x)return Object.fromEntries(Object.entries(x.mapValue.fields||{}).map(([k,v])=>[k,parseValue(v)]));
 return null;
}
function parseDoc(doc){
 if(!doc?.name)return null;
 return {id:doc.name.split("/").pop(),...Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,parseValue(v)]))};
}
function resourcePath(env,path=""){
 return BASE+encodeURIComponent(env.FIREBASE_PROJECT_ID)+"/databases/(default)/documents"+(path?"/"+path:"");
}
async function api(env,token,url,init={}){
 const resp=await fetch(url,{...init,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(init.headers||{})}});
 if(!resp.ok){
  const error=new Error("Firestore HTTP "+resp.status);
  error.status=resp.status;throw error;
 }
 return resp.json();
}
async function getDocument(env,token,path){
 try{return parseDoc(await api(env,token,resourcePath(env,path)));}
 catch(err){if(err.status===404)return null;throw err;}
}
async function listDocuments(env,token,path){
 const rows=[];let page="";
 for(let n=0;n<50;n++){
  const params=new URLSearchParams({pageSize:"100"});
  if(page)params.set("pageToken",page);
  const r=await api(env,token,resourcePath(env,path)+"?"+params);
  rows.push(...(r.documents||[]).map(parseDoc));
  if(!r.nextPageToken)return rows;
  page=r.nextPageToken;
 }
 throw Error("Too many pages: fail closed");
}
function eq(field,value){return {fieldFilter:{field:{fieldPath:field},op:"EQUAL",value:{stringValue:String(value)}}};}
function range(field,op,value){return {fieldFilter:{field:{fieldPath:field},op,value:{stringValue:String(value)}}};}
async function queryDocs(env,token,table,filters){
 const body={structuredQuery:{from:[{collectionId:table}],
  where:filters.length===1?filters[0]:{compositeFilter:{op:"AND",filters}}}};
 const resp=await api(env,token,resourcePath(env).replace(/\/documents$/,"/documents:runQuery"),{method:"POST",body:JSON.stringify(body)});
 if(!Array.isArray(resp))throw Error("Unexpected Firestore query response");
 return resp.filter(x=>x.document).map(x=>parseDoc(x.document));
}
function validateQuantity(n){
 if(!Number.isSafeInteger(Number(n))||Number(n)<0)throw Error("Invalid quantity");
 return Number(n);
}
function countRecord(record){
 const v=validateQuantity(record.totalCount);
 const rows=Object.values(record.results||{});
 let counted=0;
 for(const row of rows)counted+=validateQuantity(row?.count);
 if(counted!==v)throw Error("Record totals did not reconcile");
 return v;
}
function goalValue(targets){
 const values=Object.values(targets||{});
 if(!values.length)throw Error("No goal set");
 return values.reduce((s,x)=>s+validateQuantity(x),0);
}
function teamForDate(member,date){
 const history=Array.isArray(member.teamHistory)?member.teamHistory
  .filter(x=>x&&typeof x.effectiveDate==="string")
  .sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)):[];
 if(!history.length)return member.teamId||"";
 let teamId=history[0].fromTeamId||"";
 for(const item of history)if(item.effectiveDate<=date)teamId=item.toTeamId||"";
 return teamId;
}
async function prepareTeamRows(env,token,companyId,clock,kind,settings){
 const teams=(await queryDocs(env,token,"teams",[eq("companyId",companyId)])).filter(x=>x.active!==false);
 if(teams.length===0)return [];
 const start=clock.month+"-01",year=Number(clock.month.slice(0,4)),month=Number(clock.month.slice(5));
 const finish=(month===12?year+1:year)+"-"+String(month===12?1:month+1).padStart(2,"0")+"-01";
 const [goals,records]=await Promise.all([
  kind==="missing"?Promise.resolve([]):queryDocs(env,token,"goals",[eq("companyId",companyId),eq("month",clock.month)]),
  kind==="missing"
   ?queryDocs(env,token,"records",[eq("companyId",companyId),eq("date",clock.date)])
   :queryDocs(env,token,"records",[eq("companyId",companyId),range("date","GREATER_THAN_OR_EQUAL",start),range("date","LESS_THAN",finish)])
 ]);
 const totals=new Map();
 for(const r of records)totals.set(r.teamId,(totals.get(r.teamId)||0)+countRecord(r));
 if(kind==="missing"){
  const [members]=await Promise.all([listDocuments(env,token,"companies/"+encodeURIComponent(companyId)+"/members")]);
  const reported=new Map(),expected=new Map();
  for(const member of members){
   if(member.active===false||member.companyRole==="owner"&&!member.teamId)continue;
   const teamId=teamForDate(member,clock.date);if(!teamId)continue;
   expected.set(teamId,(expected.get(teamId)||0)+1);
  }
  for(const r of records)if(r.reportStatus==="submitted"||r.reportStatus==="no_result"){
   const teamId=r.teamId;if(!teamId)continue;
   reported.set(teamId,(reported.get(teamId)||0)+1);
  }
  return teams.filter(t=>(expected.get(t.id)||0)>0).map(t=>({
   id:t.id,name:t.name,goalCount:0,currentCount:totals.get(t.id)||0,
   reported:settings.reportCompletionMode==="team_any"
    ?(reported.get(t.id)||0)>0:(reported.get(t.id)||0)>=(expected.get(t.id)||0)
  }));
 }
 return teams.map(t=>{
  const goal=goals.find(g=>g.teamId===t.id);
  if(!goal)throw Error("Missing target for a team; report suppressed");
  return {id:t.id,name:t.name,goalCount:goalValue(goal.targets),currentCount:totals.get(t.id)||0,reported:true};
 });
}
async function lineIdempotencyKey(input){
 const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input))).slice(0,16);
 b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const h=Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
 return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
}
function fireString(v){return {stringValue:String(v)};}
async function reserveDispatch(env,token,id,companyId,clock,kind){
 const url=resourcePath(env,"notificationDispatches")+"?documentId="+encodeURIComponent(id);
 const payload={fields:{companyId:fireString(companyId),date:fireString(clock.date),mode:fireString(kind),status:fireString("reserved")}};
 try{await api(env,token,url,{method:"POST",body:JSON.stringify(payload)});return true;}
 catch(e){if(e.status===409)return false;throw e;}
}
async function updateDispatch(env,token,id,statusCode){
 const url=resourcePath(env,"notificationDispatches/"+encodeURIComponent(id))+"?updateMask.fieldPaths=status";
 await api(env,token,url,{method:"PATCH",body:JSON.stringify({fields:{status:fireString(statusCode)}})});
}
async function pushLine(env,groupId,text,key){
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)throw Error("LINE token not configured");
 if(text.length>4800)throw Error("LINE message too long; suppressed");
 const resp=await fetch("https://api.line.me/v2/bot/message/push",{
  method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+env.LINE_CHANNEL_ACCESS_TOKEN,"X-Line-Retry-Key":key},
  body:JSON.stringify({to:groupId,messages:[{type:"text",text}]})
 });
 if(!resp.ok)throw Error("LINE HTTP "+resp.status);
}
export default {
 async scheduled(event,env){
  const kind=TASKS[event.cron];
  if(!kind)return;
  const clock=todayTokyo(event.scheduledTime||Date.now());
  const enabled=env.REPORT_DELIVERY_ENABLED==="true";
  const token=await googleToken(env);
  const companies=await listDocuments(env,token,"companies");
  // All settings are read by this server from Firestore, NOT from a client.
  // Missing settings fail closed for the relevant hub/partner.
  const entries=[];
  for(const company of companies){
   if(company.active===false)continue;
   try{
    const settings=await getDocument(env,token,
      "companies/"+encodeURIComponent(company.id)+"/settings/notifications");
    if(settings)entries.push({id:company.id,name:company.name,active:true,settings});
   }catch(_error){
    console.error("Failed to load company report settings (no data disclosed)");
   }
  }
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  const plans=[];
  for(const hub of entries){
   const settings=hub.settings;
   if(settings.enabled!==true||settings.lineEnabled!==true||!settings.lineGroupId)continue;
   if(!Array.isArray(settings.weekdays)||!settings.weekdays.map(Number).includes(clock.weekday))continue;
   try{
    const plan=buildCombinedReportPlan({hub,companies:entries});
    // Each linked partner must approve this weekday too; never infer consent.
    for(const id of plan.partnerCompanyIds){
     const p=byId.get(id);
     if(!Array.isArray(p.settings.weekdays) ||
        !p.settings.weekdays.map(Number).includes(clock.weekday))
       throw Error("Partner weekday sharing not approved");
    }
    plans.push({hub,plan});
   }catch(_error){
    // Incomplete cross-company agreement cannot silently degrade to
    // a partial report that appears to contain every partner.
    console.error("Company report plan blocked: invalid consent or settings");
   }
  }
  const includedPartners=new Set(plans.flatMap(x=>x.plan.partnerCompanyIds));
  for(const {hub,plan} of plans){
   try{
    if(includedPartners.has(hub.id))continue; // No duplicate sends for partner companies.
    const hubTeams=await prepareTeamRows(env,token,hub.id,clock,kind,hub.settings);
    const partnerSources=await Promise.all(plan.partnerCompanyIds.map(async id=>{
      const partner=byId.get(id);
      return {
        companyId:id,companyName:partner.name,
        teams:await prepareTeamRows(env,token,id,clock,kind,partner.settings)
      };
    }));
    const report=buildCombinedReportData({
      plan,hubTeams,partnerSources,mode:kind
    });
    const message=kind==="missing"
      ?formatCombinedMissingReminder({date:clock.date,report})
      :formatCombinedCountsReport({date:clock.date,period:kind,report});
    if(!message)continue;
    if(message.length>4800)throw Error("Combined LINE report exceeds limit");
    if(!enabled){
      console.log("DRY-RUN: combined "+kind+" report validated; no send or Firestore write");
      continue;
    }
    const id=hub.id+"_"+clock.date+"_"+kind;
    if(!await reserveDispatch(env,token,id,hub.id,clock,kind))continue;
    try{
      await pushLine(env,String(hub.settings.lineGroupId),message,
        await lineIdempotencyKey(id));
      await updateDispatch(env,token,id,"sent");
    }catch(_error){
      await updateDispatch(env,token,id,"failed").catch(()=>{});
      throw Error("Combined report sending failed");
    }
   }catch(_error){
    // Avoid company IDs, names, prices, record details in logs.
    console.error("Combined report skipped: invalid count, consent or delivery");
   }
  }

 }
};
