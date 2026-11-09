/**
 * STAGING ONLY. Authenticated Firebase callable bridge for owner's reviewed
 * partner SKU mapping and count-only hub catalog. No direct Firestore reads.
 */
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const fail=()=>{throw Error("OWNER_SKU_MAPPING_FIREBASE_IDENTITY_UNVERIFIED");};
const id=v=>typeof v==="string"&&ID.test(v)&&
 !["__proto__","prototype","constructor"].includes(v);
export function createOwnerSkuMappingFirebaseBridge({
 auth,functions,httpsCallable
}={}){
 if(!auth||!functions||typeof httpsCallable!=="function")fail();
 const get=httpsCallable(functions,"getOwnerReviewedSkuMapping",{timeout:20000});
 const products=httpsCallable(functions,"getOwnerProductVisibility",{timeout:20000});
 const set=httpsCallable(functions,"setOwnerReviewedSkuMapping",{timeout:20000});
 if([get,products,set].some(f=>typeof f!=="function"))fail();
 let serial=0;
 async function actor(token){
  const user=auth.currentUser;
  if(!user||!id(user.uid)||!user.emailVerified||
     typeof user.getIdToken!=="function")fail();
  const now=await user.getIdToken();
  if(auth.currentUser!==user||typeof now!=="string"||!now||
     token!==now)fail();
  return {user,stamp:serial};
 }
 async function invoke(fn,payload,token){
  const a=await actor(token);
  const result=await fn(payload);
  if(auth.currentUser!==a.user||serial!==a.stamp||!result||
     !result.data||typeof result.data!=="object"||
     Array.isArray(result.data))fail();
  return result.data;
 }
 return Object.freeze({
  readMappings:({token}={})=>invoke(get,{},token),
  readProducts:({token}={})=>invoke(products,{},token),
  saveMapping:({token,partnerCompanyId,partnerProductId,
   hubProductId,expectedVersion}={})=>{
   if(!id(partnerCompanyId)||!id(partnerProductId)||
      (hubProductId!==null&&!id(hubProductId))||
      !Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail();
   return invoke(set,{partnerCompanyId,partnerProductId,
    hubProductId,expectedVersion},token);
  },
  onAuthChange(){serial++}
 });
}
