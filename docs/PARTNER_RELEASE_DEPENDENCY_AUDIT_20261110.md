# Partner release dependency audit — 2026-11-10

## Verified GitHub PR topology
- PR #351 (Draft): feature/partner-shared-catalog-rank-20261103 -> release/nico-partner-compact-two-column-index-20261102; shared catalog, count ranks and owner/partner UI. **Not merged**.
- PR #367 (Draft): fix/partner-publish-off-inactive-20261105 -> feature/partner-shared-catalog-rank-20261103; safe OFF for retired catalog products. **Not merged**.
- PR #624 (Draft): fix/partner-legacy-publication-guard-20261109 -> feature/partner-shared-catalog-rank-20261103; legacy publication, count-only ranking and UI safeguards. **Not merged**.
- PR #563: direct ranking endpoint route fix -> main. **Merged**.

## Conflicts and non-assumptions
- #367 and #624 are **sibling branches**, not a linear dependency chain. Both change functions-partner-workspace/service.cjs and tests/partner-workspace.test.cjs; they cannot be assumed combined by merging #624 alone.
- #351 itself depends on an older release branch, not main. Its diff relative to main must be audited before any merge.
- Passing isolated #624 CI does **not** prove #367 fixes, full dashboard parity, production finance boundary, or production deployment.

## Safe release sequence
1. Confirm current main and release-base differences and inspect full source/Rules diff. Do not change production data.
2. In an isolated integration branch, incorporate #351, #367 and #624 intentionally; resolve service.cjs and tests conflicts without losing either publication guard.
3. Run complete offline/unit/security/UI suites, including direct and partner account boundary tests; ensure no finance fields, unit prices or cashback amounts in partner responses.
4. Confirm verified backup and restoration rehearsal, Firestore Rules access boundaries and callable deployment inventory. No destructive migrations.
5. Stage and smoke test login/invite, own and partner counts, edits, joint rankings and same-app dashboard on mobile.
6. Only after passing gates, release with rollback path and perform live post-release verification.

## Last observed CI
#624 commit eac582f04968d2510f901475becda007b3ad2e2e: Partner legacy publication guard run 42642919228 success; Sales Archive Preflight run 42642919571 success. This is **not** a production sign-off.
