# Integrated count release candidate — review only

The source anchor is PR #704 commit `0701fd732c3f33d58f91a28d8d0f3f94856244ec`. The follow-up preserves its frontend and #706 pricing repair, incorporates main 2249fbe0cd5060b64fcd81ec230edca29d8f2946, fixes the confirmed Owner codebase collision, and updates offline validation. The final PR HEAD and the source-manifest digest require independent review. The JSON locks 65 source/config files, 38 backend source files and 20 frontend dependencies. It conveys no signature or release authorization.

The bounded backend scope is five existing callable names across their actual codebases:

```
functions:partner-workspace:getPartnerWorkspace
functions:partner-workspace:submitPartnerWorkspaceCounts
functions:hub-owner-correction-v3:listHubPartnerCounts
functions:hub-owner-correction-v3:correctHubPartnerCounts
functions:ranking-owner-approvals:getVerifiedJointCountRanking
```

Authenticated production metadata confirmed that the Owner functions already belong to `hub-owner-correction-v3`. The workspace entry no longer exports those names. The existing staged Owner implementation retains Tokyo, minInstances 0, maxInstances 2, the same callable names and the existing per-function `HUB_OWNER_COUNT_CORRECTION_V3_ENABLED` flag. Production currently enables the list and disables correction. This work changes neither flag. Its offline builder reuses the existing strict package constructor to prepare the same self-contained six-file package; no second Owner implementation is introduced. Direct deployment of the unprepared source folder is unsupported. Six already-deployed settings, mapping and consent endpoints are inspection-only.

The frontend requires 46 Hosting paths: preserve 31 current paths, replace `index.html` and `partner-workspace.html`, and add 13 dependencies. The current service worker, PWA assets, diagnostics, invitation/count pages and Hosting configuration remain unchanged. The baseline is the authenticated 33-file #706 version `sites/nico-factory/versions/a68817fa14752460`; configuration SHA-256 is `3607756f3a42651deaa312840ed8b64fc16a999fdc2e9cff06ce1a0831540c43`. Current index raw SHA-256 is `0822a201ac791e62dac9e032e80af8eb08622c2ba5adc62cc6313934f9cbe6d1`. Actual compressed Hosting identifiers are separately pinned; future upload hashes are unprepared. A later reviewed operator must prepare exact upload bytes in its pinned runtime.

Read-only authenticated inventory found 20 regional Functions and seven READY backups; the latest observed backup snapshot is `2026-11-14T06:39:11Z`. Existing Owner settings endpoints are already enabled. The joint-ranking HTTP endpoint is deployed with its ranking flag disabled. Candidate frontend feature constants remain OFF. No production environment flag was changed.

Fresh recovery verification is recorded in `docs/fresh-firestore-restore-verification-20261115.json`: 574 current production documents were read through the bounded REST-only collector, restored into an isolated localhost emulator, and every document ID and typed field was compared. The complete before/after production fingerprints, including source metadata, matched. Production writes and cloud resource creation were zero; no permanent private snapshot was saved. The traversal is not an atomic database snapshot, original metadata timestamps are not restored, and this is not restoration of a managed-backup payload or an Auth/Storage backup.

Run the source-scope checks with repository LF bytes:

```
node tools/production/verify-integrated-count-release-candidate.mjs --offline . docs/integrated-count-release-candidate-20261115.json
node --test tests/integrated-count-release-candidate.test.mjs tests/canonical-hub-owner-package.test.mjs
```

`--verify` performs bounded public GETs and, only with an existing protected credential, whitelisted Hosting/Functions metadata GETs. It never invokes count callables or accesses user documents. Both `--apply` and `--release` refuse before opening candidate files or loading credentials. Historical publishers, their source locks, manual inputs, release jobs and signed sections are unchanged. The PR-only offline reviewer cannot authorize dispatch, main push, forks, another PR or a release.

Remaining production requirements are genuine final-candidate independent review/signature and green required CI; real primary/secondary partner finance GET/LIST denial; real Owner login, finance access and designated-day save/readback/correction; company/team/person/product count reconciliation; exact environment/cost scope review; and a signed, narrowly scoped apply operation with rollback and post-publication checks. No actual-user success or full production completion is claimed by the synthetic tests or this inventory.
