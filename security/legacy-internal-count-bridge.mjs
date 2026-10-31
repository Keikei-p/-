/**
 * Finance-free legacy-to-count bridge for the NICO staged cutover.
 *
 * This module is a PURE server-side projection, NOT a deployable endpoint.
 * A trusted server must verify an ID token, re-read current Firestore
 * users/company/member documents and obtain a consistent snapshot before
 * invoking it. Do not call it from a browser with a user-supplied principal.
 *
 * Reads may come from EXISTING records/products (no historical rewrite).
 * Outputs contain no finance, pricing options, cashback or raw Firestore rows.
 * Explicitly preserves the original owner finance route separately.
 */
import {
  projectPublicRecordHeader,
  projectPublicRecordLines,
  projectPublicProduct,
  assertPublicSchema
} from "./public-projection.mjs";

const ID=/^[A-Za-z0-9_:-]{1,128}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const deny=()=>{throw Error("internal_count_bridge_denied");};
const asId=x=>typeof x==="string"&&ID.test(x);
const exactlyVerified=principal=>{
 if(!principal||typeof principal!=="object"||
    principal.firebaseIdTokenVerified!==true||
    principal.emailVerified!==true||
    principal.serverMembershipVerified!==true||
    !asId(principal.uid)||!asId(principal.companyId))deny();
 const {user,member,company}=principal;
 if(!user||!member||!company||
    user.uid!==principal.uid||member.uid!==principal.uid||
    user.companyId!==principal.companyId||
    member.companyId!==principal.companyId||
    user.active!==true||member.active!==true||company.active===false)deny();
 // Legacy direct companies can have NO companyKind; the server must
 // independently verify they are internal, and must not infer it from a
 // client-supplied role or an 'owner' string.
 if(principal.serverVerifiedInternalCompany!==true||
    ![undefined,"internal","direct"].includes(company.companyKind))deny();
 for(const x of [user.accessKind,member.accessKind,user.memberType,
                   member.memberType]){
  if(x==="partner"||x==="cooperator")deny();
 }
 // Membership roles and permissions are NOT taken from browser input.
 if(user.companyRole!==member.companyRole)deny();
 return principal.companyId;
};
const safeDate=d=>{
 if(typeof d!=="string"||!DATE.test(d))deny();
 const parsed=new Date(d+"T00:00:00Z");
 if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==d)deny();
 return d;
};
const cloneRaw=(sn,expected)=>{
 if(!sn||typeof sn!=="object"||!asId(sn.id)||
    sn.companyId!==expected)deny();
 return sn;
};
/**
 * One bounded, server-authorized daily slice.
 *
 * The API is required to enforce Firestore query's company/date filter,
 * snapshot readTime, cursor and pagination independently. A missing page
 * can never be interpreted as a zero-result day.
 */
export function projectLegacyCountDay({
 principal,day,records,products,readTime
}={}){
 const companyId=exactlyVerified(principal);
 safeDate(day);
 if(!Array.isArray(records)||records.length>50||
    !Array.isArray(products)||products.length>200||
    typeof readTime!=="string"||!readTime.trim())deny();
 const seenRecord=new Set(),seenProduct=new Set();
 const headers=[],lines=[],catalog=[];
 for(const item of products){
  const raw=cloneRaw(item,companyId);
  if(seenProduct.has(raw.id))deny();
  seenProduct.add(raw.id);
  catalog.push(projectPublicProduct(raw));
 }
 for(const item of records){
  const raw=cloneRaw(item,companyId);
  if(raw.date!==day||seenRecord.has(raw.id))deny();
  seenRecord.add(raw.id);
  const header=projectPublicRecordHeader(raw);
  const projected=projectPublicRecordLines(raw);
  headers.push(header);lines.push(...projected);
 }
 assertPublicSchema("publicProducts",catalog);
 assertPublicSchema("publicRecords",headers);
 assertPublicSchema("publicRecordLines",lines);
 // No spread from raw source documents: all returned objects are allowlisted.
 return Object.freeze({day,readTime,companyId,records:headers,
   lines,products:catalog});
}
