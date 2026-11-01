import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
import {validateManifest,uploadSingleExistingPartnerInvite}
 from "../tools/hosting/surgical-existing-partner-invite.mjs";
const html=readFileSync(new URL("../partner-invite.html",import.meta.url),"utf8");
const workspace=readFileSync(new URL("../partner-workspace.html",import.meta.url),"utf8");
const hash=s=>s.repeat(64);
const originals=[
 {path:"/index.html",hash:hash("a")},
 {path:"/partner-invite.html",hash:hash("b")},
 {path:"/partner-counts.html",hash:hash("c")},
 {path:"/partner-workspace.html",hash:hash("d")}
];
test("new partner company owner is guided to existing count-only form while old workspaces remain",()=>{
 assert.match(html,/href="\/partner-counts\.html"/);
 assert.match(html,/data\.secondaryMembership===true/);
 assert.match(html,/id="acceptedBox" hidden/);
 assert.match(html,/\$\("acceptedBox"\)\.hidden=false/);
 assert.match(html,/班やスタッフの設定は後からで構いません/);
 assert.doesNotMatch(html,/件数報告は別の安全確認が終わるまで利用できません|件数報告は管理者の安全確認後に有効になります/);
 assert.match(workspace,/submitPartnerWorkspaceCounts/);
 assert.match(html,/既存の売上・単価・履歴には触れません/);
 assert.doesNotMatch(html,/firebase-firestore\.js|getFirestore\(|\brevenuePerUnit\b|\btotalRevenue\b|\bunitPrice\b/);
});
test("only existing partner invitation may be replaced; preserve index and count pages",()=>{
 const {original,next}=validateManifest(originals,new Map([["/partner-invite.html",hash("e")]]),4);
 assert.equal(next.size,4);
 for(const [file,h] of original){
  assert.equal(next.get(file),file==="/partner-invite.html"?hash("e"):h);
 }
});
test("refuse unchanged, missing, multi-file or unsafe replacement",()=>{
 assert.throws(()=>validateManifest(originals,new Map([["/partner-invite.html",hash("b")]]),4),/NO_INVITE_CHANGE/);
 assert.throws(()=>validateManifest(originals.slice(0,1),new Map([["/partner-invite.html",hash("e")]]),1),/LIVE_PARTNER_INVITE_MISSING/);
 assert.throws(()=>validateManifest(originals,new Map([["/index.html",hash("e")]]),4),/ONLY_ONE_REPLACED_INVITE_ALLOWED/);
 assert.throws(()=>validateManifest(originals,new Map([["/partner-invite.html",hash("e")],["/index.html",hash("e")]]),4),/ONLY_ONE_REPLACED_INVITE_ALLOWED/);
});
test("existing audited 11-asset Hosting manifest is inspected without changing site",async()=>{
 const paths=["/index.html","/partner-invite.html","/partner-counts.html","/partner-workspace.html",
 "/service-worker.js","/manifest.webmanifest","/favicon.ico","/assets/app.js",
 "/assets/theme.css","/icons/app.svg","/robots.txt"];
 const files=paths.map((p,i)=>({path:p,hash:hash((i%6).toString(16))}));
 const version="sites/nico-factory/versions/b0f723150d84c176",seen=[];
 const request=async(method,url)=>{
  seen.push(method);
  assert.equal(method,"GET");
  if(url.endsWith("/sites/nico-factory/releases?pageSize=1"))
   return {releases:[{version:{name:version}}]};
  if(url.endsWith("/"+version))return {name:version,status:"FINALIZED",config:{headers:[]}};
  if(url.includes("/"+version+"/files?"))return {files};
  throw Error("UNEXPECTED_REMOTE_READ");
 };
 const assetBytes=Buffer.from(html);
 const out=await uploadSingleExistingPartnerInvite({assetBytes,request,log:()=>{}});
 assert.equal(out.released,false);assert.equal(out.originalCount,11);
 assert(seen.every(x=>x==="GET"));
});

test("registered partner leader/member invite accepts actual standard email addresses",()=>{
 const sourceLine=html.split("\n").find(line=>line.includes(".test(email)"));
 assert.ok(sourceLine,"real browser email validator must be present");
 const expression=sourceLine.match(/!(\/(?:\\.|[^/])+\/)\.test\(email\)/)?.[1];
 assert.ok(expression,"extract actual regular expression from invite form");
 const pattern=runInNewContext(expression);
 for(const email of ["taro@example.com","invite+1@example.co.jp","s@example.jp"])
  assert.equal(pattern.test(email),true,email);
 for(const email of ["not-an-email","missing@", "a b@example.com","x@example"])
  assert.equal(pattern.test(email),false,email);
});
test("signup provides a distinct fix for registered email, rejected password, and disabled email provider",()=>{
 assert.match(html,/case "auth\/email-already-in-use"/);
 assert.match(html,/case "auth\/weak-password"/);
 assert.match(html,/case "auth\/operation-not-allowed"/);
 assert.match(html,/case "auth\/unauthorized-domain"/);
 assert.match(html,/case "auth\/too-many-requests"/);
 assert.match(html,/case "functions\/permission-denied"/);
 assert.match(html,/case "functions\/failed-precondition"/);
 assert.match(html,/createUserWithEmailAndPassword\(auth,email,password\)/);
 assert.match(html,/let verificationSent=false;/);
 assert.match(html,/try\{await sendEmailVerification\(credential\.user\);verificationSent=true;\}/);
 assert.match(html,/アカウントは作成できましたが、確認メールを送れませんでした/);
 assert.match(html,/新規作成は不要です/);
 assert.doesNotMatch(html,/auth\.currentUser\.delete\(|deleteUser\(/);
});

test("login has visible pending state but does not wait for optional partner workspace API",()=>{
 assert.match(html,/pending:"Firebaseにログインしています…"/);
 assert.match(html,/button\.setAttribute\("aria-busy","true"\)/);
 assert.match(html,/button\.textContent="確認中…"/);
 assert.match(html,/通信に時間がかかっています/);
 assert.match(html,/button\.removeAttribute\("aria-busy"\)/);
 const handler=html.match(/\$\("signIn"\)\.addEventListener\("submit"[\s\S]*?\n\}\);/)?.[0];
 assert.ok(handler,"sign-in handler exists");
 assert.match(handler,/await signInWithEmailAndPassword\(auth,/);
 assert.match(handler,/credential\?\.user\?\.uid/);
 assert.doesNotMatch(handler,/await refresh\(/,"do not block login on live partner service");
 assert.match(html,/Partner invitation preview failed/);
 assert.match(html,/Partner auth refresh failed/);
 assert.match(html,/case "auth\/invalid-api-key"/);
 assert.match(html,/case "auth\/internal-error"/);
 assert.match(html,/case "auth\/user-disabled"/);
});
test("failed sign-in maintains account state and does not erase existing Firebase records",()=>{
 assert.doesNotMatch(html,/deleteUser\(|deleteDoc\(|getFirestore\(|firebase-firestore\.js/);
 assert.match(html,/loginに成功|ログインに成功しました/);
 assert.match(html,/auth\/invalid-credential/);
 assert.match(html,/onAuthStateChanged\(auth,/);
});

test("existing invited accounts can request password reset without account recreation",()=>{
 assert.match(html,/id="resetPassword"/);
 assert.match(html,/sendPasswordResetEmail/);
 assert.match(html,/sendPasswordResetEmail\(auth,email\)/);
 assert.match(html,/\$\("resetPassword"\)\.addEventListener\("click"/);
 assert.match(html,/メールアドレスが登録されている場合/);
 assert.match(html,/以前の実績は削除されません/);
 assert.match(html,/case "auth\/email-already-in-use"/);
 assert.match(html,/signInWithEmailAndPassword\(auth,/);
 assert.doesNotMatch(html,/deleteUser\(|\.delete\(auth\.currentUser\)/);
});

test("accepted or expired invitation safely recovers without modifying account or records",()=>{
 assert.match(html,/id="retryInvite"/);
 assert.match(html,/id="inviteRecovery"/);
 assert.match(html,/case "functions\/not-found"/);
 assert.match(html,/case "functions\/failed-precondition"/);
 assert.match(html,/case "functions\/deadline-exceeded"/);
 assert.match(html,/getWorkspace\(\{date:new Date\(\)\.toLocaleDateString/);
 assert.match(html,/\["owner","leader","member"\]\.includes\(check\?\.role\)/);
 assert.match(html,/Array\.isArray\(check\.categories\)/);
 assert.match(html,/auth\.currentUser\?\.uid===user\.uid/);
 assert.match(html,/\$\("acceptedBox"\)\.hidden=false/);
 assert.match(html,/\$\("inviteRecovery"\)\.hidden=false/);
 assert.match(html,/\$\("retryInvite"\)\.addEventListener\("click"/);
 assert.doesNotMatch(html,/deleteUser\(|firebase-firestore\.js|\bgetFirestore\(/);
});
test("expired and previously accepted preview codes have distinct, actionable messages",()=>{
 const script=html.match(/const authErrorText=error=>\{[\s\S]*?\n\};/)?.[0];
 assert.ok(script,"error explanation must exist");
 const message=code=>runInNewContext(script+"\nauthErrorText({code:"+JSON.stringify(code)+"})");
 assert.match(message("functions/not-found"),/見つかりません/);
 assert.match(message("functions/deadline-exceeded"),/期限/);
 assert.match(message("functions/already-exists"),/承諾/);
 assert.match(message("functions/permission-denied"),/招待された/);
});

test("company invitations show server supplied expiration (old 30m and new 24h both supported)",()=>{
 assert.match(html,/const deadline=Number\(data\?\.expiresAt\)/);
 assert.match(html,/Number\.isSafeInteger\(deadline\)/);
 assert.match(html,/new Date\(deadline\)\.toLocaleString\("ja-JP"/);
 assert.match(html,/timeZone:"Asia\/Tokyo"/);
 assert.match(html,/有効期限：/);
 assert.doesNotMatch(html,/message\("招待リンクを作成しました。30分以内に宛先の方へ送ってください。"\)/);
 assert.match(html,/この会社に招待リンクを作成/);
});
