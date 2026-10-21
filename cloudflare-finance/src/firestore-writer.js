/**
 * Atomic Firestore REST transaction adapter. No deletes, no bulk migrations.
 * Only a single daily record and, when editing, one new immutable correction
 * document are allowed in the same commit.
 */
import {SaveConflict} from "./count-service.js";
function isId(v){return typeof v==="string" && /^[A-Za-z0-9_-]{1,150}$/.test(v);}
function segmentPath(v){
  if(typeof v!=="string"||!v.split("/").every(isId))throw Error("invalid_firestore_path");
  return v.split("/").map(encodeURIComponent).join("/");
}
function value(x){
  if(x===null || x===undefined)return {nullValue:null};
  if(typeof x==="boolean")return {booleanValue:x};
  if(typeof x==="number"){
    if(!Number.isFinite(x))throw Error("nonfinite_firestore_number");
    return Number.isInteger(x)?{integerValue:String(x)}:{doubleValue:x};
  }
  if(typeof x==="string")return {stringValue:x};
  if(Array.isArray(x))return {arrayValue:{values:x.map(value)}};
  if(typeof x==="object")return {mapValue:{fields:fields(x)}};
  throw Error("unknown_firestore_type");
}
function fields(doc){
  return Object.fromEntries(Object.entries(doc).filter(([k,v])=>v!==undefined)
    .map(([key,v])=>[key,value(v)]));
}
function fromValue(v){
  if(!v)return null;
  if("nullValue"in v)return null;
  if("stringValue"in v)return v.stringValue;
  if("integerValue"in v)return Number(v.integerValue);
  if("doubleValue"in v)return Number(v.doubleValue);
  if("booleanValue"in v)return v.booleanValue;
  if("timestampValue"in v)return v.timestampValue;
  if("arrayValue"in v)return (v.arrayValue.values||[]).map(fromValue);
  if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,v])=>[k,fromValue(v)]));
  return null;
}
function doc(raw){
  if(!raw)return null;
  const parsed=Object.fromEntries(Object.entries(raw.fields||{}).map(([k,v])=>[k,fromValue(v)]));
  return {id:String(raw.name||"").split("/").at(-1),...parsed,__firestoreUpdateTime:raw.updateTime||null};
}
function equal(field,x){return {fieldFilter:{field:{fieldPath:field},op:"EQUAL",value:{stringValue:x}}};}
function abortErr(label,status=503){const e=new Error(label);e.status=status;return e;}
export function makeFirestoreRestStore(env,{token,fetcher=fetch}){
  if(!env || env.FIREBASE_PROJECT_ID!=="sales-management-cc116")throw Error("wrong_project");
  if(typeof token!=="function")throw Error("token_provider_required");
  const root="https://firestore.googleapis.com/v1/projects/sales-management-cc116/databases/(default)";
  async function send(endpoint,method,request,bearer){
    const res=await fetcher(root+endpoint,{
      method,
      headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
      ...(request===undefined?{}:{body:JSON.stringify(request)})
    });
    if(res.status===404 && method==="GET")return null;
    if(!res.ok){
      // Important: DO NOT echo Firestore response bodies; they may include
      // confidential prices, identities or correction history.
      if(res.status===409||res.status===412)throw new SaveConflict("concurrent_edit");
      throw abortErr("firestore_transaction_failed_"+res.status);
    }
    return await res.json();
  }
  return {
    async runTransaction(job){
      const bearer=await token(env,fetcher);
      const start=await send("/documents:beginTransaction","POST",{options:{readWrite:{}}},bearer);
      if(typeof start?.transaction!=="string"||!start.transaction)throw abortErr("transaction_not_created");
      const transaction=start.transaction;
      const writes=[];
      let staged=false;
      const ensureReadable=()=>{if(staged)throw Error("read_after_write_staged");};
      // Firestore Write.update.name requires a RESOURCE PATH (projects/...),
      // never the complete HTTPS REST endpoint URL.
      const name=path=>"projects/sales-management-cc116/databases/(default)/documents/"+segmentPath(path);
      async function lookup(path){
        ensureReadable();
        const raw=await send("/documents/"+segmentPath(path)+"?transaction="+encodeURIComponent(transaction),"GET",undefined,bearer);
        return doc(raw);
      }
      async function search(col,conditions){
        ensureReadable();
        const structuredQuery={from:[{collectionId:col}],
          where:conditions.length===1?conditions[0]:{compositeFilter:{op:"AND",filters:conditions}},
          limit:1000};
        const result=await send("/documents:runQuery","POST",{transaction,structuredQuery},bearer);
        if(!Array.isArray(result))throw abortErr("unexpected_query_result");
        const values=result.filter(item=>item.document).map(item=>doc(item.document));
        if(values.length>=1000)throw abortErr("too_many_documents_for_safe_write");
        return values;
      }
      const context={
        get:lookup,
        queryDaily:(companyId,uid,date)=>search("records",[equal("companyId",companyId),equal("uid",uid),equal("date",date)]),
        queryProducts:companyId=>search("products",[equal("companyId",companyId)]),
        saveRecord(recordId,body,previousVersion){
          if(!isId(recordId)||writes.some(w=>w.update?.name===name("records/"+recordId)))throw Error("duplicate_record_stage");
          if(writes.length)throw Error("record_must_be_staged_first");
          staged=true;
          const data={...body};
          delete data.createdAt;delete data.updatedAt;delete data.reportedAt;
          const attrs=fields(data);
          const isCreate=!previousVersion;
          writes.push({
            update:{name:name("records/"+recordId),fields:attrs},
            ...(!isCreate?{updateMask:{fieldPaths:Object.keys(attrs)}}:{}),
            currentDocument:isCreate?{exists:false}:{updateTime:previousVersion},
            updateTransforms:[
              {fieldPath:"updatedAt",setToServerValue:"REQUEST_TIME"},
              {fieldPath:"reportedAt",setToServerValue:"REQUEST_TIME"},
              ...(isCreate?[{fieldPath:"createdAt",setToServerValue:"REQUEST_TIME"}]:[])
            ]
          });
        },
        addCorrection(correctionId,body){
          if(!staged || writes.length!==1 || !isId(correctionId))throw Error("invalid_correction_stage");
          writes.push({
            update:{name:name("recordCorrections/"+correctionId),fields:fields(body)},
            currentDocument:{exists:false},
            updateTransforms:[{fieldPath:"createdAt",setToServerValue:"REQUEST_TIME"}]
          });
        }
      };
      try{
        const result=await job(context);
        if(writes.length<1 || writes.length>2)throw Error("invalid_commit_write_count");
        const response=await send("/documents:commit","POST",{transaction,writes},bearer);
        if(!Array.isArray(response.writeResults)||response.writeResults.length!==writes.length)
          throw abortErr("commit_ack_unconfirmed");
        return result;
      }catch(e){
        // On failures before commit, server transaction can be rolled back.
        // A failed COMMIT network request may still have committed; clients
        // must query the date again before retrying. Never blindly re-send.
        try{await send("/documents:rollback","POST",{transaction},bearer);}catch{}
        throw e;
      }
    }
  };
}
