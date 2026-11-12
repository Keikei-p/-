# NICO Phase-1 finance boundary: affected-account production signoff (NO DEPLOY)

**Draft review checklist — NOT an approval, signature, deployment or successful real-user test.**

Project: `sales-management-cc116`. Repository: `Keikei-p/-`.
Production: https://nico-factory.web.app/
Dependencies: PR #358 (reviewed Rules), #376 (switch+rollback), #378 (user
get/list), #379 (Owner preflight), #380 (affected identity binding).

## 2026-11-12 — Genuine independent GitHub review now enforced by code (NO DEPLOY)

**Authoritative status at this writing: NOT APPROVED.** Both this
Draft [PR #380](https://github.com/Keikei-p/-/pull/380) and the feature
Draft [PR #690](https://github.com/Keikei-p/-/pull/690) currently have
zero review requests and zero approved human reviews.

In addition to its existing immutable Rules/checkout/CI/managed-backup and
real-user gates, the Phase-1 local manual apply operator now performs
a **read-only authenticated GitHub API review lookup before obtaining any
service-account credential or Firestore data**:

1. PR #380 must be open, **ready for review rather than Draft**, and its
   HEAD must match the exact locally reviewed checkout SHA.
2. The latest effective review must be **APPROVED on that exact commit**
   by a different human GitHub account, not the PR author, a bot or a
   read-only commenter. The reviewer's repository permission must be
   `write`, `maintain` or `admin`, verified via GitHub API.
3. A later CHANGES_REQUESTED or DISMISSED review prevents using a stale
   approval. An unavailable GitHub API or more than one page of reviews
   fails closed. A self-declared environment approval string never
   substitutes for a verified external review.
4. **This is additional to**, not a replacement for, the independently
   signed per-release approval record, the exact reviewed main SHA
   and successful exact-checkout `push` CI. The operator's older
   `REVIEWED_MAIN` SHA is still intentionally **not updated** by this
   development PR. A separate authorized reviewer must explicitly review
   and approve that change before any Rules-only production switch.

Implementation: `tools/production/phase1-reviewed-operator.mjs`;
regression: `tests/phase1-reviewed-operator.test.mjs`. The latest exact-HEAD
no-deploy checks must pass before an external reviewer can sign.
**This document does not itself request, grant or impersonate a review.**

---

## Release sequence

1. **Independent human review**. Authorized maintainer reviews the exact
   candidate Rules, their effects on real Owner access and affected secondary
   users, and the code changes. Approval is explicitly recorded by the human,
   with the required `sales-production-reviewed` protection gate and signed
   release record. Bot comments, CI green checks or user requests alone are
   not a substitute for a separate independent signoff. No fake signature.
2. **Production backup and archive**. Check managed Firestore backup READY
   within 48 h for the exact project and database. Read-only complete typed
   snapshot twice, restore all doc IDs and fields in an isolated emulator,
   verify digest parity. This is **NOT** a managed backup restoration and
   cannot restore metadata timestamps. Preserve sales, CB, prices, team
   history, corrections, Auth, LINE and existing account links.
3. **Exact reviewed source**. Only the original main Rules Git blob
   `d9f4df6a2ac0f8b5720534a2461ec66b94379190` and new reviewed
   `6d6ac7fd3544b0326823e419a3acd7e1d060b714` may be considered.
   Review the actual live Rules **source content**, not just a filename.
   Unknown source, concurrent operator or changed inventory: STOP.
4. **Independent affected account identity**. From a trusted, private
   execution environment, a server-side OAuth credential does only
   read-only GETs for internal Owner and the **specific affected dual-context
   partner**. Verify `users/{uid}`, `companies/{hub}`,
   `companies/{hub}/members/{uid}`, `partnerWorkspaceContexts/{uid}`,
   partner company and its member; confirm owner has no secondary context.
   This prevents incorrectly proving security with an unrelated 403 user.
   No other partner UID may be silently substituted.
5. **Real user-session access**. Independently obtained Firebase Auth
   **user ID tokens** for those two different authenticated accounts are
   needed for Firestore REST. Never paste or commit tokens, cookies, emails,
   document IDs, amounts, or service-account JSON into ChatGPT, GitHub,
   GitHub Actions logs or PR comments. Do **not** use Admin SDK/OAuth to
   test Firestore Security Rules; Admin credentials bypass them.
6. **Pre-switch test**. The Owner's user ID token must read the existing
   internal company `products.revenue` and `records.totalRevenue` via
   GET and a company-scoped read-only `:runQuery`. The candidate Rules must
   deny the affected partner via the local Firestore Emulator. Expecting the
   partner to get 403 under the old **vulnerable** live Rules is incorrect.
7. **Narrow Rules-only switch**. Only after steps 1–6 are reviewed and
   independently approved, use the *existing* local/manual
   `tools/production/phase1-reviewed-operator.mjs`. The operator is NOT
   currently eligible for `apply` because its pinned main SHA is historical
   and independent review is missing. Do not blindly refresh that pin:
   reassess the exact source, matching successful CI event, active Rules,
   rollback and real account evidence with a different authorized reviewer.
   The engine re-reads the exact Rules and inventory, creates the reviewed candidate Ruleset and
   updates only the cloud.firestore release. There is no record, user,
   product, price, history, Hosting, Functions or LINE write.
8. **Immediate post-switch verification**. Recheck the exact affected
   Owner/partner identity using privileged **read-only** membership reads;
   then require Owner user-token finance GET/LIST 200 and affected partner
   user-token finance GET/LIST **403** on both real existing documents.
   Any failed/malformed result, wrong UID, expiring token, identity drift,
   data drift or changed Rules: STOP, use the switch engine's rollback when
   no concurrent release superseded it. Manual intervention is required
   when a concurrent operator changed the Rules. Never show successful
   deployment from synthetic test results.
9. **Post-release audit**. Confirm actual release source, real user access,
   Owner dashboard amount visibility, partner count-only UI, count entry
   and reporting paths and unchanged production document inventory. Then
   consider the **separate** combined ranking/UI release PR #690.
   Issue #352 has one historical saved total vs product-row mismatch:
   preserve provisional ranks rather than automatically editing history.

## 2026-11-12 15:37 JST — Fresh complete production inventory / LOCAL restore PASS (NO DEPLOY)

This is **live GET-only Firestore document inventory and a disposable local
Firestore Emulator restore**, **not** a restored Firestore managed-backup
payload, and not Firebase Auth/Storage recovery. Do not assume historical
record content was repaired or update production based on this proof.

- [Reviewed VERIFY_ONLY GitHub Actions run #42036092110, attempt 4](https://github.com/Keikei-p/-/actions/runs/42036092110):
  immutable original main commit `17681e69d3ebd7271cc9a58e138fd0e202db7294`,
  original protected `controlled` job **SUCCESS**, final
  `RELEASE_MODE=verify`, `NICO_RULES_APPROVAL=VERIFY_ONLY`. Offline
  prerequisite SUCCESS. The reviewed source does not run production
  Rules writes in verify mode.
- Exactly **512 Firestore documents** discovered from current production
  `sales-management-cc116` (the prior Nov 6 snapshot had 391).
  `fieldsAndIdsRestored=true`; `fullInventoryStableBefore=true`;
  isolated emulator restoration matches complete field+ID fingerprint
  `608584ea5160ba0c48e582b37e8cfb452996c8dfdb078b6d19e91318fffcb8d8`.
- `metadataTimestampsRestored=false`,
  `managedBackupRestored=false`, `productionDocumentWrites=0`,
  `applied=false`. The code did not update Cloud Firestore Rules,
  Hosting, Functions, Auth, history, financial originals, or customer
  counts. No managed-backup payload or Auth/Storage recovery was tested.
- This **satisfies the current live-data field+ID parity / isolated
  emulator restoration evidence**, but not the production **managed
  backup's recoverability**, independent human signoff, or real
  partner's user-token finance GET/LIST deny. Reviewer must decide whether
  the separate managed-backup payload restore is required before any
  nonreversible production change; do not waive or self-sign it.
- Full snapshot is current **as of this run only**: recheck production
  backup READY age, baseline Rules, document inventory and session
  freshness at actual cutover. The 512-vs-391 count difference is not a
  signal to modify or erase any data.

---

## Latest verified LIVE GET-only status — 2026-11-12 JST (NOT a release approval)

This supersedes the **historical 2026-11-05 observations** below,
without approving any Rules switch or weakening an independent review.

- **Actual live secondary-context risk inventory (new evidence)**:
  [Actions #42491278046, latest run attempt](https://github.com/Keikei-p/-/actions/runs/42491278046),
  `production-read-only` **SUCCESS** around 2026-11-12 15:01 JST.
  `secondaryContextsPresent=true`,
  `oldInternalFinancePathPresent=true`,
  `ownerContextConflictPresent=false`,
  `unrecognizedContextPresent=false`,
  `readyBackupPresent=true`,
  `recentReadyBackupWithin48h=true`,
  `exactReviewedPhase1RulesActive=false`,
  `authenticatedBoundaryProofStillRequired=true`,
  `safeToDeploy=false`.
  There is also `transferCandidatePresent=true`, but no account
  reassignment, deletion, transfer or user-data modification was authorized
  or carried out. This scan is a trusted metadata/structure indicator of
  a live legacy finance-read route, **not** proof that a specific
  Firebase user token successfully read any money document.
  **No partner feature may be enabled on the basis of UI redaction alone.**
  Do NOT silently replace the affected user with a generic test UID
  to obtain a misleading denial in the next release proof.
- **Managed-backup inventory**:
  [Actions #41322350604, most recent run attempt](https://github.com/Keikei-p/-/actions/runs/41322350604) live-inventory **SUCCESS** around Nov 12 14:42 JST.
  Exact project `sales-management-cc116`; **6 READY** backups, newest
  `2026-11-11T06:22:30.344918Z` (Nov 11 15:22:30 JST).
  Metadata-only: **no managed-backup restoration**, no full production
  document fingerprint, no isolated restore, no writes.
- **Active Rules source**:
  [Actions #42475737038, most recent run attempt](https://github.com/Keikei-p/-/actions/runs/42475737038) live-get-only **SUCCESS** around Nov 12 14:43 JST.
  Exact active Rules source matches reviewed blob
  `d9f4df6a2ac0f8b5720534a2461ec66b94379190`;
  static finance markers passed. It is **NOT** the separate Phase-1
  candidate blob `6d6ac7fd3544b0326823e419a3acd7e1d060b714`.
  The audit expressly states `realPartnerGetListProven:false`,
  `userDataReads:0`, `productionWrites:0`, `deploys:0`.
  A source match is NOT real-user finance GET/LIST-denial proof.
- **Operator is currently not executable for apply**:
  `phase1-reviewed-operator.mjs` pins
  `REVIEWED_MAIN=17681e69d3ebd7271cc9a58e138fd0e202db7294`,
  but the actual current main inspected on Nov 12 is
  `516bfe74f525ad8ee95a800f796c77327cf9aeae`.
  Its exact-source gate intentionally rejects this drift before `apply`.
  The currently observed PR #380 CI
  [#42210220979](https://github.com/Keikei-p/-/actions/runs/42210220979)
  is a `pull_request` event; the operator requires a successful reviewed
  **push** CI for the *exact* checkout. A distinct authorized reviewer
  must re-review the changed baseline, candidate, and source provenance,
  then explicitly authorize a new pin and current matching CI;
  **do not simply change SHA constants or relax an event check**.
- **Sequence**: Phase 1 Draft #380 first, after real Owner/affected partner
  proof and independent approval; [Draft #690](https://github.com/Keikei-p/-/pull/690)
  for SKU/partner counts and four leaderboards second. Both currently OFF.
  Issue #352 is deferred by the Owner; don't auto-rewrite any history or
  claim an unverified affected period is a verified joint ranking.
- **Still required**: exact-current full live inventory/isolated restore
  and rollback, actual affected dual-member partner + genuine Owner UID
  finance GET/LIST permissions, partner count-entry continuity, signed
  independent review, controlled Rules-only release and post-release proof.
  Nothing in this document authorizes restoring, billing, deployment
  or writing to a live database.

---

## Explicit release state (last verified 2026-11-05)

- Production Rules: previous reviewed source `d1d9998d...`, **not**
  new secondary-partner boundary; raw finance access risk remains.
- Production inventory: the Nov 5 read-only run #42036092110 restored
  **390 documents** (IDs/fields) to an isolated emulator; no production writes.
  This is historical evidence, not an always-current backup or proof of
  managed-backup restoration.
- PR #380: draft, synthetic only, no production credentials or deployment.
- No independent signed release approval; no real Owner/affected-partner
  authenticated GET/LIST test performed. **PRODUCTION_APPROVED=false**.
- Do not remove old memberships or delete old data to make tests pass.
  They are required to retain sales and correction history.
