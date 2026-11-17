import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workflow=readFileSync(new URL("../.github/workflows/nico-joint-ranking-live-current-state.yml",import.meta.url),"utf8");
test("new audit cannot deploy or alter money, Rules, Hosting, or existing counts",()=>{
 assert.match(workflow,/NICO joint count API actual live status \(READ ONLY \/ NO DEPLOY\)/);
 assert.match(workflow,/inspect-joint-ranking-live-readonly\.mjs/);
 assert.match(workflow,/inspect-ranking-function-cli-readonly\.mjs/);
 assert.match(workflow,/firebase functions:list --project/);
 assert.match(workflow,/event_name == 'push'/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/test "\$GITHUB_SHA" = "\$\(gh api/);
 assert.match(workflow,/NO_FIRESTORE_READS_NO_FUNCTION_DEPLOYS_NO_RULES_OR_HOSTING_WRITES/);
 assert.doesNotMatch(workflow,/firebase deploy|gcloud functions deploy|firebase functions:delete|firebase firestore:delete|firestore:write|runTransaction\(/);
});
test("no production credentials are bound during unreviewed pull request",()=>{
 const pr=workflow.split("  inventory-read-only:")[0];
 assert(!pr.includes("secrets.FIREBASE_SERVICE_ACCOUNT_JSON"));
 assert.match(pr,/FIREBASE_SERVICE_ACCOUNT_JSON: ''/);
 assert.match(pr,/GOOGLE_APPLICATION_CREDENTIALS: ''/);
 assert.match(pr,/FIREBASE_TOKEN: ''/);
 const live=workflow.slice(workflow.indexOf("  inventory-read-only:"));
 assert.match(live,/needs: public-read-only/);
 assert.match(live,/github\.repository == 'Keikei-p\/-'/);
 assert.match(live,/if: always\(\)/);
 assert.match(live,/rm -f/);
});
