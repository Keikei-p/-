/**
 * STAGING ONLY. Trusted count-only HTTP gateway composition, default DISABLED.
 *
 * All dependencies are provided by a server which owns credentials.
 * No Firebase/Cloudflare secret is stored in this module.
 * A browser must NEVER pass its own readDocument/loadAuthUser/executeRunQuery,
 * company ID, team permissions, or rank information.
 *
 * Enable only after production archive verification, PWA migration, and
 * financial-collection Rules cutover are independently approved.
 */
import {createFirebaseIdTokenVerifier} from "./firebase-id-token-verifier.mjs";
import {createTrustedMembershipLoader} from "./trusted-membership-loader.mjs";
import {createPublicFirestoreReader} from "./public-count-firestore-reader.mjs";
import {createCountOnlyReadHandler} from "./public-count-api.mjs";

export function createStagedCountGateway({
 enabled=false,projectId="sales-management-cc116",
 fetchKeys,subtle,nowSeconds,
 loadAuthUser,readDocument,executeRunQuery
}={}){
 // Disabled endpoint never initializes or calls privileged data adapters.
 if(enabled!==true)return createCountOnlyReadHandler({enabled:false});
 if(typeof fetchKeys!=="function"||!subtle||
    typeof loadAuthUser!=="function"||
    typeof readDocument!=="function"||
    typeof executeRunQuery!=="function")
   throw Error("Count-only trusted backend is incomplete");

 return createCountOnlyReadHandler({
  enabled:true,
  authenticateBearer:createFirebaseIdTokenVerifier({
   projectId,fetchKeys,subtle,nowSeconds
  }),
  loadMembership:createTrustedMembershipLoader({
   loadAuthUser,readDocument
  }),
  queryPublicDocuments:createPublicFirestoreReader({executeRunQuery})
 });
}
