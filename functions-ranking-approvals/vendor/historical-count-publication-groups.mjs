/** Count-only publication identities for the nine EXISTING historical categories.
 * Not sales products; never create a products document, copy counts, or infer
 * a mapping to a current commercial SKU. Owner ON is still required.
 */
const PREFIX="legacyPartnerSku:";
const NAMES=["NURO","SBMNP","YMMNP","YM純新規","SB光・AIR","ウォーター",
 "つばさ・HTB","太陽光・蓄電池AP","U-NEXT"];
const ID=/^[A-Za-z0-9_:-]{1,200}$/;
const fail=()=>{throw Error("HISTORICAL_COUNT_GROUP_UNVERIFIED");};
export const HISTORICAL_COUNT_GROUPS=Object.freeze(NAMES.map((name,i)=>Object.freeze({
 id:PREFIX+"partnerSku0"+(i+1),sourceSkuId:"partnerSku0"+(i+1),
 name:name+(i===4||i===6?"（過去合算）":"（過去分）")
})));
export function historicalCountGroup(id){
 if(typeof id!=="string"||!id.startsWith(PREFIX))return null;
 const group=HISTORICAL_COUNT_GROUPS.find(g=>g.id===id);
 if(!group)fail();
 return group;
}
export function withHistoricalCountProducts(products,hub,{source=false}={}){
 if(!Array.isArray(products)||!ID.test(hub||"")||
    ["__proto__","constructor","prototype"].includes(hub))fail();
 const result=products.slice(),seen=new Set();
 for(const p of result){
  const id=source?p.sourceId:p.id;
  if(typeof id!=="string"||seen.has(id))fail();
  seen.add(id);
  const group=historicalCountGroup(id);
  if(group&&(p.name!==group.name||p.active!==true||
     (source&&p.companyId!==hub)))fail();
 }
 for(let i=0;i<HISTORICAL_COUNT_GROUPS.length;i++){
  const g=HISTORICAL_COUNT_GROUPS[i];if(seen.has(g.id))continue;
  result.push(source?{companyId:hub,sourceId:g.id,name:g.name,active:true,sortOrder:1000+i}:
   {id:g.id,name:g.name,active:true});
 }
 if(result.length>1000)fail();
 return result;
}
