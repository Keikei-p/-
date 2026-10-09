const SCOPE="https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform";
let tokenCache={token:"",exp:0};
const LINE_MONTHLY_HARD_CAP=180;

const enc=s=>new TextEncoder().encode(s);
const b64url=b=>{
  let x=""; for(const v of b)x+=String.fromCharCode(v);
  return btoa(x).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
};
const pemBuf=p=>{
  const s=String(p||"").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,"");
  const x=atob(s), b=new Uint8Array(x.length);
  for(let i=0;i<x.length;i++)b[i]=x.charCodeAt(i);
  return b.buffer;
};
async function googleToken(env){
  const now=Date.now();
  if(tokenCache.token&&tokenCache.exp-now>60000)return tokenCache.token;
  const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||"{}");
  if(!sa.client_email||!sa.private_key)throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  const iat=Math.floor(now/1000);
  const head=b64url(enc(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const body=b64url(enc(JSON.stringify({iss:sa.client_email,scope:SCOPE,aud:"https://oauth2.googleapis.com/token",iat,exp:iat+3600})));
  const unsigned=`${head}.${body}`;
  const key=await crypto.subtle.importKey("pkcs8",pemBuf(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,enc(unsigned));
  const assertion=`${unsigned}.${b64url(new Uint8Array(sig))}`;
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  if(!r.ok)throw new Error(`OAuth ${r.status}: ${await r.text()}`);
  const j=await r.json();
  tokenCache={token:j.access_token,exp:now+Number(j.expires_in||3600)*1000};
  return tokenCache.token;
}
const base=env=>`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)`;
const pathUrl=p=>String(p).split("/").filter(Boolean).map(encodeURIComponent).join("/");
async function fsFetch(env,url,opt={}){
  const token=await googleToken(env);
  return fetch(url,{...opt,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(opt.headers||{})}});
}
function fromV(v){
  if(!v)return null;
  if("stringValue"in v)return v.stringValue;
  if("booleanValue"in v)return v.booleanValue;
  if("integerValue"in v)return Number(v.integerValue||0);
  if("doubleValue"in v)return Number(v.doubleValue||0);
  if("timestampValue"in v)return v.timestampValue;
  if("arrayValue"in v)return (v.arrayValue.values||[]).map(fromV);
  if("mapValue"in v)return fromF(v.mapValue.fields||{});
  return null;
}
function fromF(f){return Object.fromEntries(Object.entries(f||{}).map(([k,v])=>[k,fromV(v)]));}
function docObj(d){if(!d)return null;const a=String(d.name||"").split("/");return{id:a.at(-1)||"",...fromF(d.fields||{})};}
function toV(v){
  if(v===null||v===undefined)return{nullValue:null};
  if(typeof v==="string")return{stringValue:v};
  if(typeof v==="boolean")return{booleanValue:v};
  if(typeof v==="number")return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(Array.isArray(v))return{arrayValue:{values:v.map(toV)}};
  if(typeof v==="object"&&v.__ts)return{timestampValue:v.__ts};
  if(typeof v==="object")return{mapValue:{fields:toF(v)}};
  return{stringValue:String(v)};
}
function toF(o){return Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,toV(v)]));}
const nowTs=()=>({__ts:new Date().toISOString()});

async function getDoc(env,p){
  const r=await fsFetch(env,`${base(env)}/documents/${pathUrl(p)}`);
  if(r.status===404)return null;
  if(!r.ok)throw new Error(`GET ${p} ${r.status}: ${await r.text()}`);
  return docObj(await r.json());
}
async function listCol(env,p){
  let out=[],pageToken="";
  do{
    const q=new URLSearchParams({pageSize:"200"}); if(pageToken)q.set("pageToken",pageToken);
    const r=await fsFetch(env,`${base(env)}/documents/${pathUrl(p)}?${q}`);
    if(!r.ok)throw new Error(`LIST ${p} ${r.status}: ${await r.text()}`);
    const j=await r.json(); out.push(...(j.documents||[]).map(docObj)); pageToken=j.nextPageToken||"";
  }while(pageToken);
  return out;
}
const strFilter=(field,value)=>({fieldFilter:{field:{fieldPath:field},op:"EQUAL",value:{stringValue:String(value)}}});
async function query(env,col,filters){
  const sq={from:[{collectionId:col}]};
  if(filters.length===1)sq.where=filters[0];
  if(filters.length>1)sq.where={compositeFilter:{op:"AND",filters}};
  const r=await fsFetch(env,`${base(env)}/documents:runQuery`,{method:"POST",body:JSON.stringify({structuredQuery:sq})});
  if(!r.ok)throw new Error(`QUERY ${col} ${r.status}: ${await r.text()}`);
  return (await r.json()).filter(x=>x.document).map(x=>docObj(x.document));
}
async function patch(env,p,values){
  const q=new URLSearchParams(); Object.keys(values).forEach(k=>q.append("updateMask.fieldPaths",k));
  const r=await fsFetch(env,`${base(env)}/documents/${pathUrl(p)}?${q}`,{method:"PATCH",body:JSON.stringify({fields:toF(values)})});
  if(!r.ok)throw new Error(`PATCH ${p} ${r.status}: ${await r.text()}`);
}
async function create(env,col,id,values){
  const q=new URLSearchParams({documentId:id});
  const r=await fsFetch(env,`${base(env)}/documents/${pathUrl(col)}?${q}`,{method:"POST",body:JSON.stringify({fields:toF(values)})});
  if(r.status===409)return false;
  if(!r.ok)throw new Error(`CREATE ${col}/${id} ${r.status}: ${await r.text()}`);
  return true;
}

async function verifySig(body,sig,secret){
  if(!sig||!secret)return false;
  const k=await crypto.subtle.importKey("raw",enc(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const s=await crypto.subtle.sign("HMAC",k,body);
  let bin=""; for(const v of new Uint8Array(s))bin+=String.fromCharCode(v);
  const expected=btoa(bin);
  if(expected.length!==sig.length)return false;
  let d=0; for(let i=0;i<expected.length;i++)d|=expected.charCodeAt(i)^sig.charCodeAt(i);
  return d===0;
}
async function line(env,path,opt={}){
  return fetch(`https://api.line.me${path}`,{...opt,headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,"Content-Type":"application/json",...(opt.headers||{})}});
}
async function reply(env,replyToken,text){
  if(!replyToken)return;
  const r=await line(env,"/v2/bot/message/reply",{method:"POST",body:JSON.stringify({replyToken,messages:[{type:"text",text}]})});
  if(!r.ok)throw new Error(`LINE reply ${r.status}: ${await r.text()}`);
}
async function groupName(env,id){
  const r=await line(env,`/v2/bot/group/${encodeURIComponent(id)}/summary`);
  if(!r.ok)throw new Error(`LINE group ${r.status}: ${await r.text()}`);
  return String((await r.json()).groupName||"LINEグループ").slice(0,100);
}
async function lineUsage(env){
  const r=await line(env,"/v2/bot/message/quota/consumption");
  if(!r.ok)throw new Error(`LINE quota consumption ${r.status}: ${await r.text()}`);
  const j=await r.json();
  const totalUsage=Number(j.totalUsage);
  if(!Number.isFinite(totalUsage))throw new Error("LINE quota consumption returned invalid totalUsage");
  return totalUsage;
}
async function groupMemberCount(env,id){
  const r=await line(env,`/v2/bot/group/${encodeURIComponent(id)}/members/count`);
  if(!r.ok)throw new Error(`LINE group member count ${r.status}: ${await r.text()}`);
  const j=await r.json();
  const count=Number(j.count);
  if(!Number.isFinite(count)||count<0)throw new Error("LINE group member count returned invalid count");
  return count;
}
async function freeLineGuard(env,groupId){
  const [used,recipients]=await Promise.all([
    lineUsage(env),
    groupMemberCount(env,groupId)
  ]);
  return{
    allowed:used+recipients<=LINE_MONTHLY_HARD_CAP,
    used,
    recipients,
    cap:LINE_MONTHLY_HARD_CAP
  };
}
async function push(env,to,text,retryKey){
  const r=await line(env,"/v2/bot/message/push",{
    method:"POST",
    headers:{"X-Line-Retry-Key":retryKey},
    body:JSON.stringify({to,messages:[{type:"text",text}]})
  });
  // LINEが同じリトライキーで既に受理した場合、二重配信せず正常終了する。
  if(r.status===409&&r.headers.get("x-line-accepted-request-id"))return;
  if(!r.ok){const e=new Error(`LINE push ${r.status}: ${await r.text()}`);e.status=r.status;throw e;}
}
async function pushRetry(env,to,text){
  // タイムアウト後でも同じ通知を2通送らないため全試行で同一キーを使う。
  const retryKey=crypto.randomUUID();
  let last;
  for(let n=1;n<=3;n++){
    try{await push(env,to,text,retryKey);return n;}catch(e){
      last=e;e.attempt=n;
      const s=Number(e.status||0), retry=s===0||s===429||s>=500;
      if(!retry||n===3)throw e;
      await new Promise(r=>setTimeout(r,300*2**(n-1)));
    }
  }
  throw last;
}

function buildReminderOnlyMessage(missingTeams){
  const teamNames=[...new Set(
    (Array.isArray(missingTeams)?missingTeams:[])
      .map(x=>String(x?.teamName||"").trim())
      .filter(Boolean)
  )];

  const message=[
    "⚠️ 実績入力リマインド",
    "本日の実績入力がまだ完了していない班があります。",
    teamNames.length?("対象："+teamNames.join("・")):"対象班があります。",
    "",
    "アプリを確認し、実績入力または「実績なし」の報告をお願いします。",
  ].join("\n");

  const unsafeDetail=/[¥￥]|\d[\d,]*(?:円|件)|売上金額|獲得商材|商材別|成約件数|粗利|利益|単価/i;
  if(unsafeDetail.test(message)){
    throw new Error("Reminder-only guard blocked a message containing sales/performance details");
  }

  return message;
}
async function pairEvent(env,event){
  if(event?.type!=="message"||event?.message?.type!=="text"||event?.source?.type!=="group"||!event.source.groupId)return;
  const m=String(event.message.text||"").trim().match(/^連携\s+([A-Z0-9]{8})$/i);
  if(!m)return;
  const code=m[1].toUpperCase(), p=await getDoc(env,`linePairingCodes/${code}`);
  if(!p){await reply(env,event.replyToken,"連携コードが見つかりません。アプリから新しいコードを発行してください。");return;}
  const exp=Date.parse(p.expiresAt||"");
  if(p.status!=="pending"||!Number.isFinite(exp)||exp<=Date.now()||!p.companyId){
    await reply(env,event.replyToken,"この連携コードは使用済み、または期限切れです。アプリから新しいコードを発行してください。");return;
  }
  const gid=String(event.source.groupId);
  let gname="LINEグループ"; try{gname=await groupName(env,gid);}catch(e){console.error(e);}
  await patch(env,`companies/${p.companyId}/settings/notifications`,{lineGroupId:gid,lineGroupName:gname,lineConnectedAt:nowTs()});
  await patch(env,`linePairingCodes/${code}`,{status:"connected",groupId:gid,groupName:gname,connectedAt:nowTs()});
  await reply(env,event.replyToken,`✅ 営業実績アプリと「${gname}」を連携しました。未報告通知の送信先として登録されています。`);
}

function tokyo(){
  const f=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const p=Object.fromEntries(f.formatToParts(new Date()).map(x=>[x.type,x.value]));
  const w={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return{date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,weekday:w[p.weekday]};
}
function minutesOfDay(value){
  const m=String(value||"").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m?Number(m[1])*60+Number(m[2]):null;
}
function shouldSendReminderAt(startTime,currentTime){
  const start=minutesOfDay(startTime),current=minutesOfDay(currentTime);
  // 5分刻みのCronを維持し、開始時刻以降は未報告なら1時間ごとに再確認。
  return start!==null&&current!==null&&start%5===0&&current>=start&&(current-start)%60===0;
}
function teamForDate(member,date){
  const h=Array.isArray(member?.teamHistory)?member.teamHistory.filter(x=>x&&typeof x.effectiveDate==="string").sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)):[];
  if(!h.length)return member?.teamId||null;
  let t=h[0].fromTeamId??null; for(const x of h)if(x.effectiveDate<=date)t=x.toTeamId??null; return t;
}
async function missing(env,cid,date,reportCompletionMode="individual"){
  const [members,teams,records]=await Promise.all([
    listCol(env,`companies/${cid}/members`),
    query(env,"teams",[strFilter("companyId",cid)]),
    query(env,"records",[strFilter("companyId",cid),strFilter("date",date)])
  ]);
  return missingFromSnapshot(members,teams,records,date,reportCompletionMode);
}
function missingFromSnapshot(members,teams,records,date,reportCompletionMode="individual"){
  const names=new Map(teams.map(t=>[t.id,String(t.name||"班")]));
  const membersById=new Map(members.map(m=>[String(m.id),m]));
  const reported=new Set(records.filter(r=>r.uid).map(r=>String(r.uid)));
  const reportedTeams=new Set();

  for(const record of records){
    let tid=record?.teamId?String(record.teamId):"";
    if(!tid&&record?.uid){
      const member=membersById.get(String(record.uid));
      tid=member?String(teamForDate(member,date)||""):"";
    }
    if(tid)reportedTeams.add(tid);
  }

  const map=new Map();
  for(const m of members){
    if(m.active===false)continue;
    const tid=String(teamForDate(m,date)||""); if(!tid)continue;
    if(!map.has(tid))map.set(tid,{
      teamId:tid,
      teamName:names.get(tid)||m.teamName||"班",
      expected:0,
      reported:0,
      teamReported:reportedTeams.has(tid)
    });
    const x=map.get(tid);
    x.expected++;
    if(reported.has(String(m.id)))x.reported++;
  }

  return [...map.values()]
    .filter(x=>{
      if(x.expected<=0)return false;
      if(reportCompletionMode==="team_any")return x.teamReported!==true;
      return x.reported<x.expected;
    })
    .sort((a,b)=>a.teamName.localeCompare(b.teamName,"ja"));
}
async function reminders(env){
  if(String(env.AUTOMATION_ENABLED||"false").toLowerCase()!=="true")return;
  const n=tokyo(), minute=Number(n.time.split(":")[1]);
  if(!Number.isInteger(minute)||minute%5!==0)return;
  const companies=await listCol(env,"companies");
  for(const c of companies){
    try{
      if(c.active===false)continue;
      const s=await getDoc(env,`companies/${c.id}/settings/notifications`);
      const days=Array.isArray(s?.weekdays)?s.weekdays.map(Number):[];
      if(!s||s.enabled!==true||s.lineEnabled!==true||!s.lineGroupId||!shouldSendReminderAt(s.time,n.time)||!days.includes(n.weekday))continue;
      const miss=await missing(env,c.id,n.date,s.reportCompletionMode==="team_any"?"team_any":"individual"); if(!miss.length)continue;
      const key=[c.id,n.date,n.time.replace(":","")].join("_");

      let freeGuard;
      try{
        freeGuard=await freeLineGuard(env,String(s.lineGroupId));
      }catch(e){
        console.error("LINE free guard check failed; send blocked",c.id,e);
        await create(env,"notificationDispatches",key,{
          companyId:c.id,
          date:n.date,
          time:n.time,
          status:"blocked_free_guard",
          reason:"quota_check_failed",
          error:String(e.message||e).slice(0,1000),
          createdAt:nowTs()
        });
        continue;
      }

      if(!freeGuard.allowed){
        await create(env,"notificationDispatches",key,{
          companyId:c.id,
          date:n.date,
          time:n.time,
          status:"blocked_free_guard",
          reason:"monthly_line_cap",
          lineUsage:freeGuard.used,
          estimatedRecipients:freeGuard.recipients,
          hardCap:freeGuard.cap,
          createdAt:nowTs()
        });
        continue;
      }

      if(!await create(env,"notificationDispatches",key,{
        companyId:c.id,
        date:n.date,
        time:n.time,
        status:"processing",
        lineUsageBeforeSend:freeGuard.used,
        estimatedRecipients:freeGuard.recipients,
        hardCap:freeGuard.cap,
        createdAt:nowTs()
      }))continue;
      const msg=buildReminderOnlyMessage(miss);
      try{
        const attempts=await pushRetry(env,String(s.lineGroupId),msg);
        await patch(env,`notificationDispatches/${key}`,{status:"sent",message:msg,sendAttempts:attempts,sentAt:nowTs()});
      }catch(e){
        await patch(env,`notificationDispatches/${key}`,{status:"failed",sendAttempts:Number(e.attempt||1),error:String(e.message||e).slice(0,1000),failedAt:nowTs()});
      }
    }catch(e){console.error("company reminder failed",c.id,e);}
  }
}
async function webhook(req,env){
  if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
  const body=await req.arrayBuffer(), sig=req.headers.get("x-line-signature")||"";
  if(!await verifySig(body,sig,env.LINE_CHANNEL_SECRET||""))return new Response("Invalid signature",{status:401});
  let j; try{j=JSON.parse(new TextDecoder().decode(body));}catch{return new Response("Invalid JSON",{status:400});}
  for(const e of Array.isArray(j.events)?j.events:[]){
    try{await pairEvent(env,e);}catch(err){console.error(err);try{await reply(env,e?.replyToken,"LINE連携処理に失敗しました。アプリから新しい連携コードを発行して、もう一度お試しください。");}catch{}}
  }
  return new Response("OK");
}
export default{
  async fetch(req,env){
    const u=new URL(req.url);
    if(u.pathname==="/health")return Response.json({ok:true,service:"sales-line-worker",automationEnabled:String(env.AUTOMATION_ENABLED||"false").toLowerCase()==="true"});
    if(u.pathname==="/line-webhook")return webhook(req,env);
    return new Response("Not Found",{status:404});
  },
  async scheduled(_c,env,ctx){ctx.waitUntil(reminders(env));}
};

// Pure scheduling helpers and delivery wrapper exported for side-effect-free unit tests.
export {shouldSendReminderAt,buildReminderOnlyMessage,teamForDate,missingFromSnapshot,missing,pushRetry,freeLineGuard};
