#!/usr/bin/env node
/**
 * Offline, strictly read-only comparison of TWO prepared complete Firestore
 * document inventories. Does not use Firebase credentials or network access.
 * No document paths, names, contents or individual hashes are printed.
 *
 * Inventory format (not a native Firebase export):
 * {"projectId":"sales-management-cc116","documents":[
 *   {"path":"companies/sample/records/record1","value":{"count":1}}
 * ]}
 */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const PROJECT = 'sales-management-cc116';

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Non-finite number in snapshot');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  }
  throw Error('Unsupported snapshot value');
}
function digest(s) {return createHash('sha256').update(s).digest('hex');}
function inventory(file) {
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed) ||
    parsed.projectId!==PROJECT || !Array.isArray(parsed.documents)) {
    throw Error('Snapshot must contain the expected projectId and documents array');
  }
  const docs=new Map();
  for (const item of parsed.documents) {
    if (!item || typeof item!=='object' || Array.isArray(item) ||
      Object.keys(item).sort().join(',')!=='path,value' ||
      typeof item.path!=='string' || !item.path || !item.value ||
      typeof item.value!=='object' || Array.isArray(item.value)) {
      throw Error('Invalid inventory document format');
    }
    const parts=item.path.split('/');
    if (parts.some(part=>!part || part==='.' || part==='..') || parts.length%2!==0) {
      throw Error('Invalid document path structure');
    }
    if (docs.has(item.path)) throw Error('Duplicate document path in snapshot');
    docs.set(item.path,digest(canonical(item.value)));
  }
  const combined=digest(canonical([...docs.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0)));
  return {docs,combined};
}
function main(args) {
  if (args.length!==2) {
    console.error('Usage: node scripts/verify-history-snapshots.mjs BEFORE.json AFTER.json');
    return 2;
  }
  try {
    const a=inventory(args[0]),b=inventory(args[1]);
    let removed=0,added=0,changed=0;
    for (const [path,hash] of a.docs) {
      if (!b.docs.has(path)) removed++;
      else if (b.docs.get(path)!==hash) changed++;
    }
    for (const path of b.docs.keys()) if (!a.docs.has(path)) added++;
    const equal=added===0 && removed===0 && changed===0;
    console.log('Project: '+PROJECT);
    console.log('Before documents: '+a.docs.size+'; After documents: '+b.docs.size);
    console.log('Added: '+added+'; Removed: '+removed+'; Changed: '+changed);
    console.log('Before SHA-256: '+a.combined);
    console.log('After  SHA-256: '+b.combined);
    console.log(equal?'PASS: supplied document inventories are exactly equivalent':'BLOCK: supplied document inventories are different');
    console.log('NOTE: equivalence proves ONLY the supplied inventories match; it does not prove that either inventory covers the full production database.');
    return equal?0:1;
  } catch(e) {
    console.error('BLOCK: invalid inventory or comparison failed ('+e.message+')');
    return 2;
  }
}
if (process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  process.exitCode=main(process.argv.slice(2));
}
export {canonical,inventory,main};
