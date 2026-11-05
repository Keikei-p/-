// NO DEPLOY: strict future raw-finance closure prototype for current integrated Rules.
// Does not change firebase.json, deployed Rules, Auth, sales data, or client behavior.
import {checkFinanceRulesBeforeDeploy} from '../scripts/check-finance-read-boundary-before-deploy.mjs';
const tables=['products','records','recordCorrections','revenueGoals'];
const stop=code=>{throw Error('INTEGRATED_STAGE2_STOP_'+code);};
function bounds(s,table){
 const re=new RegExp('^    match /'+table+'/\\{[A-Za-z][A-Za-z0-9]*\\} \\{','gm');
 const m=[...s.matchAll(re)];
 if(m.length!==1)stop('BLOCK_'+table);
 const end=s.indexOf('\n    match /',m[0].index+m[0][0].length);
 return [m[0].index,end<0?s.length:end];
}
function rule(body,verb,table){
 const re=new RegExp('allow\\s+'+verb+'\\s*:\\s*if\\s*([\\s\\S]*?);','g');
 const m=[...body.matchAll(re)];
 if(m.length!==1)stop('RULE_'+table+'_'+verb);
 return m[0];
}
const startMarker='match /databases/{database}/documents {';
const helper=[
 '',
 '    function isInternalFinanceReader(companyId) {',
 '      return noSecondaryPartnerWorkspace()',
 '        && isCompanyMember(companyId)',
 "        && get(companyPath(companyId)).data.get('companyKind', 'internal') == 'internal'",
 "        && get(userPath(request.auth.uid)).data.get('accessKind', 'internal') == 'internal'",
 "        && get(memberPath(companyId, request.auth.uid)).data.get('accessKind', 'internal') == 'internal'",
 "        && get(userPath(request.auth.uid)).data.get('memberType', 'internal') != 'partner'",
 "        && get(memberPath(companyId, request.auth.uid)).data.get('memberType', 'internal') != 'partner';",
 '    }',''
].join('\n');
export function modelIntegratedFinanceClosure(source){
 if(typeof source!=='string'||!source.startsWith("rules_version = '2';")||
    source.split(startMarker).length!==2||
    !source.includes('function noSecondaryPartnerWorkspace()')||
    source.includes('function isInternalFinanceReader('))stop('UNEXPECTED_INPUT');
 let out=source.replace(startMarker,startMarker+helper);
 for(const table of tables){
  const [a,b]=bounds(out,table);
  let body=out.slice(a,b);
  const read=rule(body,'read',table);
  if(!/^noSecondaryPartnerWorkspace\(\)\s*&&\s*resource\.data\.companyId\s*!=\s*null\s*&&\s*sameCompany\(resource\.data\.companyId\)/.test(read[1].trim())||
     (table==='revenueGoals'&&!read[1].includes('revenueGrantedAfterMembership(')))stop('READ_CONTRACT_'+table);
  body=body.replace(read[0],"allow read: if resource.data.companyId != null\n"+
    "        && isInternalFinanceReader(resource.data.companyId)\n"+
    "        && (isCompanyMaster(resource.data.companyId) || isCompanyOwner(resource.data.companyId));");
  for(const verb of ['create',...(table==='recordCorrections'?[]:['update'])]){
   const r=rule(body,verb,table);
   const original=r[1].trim();
   if(!original.startsWith('noSecondaryPartnerWorkspace()')||!original.includes('&&'))stop('WRITE_CONTRACT_'+table+'_'+verb);
   const id=verb==='create'?'request.resource.data.companyId':'resource.data.companyId';
   body=body.replace(r[0],'allow '+verb+': if isInternalFinanceReader('+id+")\n"+
     '        && ('+original+');');
  }
  if(table==='recordCorrections'){
   if(!body.includes('allow update, delete: if false;'))stop('RETENTION_'+table);
  }else if(rule(body,'delete',table)[1].trim()!=='false')stop('RETENTION_'+table);
  const list=[...body.matchAll(/allow\s+list\s*:\s*if\s*([\s\S]*?);/g)];
  const get=[...body.matchAll(/allow\s+get\s*:\s*if\s*([\s\S]*?);/g)];
  if(list.length||get.length>(table==='records'?1:0)||
    (get.length===1&&!get[0][1].includes('noSecondaryPartnerWorkspace()')))stop('ADDITIVE_READ_'+table);
  out=out.slice(0,a)+body+out.slice(b);
 }
 const checked=checkFinanceRulesBeforeDeploy(out);
 if(checked.staticShapeValid!==true||checked.productionDeploymentApproved!==false)stop('PREFLIGHT');
 return Object.freeze({rules:out,productionApproved:false,
   requiresLegacyBrowserMigration:true,requiresLiveUidE2E:true,
   requiresVerifiedBackupRestore:true});
}
