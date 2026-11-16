// Review-only historical HTML fixture. The production/current-source builder
// remains frozen and must reject the integrated partner HTML.
import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import path from "node:path";
import {buildRankingOwnerWorkspaceCandidate,REVIEWED_PARTNER_HTML_BLOB}
 from "../../tools/ranking/build-owner-settings-workspace-candidate.mjs";
import {historicalOwnerWorkspaceInputs} from "./historical-builder-fixtures.mjs";

assert.equal(process.env.GITHUB_ACTIONS,"true","HISTORICAL_PREVIEW_RUNNER_ONLY");
assert.equal(process.env.GITHUB_REPOSITORY,"Keikei-p/-","HISTORICAL_PREVIEW_REPOSITORY");
assert.ok(process.env.RUNNER_TEMP,"HISTORICAL_PREVIEW_TEMP_REQUIRED");
assert.equal(process.argv.length,2,"HISTORICAL_PREVIEW_NO_PATH_ARGUMENT");
const output=path.join(path.resolve(process.env.RUNNER_TEMP),
 "nico-owner-settings-historical-fixture.html");
const html=buildRankingOwnerWorkspaceCandidate(
 historicalOwnerWorkspaceInputs(REVIEWED_PARTNER_HTML_BLOB));
writeFileSync(output,html,{encoding:"utf8",flag:"wx"});
console.log("HISTORICAL_PREVIEW_FIXTURE_CREATED_CURRENT_SOURCE_NOT_APPROVED_NO_DEPLOY");
