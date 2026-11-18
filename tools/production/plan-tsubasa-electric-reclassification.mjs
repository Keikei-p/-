/**
 * OFFLINE PLANNER ONLY: no Firebase imports, reads, writes or deployment.
 * Reassign exactly the hub company's historical "つばさ" product to the
 * already-registered "つばさ電気" product. Never delete a document/product,
 * change dates, teams, staff, count totals, revenue, unit rates or cashback.
 * All updates must be applied by a separately reviewed transactional executor
 * that verifies beforeResults and appends an audit in the same transaction.
 */
import {isDeepStrictEqual} from "node:util";

const fail = reason => { throw Error("STOP_TSUBASA_RECLASS_" + reason); };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const id = v => typeof v === "string" && /^[A-Za-z0-9_:-]{1,200}$/.test(v) &&
  !["__proto__", "prototype", "constructor"].includes(v);
const normalized = v => typeof v === "string" ? v.normalize("NFKC").replace(/[\s　]/g, "") : "";
const validAmount = n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const planKey = (productId, cashback) => productId + "__cb_" + cashback;

function validatedLine(row) {
  if (!object(row) || !id(row.productId) ||
      !validAmount(row.count) ||
      !validAmount(row.cashback ?? 0) ||
      !validAmount(row.revenuePerUnit)) fail("INVALID_RESULT_LINE");
  return {count:row.count, cashback:row.cashback ?? 0, rate:row.revenuePerUnit};
}
function totals(results) {
  let count=0, revenue=0;
  for (const row of Object.values(results)) {
    const v=validatedLine(row);
    count+=v.count;
    revenue+=v.count*v.rate;
    if (!validAmount(count)||!validAmount(revenue)) fail("TOTAL_OVERFLOW");
  }
  return {count,revenue};
}
function approvedRate(product, cb) {
  const options=product.pricingOptions;
  if (Array.isArray(options) && options.length) {
    if (options.length>15) fail("PRICING_UNKNOWN");
    const matches=options.filter(p=>Number(p?.cashback)===cb);
    if (matches.length!==1 ||
        !validAmount(Number(matches[0].revenuePerUnit)) ||
        matches[0].revenuePerUnit===null ||
        matches[0].revenuePerUnit==="") fail("PRICING_MISMATCH");
    return Number(matches[0].revenuePerUnit);
  }
  if (Array.isArray(product.cashbackOptions) &&
      (product.cashbackOptions.length>1 ||
       product.cashbackOptions.some(c=>Number(c)>0))) fail("LEGACY_PRICING_UNKNOWN");
  if (cb!==0 || !validAmount(product.revenue)) fail("PRICING_MISMATCH");
  return product.revenue;
}
function mergeCompatible(a,b) {
  const left={...a},right={...b};
  delete left.productId;delete left.productName;delete left.count;
  delete right.productId;delete right.productName;delete right.count;
  return isDeepStrictEqual(left,right);
}
function exactProduct(products, companyId, name) {
  const matches=products.filter(p=>p?.companyId===companyId && normalized(p.name)===name);
  if (matches.length!==1||!id(matches[0].id)) fail("PRODUCT_IDENTITY_" + (name==="つばさ"?"SOURCE":"TARGET"));
  return matches[0];
}

/**
 * Inputs must be a complete, company-scoped read-only inventory taken at a
 * consistent snapshot. Do not use a current-month screen's partial records.
 * The plan includes private before/after maps for a future CAS+audit executor;
 * NEVER print the updates array or source document contents in CI logs.
 */
export function planTsubasaElectricReclassification({companyId,products,records}={}) {
  if (!id(companyId)||!Array.isArray(products)||!Array.isArray(records)||
      products.length>10000||records.length>100000) fail("INVENTORY_SCOPE");
  const source=exactProduct(products,companyId,"つばさ");
  const target=exactProduct(products,companyId,"つばさ電気");
  if (source.id===target.id||target.active!==true) fail("TARGET_NOT_ACTIVE_OR_DISTINCT");
  const updates=[];
  let movedCount=0,movedLines=0,mergedLines=0;
  const seen=new Set();
  for (const record of records) {
    if (!object(record)) fail("INVALID_RECORD");
    if (record.companyId!==companyId) continue;
    if (!id(record.id)||seen.has(record.id)) fail("DUPLICATE_RECORD");
    seen.add(record.id);
    if (!object(record.results)) fail("RESULTS_SHAPE");
    const original=record.results;
    const entries=Object.entries(original);
    if (entries.some(([,row])=>normalized(row?.productName)==="つばさ" &&
          row?.productId!==source.id)) fail("UNRESOLVED_HISTORIC_ALIAS");
    const from=entries.filter(([,row])=>row?.productId===source.id);
    if (!from.length) continue;
    if (typeof record.date!=="string" ||
        !/^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(record.date) ||
        typeof record.uid!=="string"||!record.uid||
        !validAmount(record.totalCount)||!validAmount(record.totalRevenue)) fail("RECORD_IDENTITY");
    const before=totals(original);
    if (before.count!==record.totalCount||before.revenue!==record.totalRevenue)
      fail("EXISTING_TOTAL_DRIFT");
    const next={...original};
    for (const [oldKey,row] of from) {
      const value=validatedLine(row);
      // A product change must not cause a live display to reprice history.
      if (approvedRate(source,value.cashback)!==value.rate ||
          approvedRate(target,value.cashback)!==value.rate) fail("DISPLAYED_REVENUE_DRIFT");
      const targetRows=Object.entries(next).filter(([key,item])=>
        key!==oldKey && item?.productId===target.id &&
        (item?.cashback ?? 0)===value.cashback);
      if (targetRows.length>1) fail("AMBIGUOUS_TARGET_LINES");
      let targetKey=planKey(target.id,value.cashback);
      let targetRow=null;
      if (targetRows.length) {
        [targetKey,targetRow]=targetRows[0];
        const v=validatedLine(targetRow);
        if (v.rate!==value.rate||!mergeCompatible(row,targetRow))
          fail("COLLISION_DIFFERENT_PRICE_OR_METADATA");
        const sum=v.count+value.count;
        if (!validAmount(sum)) fail("COUNT_OVERFLOW");
        next[targetKey]={...targetRow,count:sum};
        mergedLines++;
      } else {
        if (Object.prototype.hasOwnProperty.call(next,targetKey)&&targetKey!==oldKey)
          fail("TARGET_KEY_COLLISION");
        next[targetKey]={...row,productId:target.id,productName:target.name};
      }
      delete next[oldKey];
      movedCount+=value.count;
      movedLines++;
    }
    const after=totals(next);
    if (!isDeepStrictEqual(before,after)) fail("TOTAL_CHANGED");
    // Existing unrelated product rows are byte-for-byte equal at the value level.
    for (const [key,row] of entries) {
      if (row?.productId===source.id||row?.productId===target.id) continue;
      if (!Object.prototype.hasOwnProperty.call(next,key) ||
          !isDeepStrictEqual(next[key],row)) fail("OTHER_PRODUCT_CHANGED");
    }
    updates.push(Object.freeze({
      recordId:record.id,companyId,uid:record.uid,date:record.date,
      teamId:record.teamId??null,
      expectedResults:original,nextResults:next,
      unchangedTotalCount:record.totalCount,
      unchangedTotalRevenue:record.totalRevenue
    }));
  }
  return Object.freeze({
    mode:"OFFLINE_PLAN_NO_WRITES",companyId,
    sourceProductId:source.id,targetProductId:target.id,
    affectedRecords:updates.length,movedLines,movedCount,mergedLines,
    deletes:0,otherProductChanges:0,updates:Object.freeze(updates)
  });
}
