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
      // Never echo Firestore response bodies: they can contain sensitive data.
      // Firestore's REST emulator can send FAILED_PRECONDITION as HTTP 400
      // when an updateTime constraint fails; production may return 409/412.
      let rpcStatus="";
      try{
        const raw=await res.json();
        rpcStatus=String(raw?.error?.status||"");
      }catch{}
      if(res.status===409||res.status===412 ||
          ["ABORTED","FAILED_PRECONDITION","ALREADY_EXISTS"].includes(rpcStatus))
        throw new SaveConflict("concurrent_edit_reload_required");
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
        // Firestore's documents.get?transaction endpoint is known to hang in
        // some emulator releases. batchGet is a first-party transactional
        // read API with the same snapshot semantics; never read outside tx.
        const response=await fetcher(root+"/documents:batchGet",{
          method:"POST",
          headers:{"Authorization":"Bearer "+bearer,"Content-Type":"application/json"},
          body:JSON.stringify({documents:[name(path)],transaction})
        });
        if(!response.ok){
          if(response.status===409||response.status===412)
            throw new SaveConflict("concurrent_transaction_read");
          throw abortErr("firestore_batch_get_failed_"+response.status);
        }
        // Streaming JSON may be delivered as an array, a single object or
        // NDJSON. Accept those encodings, but fail closed on anything else.
        const body=(await response.text()).trim();
        let entries;
        try{
          const parsed=JSON.parse(body);
          entries=Array.isArray(parsed)?parsed:[parsed];
        }catch{
          try{
            entries=body.split(/\r?\n/).filter(Boolean).map(row=>JSON.parse(row));
          }catch{throw abortErr("invalid_batch_get_response");}
        }
        if(entries.length!==1)throw abortErr("unexpected_batch_get_count");
        const item=entries[0];
        if(item.missing===name(path))return null;
        if(!item.found || item.found.name!==name(path))
          throw abortErr("batch_get_document_mismatch");
        return doc(item.found);
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
        },
        // The only extra write is a nonmonetary realtime signal shared by
        // BOTH current URLs. It commits atomically with record + audit.
        addSyncSignal(companyId){
          if(!staged || !isId(companyId) || writes.length<1 || writes.length>2 ||
            writes.some(w=>String(w.update?.name).includes("/publicSync/")))
            throw Error("invalid_sync_stage");
          writes.push({
            update:{name:name("companies/"+companyId+"/publicSync/state"),
              fields:fields({companyId})},
            updateMask:{fieldPaths:["companyId"]},
            updateTransforms:[{fieldPath:"updatedAt",setToServerValue:"REQUEST_TIME"}]
          });
        }
      };
      try{
        const result=await job(context);
        if(writes.length<1 || writes.length>3)throw Error("invalid_commit_write_count");
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
