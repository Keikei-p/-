"use strict";
// A client may learn only that a whole-month ranking could not be verified.
// Never return affected document IDs, raw errors, money, prices or partial sums.
const MONTHLY_DIRECT_COUNTS_UNVERIFIED="MONTHLY_DIRECT_COUNTS_UNVERIFIED";
const INTEGRITY_ERRORS=new Set([
 "DIRECT_TOTAL_UNVERIFIED",
 "DIRECT_INVALID_QUANTITY",
 "DIRECT_TOTAL_MISMATCH",
 "DIRECT_CATEGORY_MISMATCH",
 "DIRECT_DUPLICATE_PERSON_DAY",
 "DIRECT_RECORD_SHAPE_UNVERIFIED"
]);
function isDirectCountIntegrityError(error){
 return error instanceof Error&&INTEGRITY_ERRORS.has(error.message);
}
module.exports={MONTHLY_DIRECT_COUNTS_UNVERIFIED,isDirectCountIntegrityError};
