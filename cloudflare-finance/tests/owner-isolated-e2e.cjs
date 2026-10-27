const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path");
const assert=require("node:assert/strict");
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
 const page=await context.newPage();
 const source=fs.readFileSync(path.join(__dirname,"../preview/owner.html"),"utf8");
 let activations=[],external=0;
 const leaders=[{uid:"partner1",name:"協力店リーダー",teamId:"A",accessKind:"direct"}];
 await page.route("**/*",async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==="isolated-owner.test")
   return route.fulfill({contentType:"text/html",body:source.replace('const OWNER_GATEWAY_URL="";',
     'const OWNER_GATEWAY_URL="https://safe-owner-gateway.test";')});
  if(url.hostname==="www.gstatic.com")return route.fulfill({contentType:"application/javascript",body:
    url.pathname.endsWith("firebase-app.js")?"export const initializeApp=()=>({});":
    "const user={email:'owner@example.test',emailVerified:true,getIdToken:async()=> 'fake-owner-only'};"+
    "export const getAuth=()=>({currentUser:user});export const signInWithEmailAndPassword=async()=>{};"+
    "export const signOut=async()=>{};export const onAuthStateChanged=(auth,callback)=>{"+
    "window.__ownerAuthCallback=callback;queueMicrotask(()=>callback(user));};"
  });
  if(url.hostname==="safe-owner-gateway.test"){
   if(req.method()==="POST"){
    activations.push(req.postDataJSON());
    leaders[0].accessKind="partner";
    return route.fulfill({contentType:"application/json",body:JSON.stringify({active:true})});
   }
   return route.fulfill({contentType:"application/json",body:JSON.stringify({
    month:"2026-10",totalCount:7,
    ranking:[{rank:1,teamId:"A",teamName:"協力店A",totalCount:5},
      {rank:2,teamId:"B",teamName:"直営1班",totalCount:2}],
    leaders
   })});
  }
  external++;return route.abort();
 });
 page.on("dialog",dlg=>dlg.accept());
 await page.goto("https://isolated-owner.test/");
 await page.waitForFunction(()=>document.querySelector("#total").textContent.includes("7 件"));
 const ranking=await page.locator("#rankingList").innerText();
 assert.match(ranking,/協力店A/);assert.match(ranking,/直営1班/);
 assert.equal(await page.locator("#activate").isDisabled(),false);
 console.log("PASS Owner sees one combined DIRECT+PARTNER count ranking without prices");
 await page.locator("#activate").click();
 await page.waitForFunction(()=>document.querySelector("#activate").disabled);
 assert.deepEqual(activations,[{uid:"partner1"}]);
 assert.equal(await page.locator("#leader").inputValue(),"partner1");
 console.log("PASS activation posts only selected pre-invited leader UID");
 assert.equal(external,0);
 console.log("PASS browser had zero uncontrolled requests");
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
