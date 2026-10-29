/**
 * CLI-only offline preparation. Does not connect to Firebase or change any original record.
 * node security/prepare-projection.mjs ./owner-archive.json ./local-output
 */
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {projectPublicRecordHeader,projectPublicRecordLines,projectPublicProduct,projectPublicCorrectionFlat,assertPublicSchema} from "./public-projection.mjs";
import {verifyPreparedCountProjections} from "./reconcile-projections.mjs";

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error("Usage: node security/prepare-projection.mjs <archive.json> <output-directory>");
const archive=JSON.parse(await readFile(resolve(input),"utf8"));
if(archive.kind!=="sales-archive"||archive.version!==1||!archive.payload)throw Error("Unsupported archive");
const hash=obj=>createHash("sha256").update(JSON.stringify(obj)).digest("hex");
if(hash(archive.payload)!==archive.checksum)throw Error("Archive checksum mismatch. Publication aborted.");
const companyId=archive.payload.company?.id;
if(typeof companyId!=="string"||!companyId)throw Error("Company ID missing");
const original=archive.payload.original||{};
if(!Array.isArray(original.records)||!Array.isArray(original.products)||!Array.isArray(original.recordCorrections)){
 throw Error("Archive source collections are incomplete");
}
const collections={
 publicRecords:original.records.map(projectPublicRecordHeader),
 publicRecordLines:original.records.flatMap(projectPublicRecordLines),
 publicProducts:original.products.map(projectPublicProduct),
 publicRecordCorrections:original.recordCorrections.map(projectPublicCorrectionFlat)
};
for(const [name,items] of Object.entries(collections)){
 if(items.some(item=>item.companyId!==companyId))throw Error(name+" belongs to another company");
 if(new Set(items.map(item=>item.sourceId)).size!==items.length)throw Error("Duplicate "+name+" IDs");
 assertPublicSchema(name,items);
}
if(collections.publicRecords.length!==archive.payload.summary?.dailyRecords)throw Error("Source count mismatch");
// Before writing even local preview files, prove 1:1 document, line, product
// and correction parity. Unknown/missing legacy totals require owner review.
verifyPreparedCountProjections({companyId,source:{
 records:original.records,products:original.products,recordCorrections:original.recordCorrections
},publicView:collections});
await mkdir(resolve(output),{recursive:true});
for(const [name,items] of Object.entries(collections)){
 await writeFile(join(resolve(output),name+".json"),JSON.stringify({companyId,items},null,2)+"\n",{mode:0o600,flag:"wx"});
}
const manifest={
 format:"finance-free-projection-preview",companyId,sourceArchiveChecksum:archive.checksum,
 period:archive.payload.period,
 counts:Object.fromEntries(Object.entries(collections).map(([k,v])=>[k,v.length])),
 sha256:Object.fromEntries(Object.entries(collections).map(([k,v])=>[k,hash(v)])),
 containsFinancialData:false,
 note:"Offline preview only; no Firestore write was performed"
};
await writeFile(join(resolve(output),"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600,flag:"wx"});
process.stdout.write("PASS count-only projection verified. NO FIRESTORE WRITES.\n"+
 JSON.stringify(manifest.counts)+"\n");
