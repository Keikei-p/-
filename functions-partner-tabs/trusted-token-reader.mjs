/**
 * STAGING / NO DEPLOY. Read verified Firebase Auth identities only.
 * Never trusts request-supplied user/company/role. Revocation and disabled
 * accounts are checked on EVERY call. No Firebase DB or financial reads.
 */
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail=()=>{throw Error("PARTNER_TABS_IDENTITY_NOT_VERIFIED");};
const validId=x=>typeof x==="string"&&ID.test(x)&&
 !["prototype","constructor","__proto__"].includes(x);
export function createVerifiedRankTokenReader({auth}={}) {
 if(typeof auth?.verifyIdToken!=="function"||
    typeof auth?.getUser!=="function")fail();
 return async token=>{
  if(typeof token!=="string"||token.length<20||token.length>12000)fail();
  let claim,profile;
  try{
   claim=await auth.verifyIdToken(token,true);
   if(!validId(claim?.uid))fail();
   profile=await auth.getUser(claim.uid);
  }catch{fail();}
  const email=typeof claim.email==="string"?
   claim.email.trim().toLowerCase():"";
  if(!validId(claim.uid)||!profile||profile.uid!==claim.uid||
     profile.disabled===true||claim.email_verified!==true||
     profile.emailVerified!==true||!EMAIL.test(email)||
     typeof profile.email!=="string"||
     profile.email.trim().toLowerCase()!==email)fail();
  return Object.freeze({uid:claim.uid,email,emailVerified:true});
 };
}
