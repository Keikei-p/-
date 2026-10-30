// Sales archive module: READ-ONLY. Does not write or delete Firestore documents.
import {archiveExportPolicy} from "./archive-output-policy.mjs";
import {makeArchiveCoverage} from "./archive-coverage.mjs";
import {checkArchivePreflightCounts,assertArchiveQueryCountsMatch}
  from "./archive-read-budget.mjs";
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,getDocFromServer,doc,collection,query,where,getDocsFromServer,getCountFromServer} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app=getApp(),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>Number(n||0).toLocaleString("ja-JP")+"円";
let ownerCompany=null,bundle=null,revision=0;

const css=document.createElement("style");
css.textContent='#archiveDialog[hidden]{display:none!important}#archiveDialog{position:fixed;inset:0;z-index:10000;background:#0f172acc;overflow:auto;padding:12px}#archiveDialog .body{max-width:850px;margin:18px auto;padding:22px;background:white;border-radius:15px;color:#1f2937;line-height:1.65}#archiveDialog .toolbar,#archiveDialog .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:15px 0}#archiveDialog label{font-weight:700;font-size:13px}#archiveDialog input,#archiveDialog select{max-width:100%;border:1px solid #d1d5db;border-radius:7px;padding:9px}#archiveDialog button{padding:9px 12px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:8px;font-weight:700}#archiveDialog button:disabled{opacity:.45}#archiveSummary{background:#f8fafc;padding:15px;border-radius:10px;border:1px solid #e2e8f0}#archiveStatus{white-space:pre-wrap;color:#92400e;font-size:12px}#archiveDialog small{color:#64748b}';
document.head.appendChild(css);
const menu=document.querySelector("#managementMenuPanel .quick-menu");
const button=document.createElement("button");
button.id="archiveOpen";button.type="button";button.className="quick-menu-button";button.style.display="none";button.textContent="📚 売上資料・保管庫";
menu?.appendChild(button);
const dialog=document.createElement("div");
dialog.id="archiveDialog";dialog.hidden=true;dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
dialog.innerHTML='<div class="body"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2 style="font-size:20px">📚 売上資料・保管庫</h2><button type="button" id="archiveClose">閉じる</button></div>'+
 '<p>過去の実績を年別・月別に集計し、PDF・Excel用CSV・JSONとして保存できます。<b>元の履歴は変更・削除しません。</b> <strong>この資料は4種類の営業履歴のみで、会員・会社設定などを含む全体バックアップではありません。</strong></p>'+
 '<div class="toolbar"><label>期間単位<br><select id="archiveMode"><option value="month">月別</option><option value="year">年別</option></select></label>'+
 '<label id="archiveMonthWrap">対象月<br><input type="month" id="archiveMonth"></label>'+
 '<label id="archiveYearWrap" hidden>対象年<br><input type="number" min="2000" max="2100" id="archiveYear"></label>'+
 '<button type="button" id="archiveLoad">サーバーの実績を確認</button></div>'+
 '<div id="archiveSummary" aria-live="polite">期間を選んでデータを確認してください。</div>'+
 '<div class="actions"><button id="archivePdf" disabled>📄 PDF印刷</button><button id="archiveCsv" disabled>📊 Excel用CSV</button><button id="archiveJson" disabled>🔐 営業履歴JSON（全社バックアップではない）</button>'+
 '<button id="archiveVerify">📂 営業履歴JSONを再表示・検証</button><input type="file" id="archiveFile" accept=".json,application/json" hidden></div>'+
 '<div id="archiveStatus" aria-live="polite"></div>'+
 '<p><small>集計金額は「実績に保存された単価×件数」で算出します。現在の商材マスターで再計算する画面とは異なる場合があります。JSONには訂正履歴・当時の実績原票・取得時点の商材情報を含みます。自動削除・Firestoreへの復元は未実装です。ファイルは金額と個人情報を含むため、厳重に保管してください。</small></p></div>';
document.body.appendChild(dialog);
const outputButtons=["archivePdf","archiveCsv","archiveJson"];
function status(s){$("archiveStatus").textContent=s;}
function reset(){bundle=null;outputButtons.forEach(id=>$(id).disabled=true);}
function close(){dialog.hidden=true;reset();}
async function companyForOwner(user){
 if(!user?.emailVerified)return null;
 const u=await getDocFromServer(doc(db,"users",user.uid));if(!u.exists())return null;
 const ud=u.data();if(ud.active===false||!ud.companyId)return null;
 const companyId=ud.companyId;
 const [co,member]=await Promise.all([getDocFromServer(doc(db,"companies",companyId)),getDocFromServer(doc(db,"companies",companyId,"members",user.uid))]);
 if(!co.exists()||!member.exists()||member.data().active===false)return null;
 const c=co.data(),m=member.data();
 // Finance archives must never be shown to a partner-company owner or a
 // partner leader whose accessKind flags were mistakenly granted revenue.
 // Only explicitly internal or legacy-unclassified accounts can read
 // finance archives. Unknown classifications fail closed, including owner.
 const internal=v=>v==null||v==="internal"||v==="direct";
 const internalMemberType=v=>v==null||["internal","direct","managed"].includes(v);
 if(c.active===false||m.companyId!==companyId||
    !internal(c.companyKind)||!internal(c.accessKind)||
    !internal(ud.accessKind)||!internal(m.accessKind)||
    !internalMemberType(ud.memberType)||!internalMemberType(m.memberType))return null;
 const owner=c.ownerUid===user.uid||c.masterUid===user.uid||(ud.companyRole==="owner"&&m.companyRole==="owner");
 return owner?{id:companyId,name:c.name||"会社名未設定"}:null;
}
// Recheck live Firestore membership before exporting a money-bearing file.
 // A cached owner screen or a valid old SHA-256 file is not authorization.
async function exportOwnerStillAuthorized(){
 const current=auth.currentUser,company=ownerCompany?.id,epoch=revision;
 if(!bundle||!current||!company||bundle.payload?.company?.id!==company){
  reset();status("オーナー権限または資料の所属を確認できません。");return false;
 }
 try{
  const fresh=await companyForOwner(current);
  if(revision===epoch&&auth.currentUser?.uid===current.uid&&
     fresh?.id===company)return true;
 }catch{ /* Fail closed on lost network, permission error, or removed membership. */ }
 reset();ownerCompany=null;button.style.display="none";
 status("権限を再確認できないため出力を停止しました。再ログインして確認してください。");
 return false;
}
function period(){
 const mode=$("archiveMode").value;
 const value=mode==="month"?$("archiveMonth").value:String($("archiveYear").value);
 if(mode==="month"&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||mode==="year"&&!/^\d{4}$/.test(value))throw Error("対象年月が正しくありません。");
 const prefix=value;
 const start=mode==="year"?value+"-01-01":value+"-01";
 const finish=mode==="year"?(Number(value)+1)+"-01-01":
    value.slice(5)==="12"?(Number(value.slice(0,4))+1)+"-01-01":
    value.slice(0,4)+"-"+String(Number(value.slice(5))+1).padStart(2,"0")+"-01";
 return {mode,value,start,finish,contains:d=>typeof d==="string"&&d>=start&&d<finish};
}
function group(rows,idKey,nameKey){
 const map=new Map();
 for(const r of rows){const id=String(r[idKey]||"未設定"),cur=map.get(id)||{name:r[nameKey]||"未設定",count:0,revenue:0};
 cur.count+=r.count||0;cur.revenue+=r.amount||0;map.set(id,cur);}
 return Array.from(map.values()).sort((a,b)=>b.revenue-a.revenue||b.count-a.count);
}
function decodeRecord(r,warnings){
 const entries=Array.isArray(r.results)?r.results:
  r.results&&typeof r.results==="object"?Object.entries(r.results).map(([productId,row])=>({productId,...row})):
  r.productId?[{productId:r.productId,productName:r.productNameSnapshot,count:r.count,revenuePerUnit:r.revenuePerUnit}]:[];
 if(!entries.length&&Number(r.totalCount||0)!==0)warnings.push("実績 "+r.id+" の商材明細なし");
 let subtotal=0,cnt=0,valid=true;
 const rows=entries.map(entry=>{
  const n=Number(entry.count),raw=entry.revenuePerUnit,price=raw===null||raw===undefined||raw===""?null:Number(raw);
  const good=Number.isSafeInteger(n)&&n>=0&&Number.isSafeInteger(price)&&price>=0&&Number.isSafeInteger(n*price);
  if(!good){valid=false;warnings.push("実績 "+r.id+" に単価・件数の未設定または不正があります");}
  if(Number.isSafeInteger(n)&&n>=0)cnt+=n;
  if(good)subtotal+=n*price;
  return {date:r.date||"",recordId:r.id,teamId:r.teamId||"",teamName:r.teamNameSnapshot||"所属なし",
   memberUid:r.uid||"",memberName:r.memberNameSnapshot||"",workLocation:r.workLocation||"",
   productId:entry.productId||"",productName:entry.productName||entry.productNameSnapshot||"",
   cashback:entry.cashback??"",count:Number.isSafeInteger(n)&&n>=0?n:null,revenuePerUnit:price,amount:good?n*price:null};
 });
 if(valid&&r.totalRevenue!=null&&subtotal!==Number(r.totalRevenue))warnings.push("実績 "+r.id+"：明細売上と保存売上が不一致");
 if(r.totalCount!=null&&cnt!==Number(r.totalCount))warnings.push("実績 "+r.id+"：明細件数と保存件数が不一致");
 return rows;
}
function approvedCurrentUnit(row,products){
 const product=(products||[]).find(x=>x.id===row.productId);
 if(!product)return null;
 const options=Array.isArray(product.pricingOptions)?product.pricingOptions:[];
 const hasCB=row.cashback!==null&&row.cashback!==undefined&&row.cashback!=="";
 if(options.length){
  if(!hasCB&&options.length!==1)return null;
  const cb=hasCB?Number(row.cashback):Number(options[0].cashback??0);
  const matches=options.filter(x=>Number(x.cashback??0)===cb);
  if(matches.length!==1)return null;
  const rate=matches[0].revenuePerUnit;
  if(rate==null||rate==="")return null;
  const n=Number(rate);return Number.isSafeInteger(n)&&n>=0?n:null;
 }
 // Legacy catalog plans may hide multiple price tiers. Never guess their current price.
 if(Array.isArray(product.cashbackOptions)&&
    (product.cashbackOptions.length>1||product.cashbackOptions.some(x=>Number(x)>0)))return null;
 const n=Number(product.revenue);
 return product.revenue!=null&&Number.isSafeInteger(n)&&n>=0?n:null;
}
function appendRevaluation(rows,products){
 return rows.map(row=>{
  const currentUnit=approvedCurrentUnit(row,products);
  const hasAmount=Number.isSafeInteger(row.count)&&row.count>=0&&currentUnit!==null&&Number.isSafeInteger(row.count*currentUnit);
  const currentAmount=hasAmount?row.count*currentUnit:null;
  return {...row,currentApprovedUnit:currentUnit,currentApprovedAmount:currentAmount,
   difference:currentAmount!==null&&row.amount!==null?currentAmount-row.amount:null};
 });
}
async function sha(payload){
 if(!crypto?.subtle)throw Error("この環境は整合性検証（SHA-256）に対応していません。");
 const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload)));
 return Array.from(new Uint8Array(h),x=>x.toString(16).padStart(2,"0")).join("");
}
async function load(){
 reset();status("");const p=period(),currentUser=auth.currentUser,loadRevision=revision;
 const owned=await companyForOwner(currentUser);
 if(!owned||!ownerCompany||owned.id!==ownerCompany.id)throw Error("オーナー権限がありません。");
 const names=["records","products","recordCorrections","teams"];
 // Read only the requested range; the two compound indexes in firestore.indexes.json must be deployed first.
 const makeQuery=n=>n==="records"
   ?query(collection(db,n),where("companyId","==",owned.id),where("date",">=",p.start),where("date","<",p.finish))
   :n==="recordCorrections"
    ?query(collection(db,n),where("companyId","==",owned.id),where("recordDate",">=",p.start),where("recordDate","<",p.finish))
    :query(collection(db,n),where("companyId","==",owned.id));
 // Query counts first. An oversized or changing archive must never silently
 // export a partial fiscal report or consume an unbounded Firestore read quota.
 const queries=names.map(makeQuery);
 let snaps;
 try{
  const aggregate=await Promise.all(queries.map(q=>getCountFromServer(q)));
  const preflight=checkArchivePreflightCounts(
    aggregate.map(s=>s.data()?.count)
  );
  snaps=await Promise.all(queries.map(q=>getDocsFromServer(q)));
  assertArchiveQueryCountsMatch(preflight,snaps);
 }
 catch(e){
  if(e?.code==="failed-precondition")throw Error("期間別取得に必要なFirestore複合インデックスが未作成です。管理者がインデックスを公開してから実行してください。全件読込による自動代替は行いません。");
  throw e;
 }
 // Membership can be revoked while the four queries are running.
 const stillOwner=await companyForOwner(auth.currentUser);
 if(revision!==loadRevision||auth.currentUser?.uid!==currentUser.uid||
    stillOwner?.id!==owned.id)
   throw Error("データ取得中にオーナー権限が変更されました。出力を停止します。");
 const collections=snaps.map(s=>s.docs.map(d=>({id:d.id,...d.data()})));
 const records=collections[0].filter(r=>p.contains(r.date)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const corrections=collections[2].filter(r=>p.contains(r.recordDate));
 const warnings=[],rows=appendRevaluation(records.flatMap(r=>decodeRecord(r,warnings)),collections[1]);
 const summary={dailyRecords:records.length,productRows:rows.length,count:rows.reduce((n,r)=>n+(r.count||0),0),
  revenue:rows.reduce((n,r)=>n+(r.amount||0),0),warningCount:warnings.length,
  currentPriceComparableRevenue:rows.reduce((n,r)=>n+(r.currentApprovedAmount??0),0),
  savedComparableRevenue:rows.reduce((n,r)=>n+(r.currentApprovedAmount===null?0:(r.amount||0)),0),
  unresolvedCurrentPrices:rows.filter(r=>r.currentApprovedAmount===null).length};
 const payload={schemaVersion:1,exportedAt:new Date().toISOString(),company:owned,period:p.value,periodMode:p.mode,
  moneyBasis:"saved_unit_price",revaluationBasis:"current_approved_catalog_where_unambiguous",summary,warnings,rows,
  byTeam:group(rows,"teamId","teamName"),byMember:group(rows,"memberUid","memberName"),byProduct:group(rows,"productId","productName"),
  original:{records,products:collections[1],recordCorrections:corrections,teams:collections[3]}};
 payload.coverage=makeArchiveCoverage(payload);
 bundle={kind:"sales-archive",version:1,checksumAlgorithm:"SHA-256",checksum:await sha(payload),payload};
 $("archiveSummary").textContent=p.value+" ｜ 日別実績 "+summary.dailyRecords+"件 ｜ 獲得 "+summary.count+"件 ｜ 保存単価ベース "+money(summary.revenue)+" ｜ 現行単価との比較差額 "+money(summary.currentPriceComparableRevenue-summary.savedComparableRevenue)+"（比較不能 "+summary.unresolvedCurrentPrices+"行） ｜ 訂正 "+corrections.length+"件 ｜ 照合："+(warnings.length?"要確認 "+warnings.length+"件":"警告なし");
 const policy=archiveExportPolicy({warnings,rows,records,companyVerified:true});
 status(policy.isVerifiedFinancialReport
   ?"読取専用で取得しました。元データに変更はありません。"
   :"⚠ 保存単価・件数に不一致または未確認があります。PDF/CSVの確定資料出力を禁止しました。照合用JSONのみ保存できます。元の記録を修正せず、オーナーが確認してください。\n"+warnings.slice(0,10).join("\n"));
 $("archivePdf").disabled=!policy.canExportPdf;
 $("archiveCsv").disabled=!policy.canExportCsv;
 $("archiveJson").disabled=!policy.canExportEvidenceJson;
}
function fileBase(){const a=bundle.payload;return "営業実績_"+a.period+"_"+a.company.id.replace(/[^a-zA-Z0-9_-]/g,"_");}
function download(name,content,type){
 const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a");
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function csvCell(v){
 if(v==null)return '""';
 let s=String(v);if(typeof v==="string"&&/^[=+\-@]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
function makeCsv(){
 const cols=[["date","日付"],["recordId","実績ID"],["teamName","班"],["memberName","担当者"],["workLocation","現場"],
  ["productId","商材ID"],["productName","商材"],["cashback","CB"],["count","件数"],["revenuePerUnit","保存単価"],["amount","売上"],["currentApprovedUnit","現在承認単価"],["currentApprovedAmount","現在単価による再評価額"],["difference","差額"]];
 const lines=[cols.map(c=>csvCell(c[1])).join(",")];
 for(const row of bundle.payload.rows)lines.push(cols.map(c=>csvCell(row[c[0]])).join(","));
 download(fileBase()+".csv","\ufeff"+lines.join("\r\n"),"text/csv;charset=utf-8");
}
function table(items,title){
 return "<h3>"+esc(title)+"</h3><table><thead><tr><th>名称</th><th>件数</th><th>売上</th></tr></thead><tbody>"+
 items.map(x=>"<tr><td>"+esc(x.name)+"</td><td>"+esc(x.count)+"</td><td>"+esc(money(x.revenue))+"</td></tr>").join("")+"</tbody></table>";
}
function makePdf(printWindow=window.open("","_blank")){
 const p=bundle.payload;
 if(!printWindow){status("ブラウザのポップアップ許可が必要です。");return;}
 const html='<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>営業実績報告書</title>'+
 '<style>body{font-family:sans-serif;max-width:860px;margin:auto;padding:30px;color:#1f2937}h1{color:#1d4ed8;border-bottom:3px solid #3b82f6;padding-bottom:14px}'+
 'h3{color:#1d4ed8;margin-top:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px;border-bottom:1px solid #e5e7eb;text-align:right}th:first-child,td:first-child{text-align:left}'+
 '.metric{padding:18px;background:#eff6ff;border-radius:9px;font-size:20px;font-weight:bold}.note{font-size:11px;color:#6b7280}'+
 '@media print{button{display:none}body{margin:0;padding:8mm}tr{break-inside:avoid}}</style></head><body>'+
 '<button onclick="window.print()">印刷 / PDFとして保存</button><h1>営業実績報告書</h1>'+
 '<p>'+esc(p.company.name)+" / "+esc(p.period)+'</p><div class="metric">獲得件数 '+esc(p.summary.count)+'件 ／ 売上総額 '+esc(money(p.summary.revenue))+'</div>'+
 '<p class="note">日別実績：'+p.summary.dailyRecords+'件　/　現行単価との差額（比較可能な行のみ）：'+esc(money(p.summary.currentPriceComparableRevenue-p.summary.savedComparableRevenue))+' / 比較不能な行：'+p.summary.unresolvedCurrentPrices+'　/　出力：'+esc(p.exportedAt)+'</p>'+
 table(p.byTeam,"班別実績")+table(p.byProduct,"商材別実績")+table(p.byMember,"個人別実績")+
 '<p class="note">計算基準：保存された単価×件数。現在の単価を使う画面と金額が異なる場合があります。'+(p.warnings.length?" ⚠ 要確認："+p.warnings.length+"件":"")+" 詳細・訂正履歴は復元用JSONを参照。</p></body></html>";
 printWindow.document.open();printWindow.document.write(html);printWindow.document.close();printWindow.focus();
}
button.addEventListener("click",()=>{
 if(!ownerCompany)return;
 dialog.hidden=false;reset();$("archiveSummary").textContent="期間を選んでデータを確認してください。";status("");
 $("managementMenuPanel").hidden=true;$("managementMenuButton")?.setAttribute("aria-expanded","false");
});
$("archiveClose").addEventListener("click",close);
dialog.addEventListener("click",e=>{if(e.target===dialog)close();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!dialog.hidden)close();});
$("archiveMode").addEventListener("change",()=>{
 const annual=$("archiveMode").value==="year";
 $("archiveMonthWrap").hidden=annual;$("archiveYearWrap").hidden=!annual;reset();
});
const now=new Date();$("archiveMonth").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");$("archiveYear").value=now.getFullYear();
$("archiveLoad").addEventListener("click",async()=>{
 $("archiveLoad").disabled=true;$("archiveSummary").textContent="サーバーから取得中…";
 try{await load();}catch(err){reset();$("archiveSummary").textContent="資料を生成できませんでした。";status(String(err?.message||err));}
 finally{$("archiveLoad").disabled=false;}
});
$("archiveCsv").addEventListener("click",async()=>{
 if(await exportOwnerStillAuthorized())makeCsv();
});
$("archivePdf").addEventListener("click",async()=>{
 if(!bundle)return;
 // Open synchronously for iPhone/Safari popup policies, then verify privileges.
 const printWindow=window.open("","_blank");
 if(!printWindow){status("ブラウザのポップアップ許可が必要です。");return;}
 if(await exportOwnerStillAuthorized())makePdf(printWindow);
 else printWindow.close();
});
$("archiveJson").addEventListener("click",async()=>{
 if(await exportOwnerStillAuthorized())
  download(fileBase()+".json",JSON.stringify(bundle,null,2),"application/json;charset=utf-8");
});
$("archiveVerify").addEventListener("click",()=>$("archiveFile").click());
$("archiveFile").addEventListener("change",async()=>{
 const f=$("archiveFile").files?.[0];if(!f)return;
 reset(); // Never retain a previous export when a new file is invalid.
 try{
  const authorized=await companyForOwner(auth.currentUser);
  if(!authorized||!ownerCompany||authorized.id!==ownerCompany.id)
   throw Error("売上資料を開く権限がありません。");
  const data=JSON.parse(await f.text());
  if(!ownerCompany||data?.payload?.company?.id!==ownerCompany.id)throw Error("現在の会社のオーナーが作成した資料のみ表示できます。");
  if(data.kind!=="sales-archive"||data.version!==1||!data.payload||!data.checksum)throw Error("正しい売上保存JSONではありません。");
  if(await sha(data.payload)!==data.checksum)throw Error("内容の整合性確認に失敗しました。破損や改変の可能性があります。");
  const saved=data.payload;
  const policy=archiveExportPolicy({
    warnings:saved.warnings,rows:saved.rows,
    records:saved.original?.records,companyVerified:true
  });
  bundle=data;
  // SHA-256 checks accidental corruption, not authorship or server truth:
  // anyone holding a JSON file can rewrite both its contents and hash.
  // Never certify/reprint a saved file as a current, official PDF/CSV.
  $("archivePdf").disabled=true;
  $("archiveCsv").disabled=true;
  $("archiveJson").disabled=!policy.canExportEvidenceJson;
  $("archiveSummary").textContent="📂 保存済み資料を表示中 ／ "+data.payload.period+" ／ 日別実績 "+
   data.payload.summary.dailyRecords+"件 ／ 獲得 "+data.payload.summary.count+"件 ／ 売上 "+money(data.payload.summary.revenue);
  status("✓ JSONの破損検査は完了しました。ただしSHA-256は発行者・実データの正しさを保証しません。保存済みJSONからの確定PDF/CSV出力は停止しました。現在の原票を再確認して出力してください。Firestoreの変更・復元はしていません。");
 }catch(err){status("✕ "+String(err?.message||err));}
 $("archiveFile").value="";
});
onAuthStateChanged(auth,async user=>{
 const id=++revision;ownerCompany=null;button.style.display="none";close();
 if(!user)return;
 try{
  const c=await companyForOwner(user);
  if(id!==revision||auth.currentUser?.uid!==user.uid)return;
  ownerCompany=c;button.style.display=c?"block":"none";
 }catch(err){console.warn("売上資料の権限確認:",err);}
});
