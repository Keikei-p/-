// Exercise the frozen historical package only, in its existing disposable
// runner boundary. This is not a package for the current integration source.
import path from "node:path";
import {REVIEWED,makeOwnerPackage,writeDisposablePackage}
 from "../../tools/production/prepare-hub-owner-correction-v3-package.mjs";
import {historicalSources} from "./historical-builder-fixtures.mjs";

const prepared=makeOwnerPackage(historicalSources(REVIEWED));
const destination=path.join(process.env.RUNNER_TEMP||"",
 "nico-reviewed-owner-correction-v3-package");
writeDisposablePackage(prepared,destination);
console.log("HISTORICAL_PACKAGE_FIXTURE_ONLY_CURRENT_SOURCE_NOT_APPROVED_NO_DEPLOY");
