// Immutable historical package regression only; never an approval for current source.
import path from 'node:path';
import {REVIEWED_BLOBS,makePackage,writeDisposablePackage}
 from '../../tools/production/prepare-partner-sb-v2-verified-package.mjs';
import {historicalSources} from './historical-builder-fixtures.mjs';
writeDisposablePackage(makePackage(historicalSources(REVIEWED_BLOBS)),
 path.join(process.env.RUNNER_TEMP||'','nico-reviewed-sb-v2-functions-package'));
console.log('HISTORICAL_SB_FIXTURE_ONLY_NO_CURRENT_RELEASE_APPROVAL');
