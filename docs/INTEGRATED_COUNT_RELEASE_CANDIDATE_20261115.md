# Integrated count release candidate — review only

The source anchor is PR #704 commit `0701fd732c3f33d58f91a28d8d0f3f94856244ec`. The follow-up preserves its frontend and #706 pricing repair, incorporates main 2249fbe, #719 HEAD 771b6e55 and #720 HEAD fca7529b, fixes the confirmed Owner codebase collision, and updates offline validation. The final PR HEAD and the source-manifest digest require independent review. The JSON locks 71 source/config files, 38 backend source files and 26 frontend dependencies. It conveys no signature or release authorization.

The bounded backend scope is six existing function names across their actual codebases:

```
functions:partner-workspace:getPartnerWorkspace
functions:partner-workspace:submitPartnerWorkspaceCounts
functions:hub-owner-correction-v3:listHubPartnerCounts
functions:hub-owner-correction-v3:correctHubPartnerCounts
functions:ranking-owner-approvals:getVerifiedJointCountRanking
functions:ranking-owner-approvals:setOwnerProductVisibility
```

Authenticated production metadata confirmed that the Owner functions already belong to `hub-owner-correction-v3`. The workspace entry no longer exports those names. The existing staged Owner implementation retains Tokyo, minInstances 0, maxInstances 2, the same callable names and the existing per-function `HUB_OWNER_COUNT_CORRECTION_V3_ENABLED` flag. Production currently enables the list and disables correction. This work changes neither flag. Its offline builder reuses the existing strict package constructor to prepare the same self-contained six-file package; no second Owner implementation is introduced. Direct deployment of the unprepared source folder is unsupported. Five other deployed settings, mapping and legacy consent endpoints are inspection-only.

The frontend requires 46 Hosting paths: preserve 29 current paths, replace `index.html`, `partner-workspace.html`, `owner-partner-setup.html` and `ranking/owner-partner-setup-mount.mjs`, and add 13 dependencies. The current service worker, PWA assets, diagnostics, invitation/count pages and Hosting configuration remain unchanged. The baseline is the authenticated 33-file #706 version `sites/nico-factory/versions/a68817fa14752460`; configuration SHA-256 is `3607756f3a42651deaa312840ed8b64fc16a999fdc2e9cff06ce1a0831540c43`. Current index raw SHA-256 is `0822a201ac791e62dac9e032e80af8eb08622c2ba5adc62cc6313934f9cbe6d1`. Actual compressed baseline identifiers are pinned. The offline bundle constructor prepares 17 exact gzip upload byte streams, their hashes, three existing Functions packages and a 46-path Hosting manifest in a recorded Node/zlib runtime. Packaging grants no release authorization.

Read-only authenticated inventory found 20 regional Functions and seven READY backups; the latest observed backup snapshot is `2026-11-14T06:39:11Z`. Existing Owner settings endpoints are already enabled. The joint-ranking HTTP endpoint is deployed with its ranking flag disabled. Candidate frontend feature constants remain OFF. No production environment flag was changed.

Fresh recovery verification is recorded in `docs/fresh-firestore-restore-verification-20261115.json`: 574 current production documents were read through the bounded REST-only collector, restored into an isolated localhost emulator, and every document ID and typed field was compared. The complete before/after production fingerprints, including source metadata, matched. Production writes and cloud resource creation were zero; no permanent private snapshot was saved. The traversal is not an atomic database snapshot, original metadata timestamps are not restored, and this is not restoration of a managed-backup payload or an Auth/Storage backup.

Run the source-scope checks with repository LF bytes:

```
node tools/production/verify-integrated-count-release-candidate.mjs --offline . docs/integrated-count-release-candidate-20261115.json
node --test tests/integrated-count-release-candidate.test.mjs tests/canonical-hub-owner-package.test.mjs
```

`--verify` performs bounded public GETs and, only with an existing protected credential, whitelisted Hosting/Functions metadata GETs. It never invokes count callables or accesses user documents. Both `--apply` and `--release` refuse before opening candidate files or loading credentials. Historical publishers, their source locks, manual inputs, release jobs and signed sections are unchanged. The PR-only offline reviewer cannot authorize dispatch, main push, forks, another PR or a release.

Remaining production requirements are genuine final-candidate independent review/signature and green required CI; the previous finance-denial pass confirmed by the user, with its evidence retained for the final source; real Owner login, finance access and designated-day save/readback/correction; company/team/person/product count reconciliation; exact environment/cost scope review; and a signed, narrowly scoped apply operation with rollback and post-publication checks. No actual-user success or full production completion is claimed by the synthetic tests or this inventory.

The latest specification uses active existing count-sharing relations and the hub Owner publication settings; extra bilateral ranking consent is not a count gate. Existing name approvals are optional display evidence, rechecked in the count transaction. Unconfirmed foreign personal names are anonymous; same-company names and all verified counts remain. Historical consent documents and their old audited writer are retained.

A GET-only reconciliation observed 162 internal documents (161 matching stored totals, one known October mismatch), 80 partner staff entries and 27 matching staff/day summaries, with no Quick/staff duplication. Source responses matched on the second read. All 405 existing variant keys matched their embedded real product IDs. The repaired pure count reader accepted September 7 and November 44 documents without monetary fields; it still rejected the known October mismatch. This sequential compatibility audit is not a signed-in or atomic production-ranking proof. No original document was changed.

Authenticated GET-only inspection of the two deployed settings source archives found the SKU setter store and controller identical to this candidate. The visibility setter has the public-catalog transaction and identical controller, but its store omits Unicode NFKC normalization for monetary labels. The existing regression rejects fullwidth monetary labels before any visibility/catalog/audit write. Updating that existing setter is therefore included; the other settings Functions are preserved. No source archive or credential was persisted and no production resource was changed.
