/**
 * STAGING / NO DEPLOY. Browser adapter for TWO flag-disabled owner callables.
 * Firebase Functions SDK supplies the authenticated Firebase user token.
 * This bridge never queries raw products/records or writes Firestore directly.
 */
const STOP=()=>{throw Error("OWNER_PRODUCT_PUBLICATION_IDENTITY_CHANGED_OR_UNAVAILABLE");};
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
function createOwnerProductVisibilityFirebaseBridge({
 auth,functions,httpsCallable
}={}){
 if(!auth||!functions||typeof httpsCallable!=="function")STOP();
 const get=httpsCallable(functions,"getOwnerProductVisibility",{timeout:20000});
 const set=httpsCallable(functions,"setOwnerProductVisibility",{timeout:20000});
 if(typeof get!=="function"||typeof set!=="function")STOP();
 let lastUid=null;
 async function identity(token){
  const u=auth.currentUser;
  if(!u||typeof u.uid!=="string"||!ID.test(u.uid)||
     !u.emailVerified||typeof u.getIdToken!=="function")STOP();
  const current=await u.getIdToken();
  if(auth.currentUser!==u||typeof current!=="string"||!current||
     token!==current)STOP();
  lastUid=u.uid;
  return u;
 }
 async function invoke(fn,body,token){
  const old=await identity(token);
  const response=await fn(body);
  if(auth.currentUser!==old||old.uid!==lastUid)STOP();
  if(!response||response.data==null||typeof response.data!=="object")STOP();
  return response.data;
 }
 return Object.freeze({
  async load({token}={}){return invoke(get,{},token);},
  async save({token,productId,enabled,expectedVersion,
    partnerCompanyId=null}={}){
   if(typeof productId!=="string"||!ID.test(productId)||
      typeof enabled!=="boolean"||
      !Number.isSafeInteger(expectedVersion)||expectedVersion<0||
      (partnerCompanyId!==null&&
       (typeof partnerCompanyId!=="string"||!ID.test(partnerCompanyId))))STOP();
   return invoke(set,{productId,enabled,expectedVersion,partnerCompanyId},token);
  },
  onAuthChange(){lastUid=null;}
 });
}
export {createOwnerProductVisibilityFirebaseBridge};
