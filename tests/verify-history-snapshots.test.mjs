import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonical} from '../scripts/verify-history-snapshots.mjs';
const script=new URL('../scripts/verify-history-snapshots.mjs',import.meta.url).pathname;
const sample=(documents)=>({projectId:'sales-management-cc116',documents});
function check(a,b){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sales-history-'));
  try{
    const before=path.join(dir,'before.json'),after=path.join(dir,'after.json');
    fs.writeFileSync(before,JSON.stringify(a));fs.writeFileSync(after,JSON.stringify(b));
    return spawnSync(process.execPath,[script,before,after],{encoding:'utf8'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const one={path:'companies/fictional/records/example',value:{counts:[{n:2,product:'some-product'}],price:2500,historicalTeam:'old-team',enabled:false}};
test('canonicalization sorts object keys but never array order',()=>{
  assert.equal(canonical({b:2,a:{y:4,x:3}}),canonical({a:{x:3,y:4},b:2}));
  assert.notEqual(canonical([1,2]),canonical([2,1]));
});
test('identical data in different inventory order passes',()=>{
  const other={path:'users/fictional',value:{role:'leader',permission:false}};
  const r=check(sample([one,other]),sample([{...other,value:{permission:false,role:'leader'}},one]));
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/PASS:/);
});
test('changing a historical team, count or monetary value is blocked',()=>{
  for(const value of [{...one.value,historicalTeam:'another'},{...one.value,price:2501},{...one.value,counts:[{n:3,product:'some-product'}]}]){
    const r=check(sample([one]),sample([{...one,value}]));
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.stdout,/Changed: 1/);
    assert.ok(!r.stdout.includes('old-team'));
  }
});
test('deleted or added document blocked',()=>{
  assert.equal(check(sample([one]),sample([])).status,1);
  assert.equal(check(sample([]),sample([one])).status,1);
});
test('wrong project, duplicates or malformed paths blocked',()=>{
  assert.equal(check({...sample([one]),projectId:'other'},sample([one])).status,2);
  assert.equal(check(sample([one,one]),sample([one])).status,2);
  assert.equal(check(sample([{...one,path:'companies/fictional/records'}]),sample([one])).status,2);
});
test('input values are never logged',()=>{
  const r=check(sample([one]),sample([one]));
  assert.equal(r.status,0);
  assert.ok(!r.stdout.includes('some-product'));
  assert.ok(!r.stdout.includes('fictional'));
});
