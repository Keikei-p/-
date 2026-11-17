#!/usr/bin/env node
/**
 * Read-only audit / offline preparation of the NICO login-only visual transplant.
 * Uses the LIVE public page as canonical source, never writes Firebase.
 * Does not copy an old main index over a separately deployed Hosting revision.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const BASE_SHA='1fb08a776c4e8c520425151bb4834a5a38d9abfc';
const MAIN_INDEX=BASE_SHA+':index.html';
const sha=x=>createHash('sha256').update(x).digest('hex');

const slots=[
  {key:'ios-input',start:'#authScreen .form-group input:not([type="checkbox"]):not([type="radio"])',end:'\n'},
  {key:'fx-style',start:'\n#nfLoginFX{',end:'@media(max-width:760px)'},
  {key:'reduced-motion',start:'@media(prefers-reduced-motion:reduce)',end:'\n'},
  {key:'fx-controller',start:'<script id="nfLoginFXController">',end:'</script>',includeEnd:true}
];
function findSlot(source,slot){
  const a=source.indexOf(slot.start);
  if(a<0||source.indexOf(slot.start,a+slot.start.length)>=0)throw Error('MISSING_OR_DUPLICATE_'+slot.key);
  const b=source.indexOf(slot.end,a+slot.start.length);
  if(b<0)throw Error('MISSING_END_'+slot.key);
  const end=b+(slot.includeEnd?slot.end.length:0);
  return {a,end,text:source.slice(a,end)};
}
export function applyLoginOnly({base,proposed,live}){
  if(![base,proposed,live].every(x=>typeof x==='string'&&x.length>100000&&x.includes('id="nfLoginFX"')))
    throw Error('INVALID_LOGIN_DOCUMENT');
  let baseMask=base,proposedMask=proposed,liveNext=live;
  const evidence={};
  // First prove every change from base to proposed is inside four visual slots.
  for(const slot of slots){
    const b=findSlot(base,slot),p=findSlot(proposed,slot);
    if(b.text===p.text)throw Error('EXPECTED_VISUAL_PATCH_MISSING_'+slot.key);
    const replacement='__REVIEWED_LOGIN_ONLY_SLOT_'+slot.key+'__';
    baseMask=baseMask.replace(b.text,replacement);
    proposedMask=proposedMask.replace(p.text,replacement);
    evidence[slot.key]={before_sha256:sha(b.text),after_sha256:sha(p.text)};
  }
  if(baseMask!==proposedMask)
    throw Error('STOP_PROPOSED_SOURCE_HAS_NON_VISUAL_CHANGES');
  // Live may differ from main anywhere else, but none of those bytes may be touched.
  // If live FX itself has changed from the reviewed source, stop for human review.
  for(const slot of slots){
    const b=findSlot(base,slot),p=findSlot(proposed,slot),current=findSlot(liveNext,slot);
    if(current.text===p.text){evidence[slot.key].already_live=true;continue;}
    if(current.text!==b.text)
      throw Error('STOP_LIVE_VISUAL_SLOT_DRIFT_'+slot.key+'_sha256_'+sha(current.text));
    liveNext=liveNext.slice(0,current.a)+p.text+liveNext.slice(current.end);
    evidence[slot.key].already_live=false;
  }
  let restored=liveNext;
  for(const slot of slots){
    const b=findSlot(base,slot),p=findSlot(proposed,slot),c=findSlot(restored,slot);
    if(c.text!==p.text)throw Error('STOP_PATCH_VERIFICATION_'+slot.key);
    const old=findSlot(live,slot).text;
    restored=restored.slice(0,c.a)+old+restored.slice(c.end);
  }
  if(restored!==live)throw Error('STOP_LIVE_NON_VISUAL_BYTES_CHANGED');
  for(const forbidden of ['id="authButton"','id="appScreen"','id="authScreen"','id="partnerInviteInline"']){
    if(!live.includes(forbidden)||!liveNext.includes(forbidden))throw Error('STOP_REQUIRED_LIVE_MARKUP_MISSING');
  }
  return {candidate:liveNext,evidence,liveSha256:sha(live),candidateSha256:sha(liveNext),changed:live!==liveNext};
}
async function run(){
  const args=process.argv.slice(2);
  if(args.length>2||!['--audit','--prepare'].includes(args[0])||(args[0]==='--prepare'&&!args[1]))
    throw Error('USAGE_audit_or_prepare_output_path');
  const base=execFileSync('git',['show',MAIN_INDEX],{encoding:'utf8',maxBuffer:3e6});
  const proposed=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const target='https://nico-factory.web.app/?login_fx_surgical_audit='+encodeURIComponent(process.env.GITHUB_SHA||'read-only');
  const response=await fetch(target,{headers:{Accept:'text/html'},redirect:'follow',signal:AbortSignal.timeout(25000)});
  if(!response.ok||new URL(response.url).origin!=='https://nico-factory.web.app')throw Error('STOP_LIVE_HTML_UNAVAILABLE');
  const live=await response.text();
  const output=applyLoginOnly({base,proposed,live});
  console.log(JSON.stringify({status:output.changed?'SAFE_LOGIN_ONLY_TRANSPLANT_PREPARED':'ALREADY_LIVE',
    live_sha256:output.liveSha256,candidate_sha256:output.candidateSha256,
    original_bytes:Buffer.byteLength(live),candidate_bytes:Buffer.byteLength(output.candidate),
    exact_visual_slots:Object.keys(output.evidence),evidence:output.evidence,
    note:'READ_ONLY_AUDIT_NO_FIREBASE_WRITES'}));
  if(args[0]==='--prepare')writeFileSync(args[1],output.candidate,{flag:'wx',mode:0o600});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  run().catch(e=>{console.error('SAFE_STOP '+e.message);process.exitCode=1;});
