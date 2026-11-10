# Integration status (NO DEPLOY)

Integration branch forked from PR #624 head eac582f04968d2510f901475becda007b3ad2e2e and subsequent audit commit. **This is not a merged release.**

## Verified ancestry
- PR #367 and PR #624 are both ahead of PR #351 base, but sibling changes overlap in service.cjs and partner-workspace.test.cjs.
- GitHub comparison main...release/nico-partner-compact-two-column-index-20261102: diverged, 294 ahead and 294 behind at inspection time. **Never fast-forward or blindly replace main.**
- PR #563 is already merged into main; preserve its endpoint-path fix.

## Next integration tasks
1. Review #367 patches for service.cjs, catalog-publication.cjs and tests; cherry-pick/reimplement with no loss of #624 guards.
2. Add targeted regression tests for retired-product OFF, legacy OFF, stale version, owner corrections, CB leakage and counts.
3. Compare integration with current main; rebase safely or create targeted cherry-pick PR, never force push main.
4. Verify production security rules and account-level finance access, backups, mobile UI, staging and rollback.

No production deployment, database mutation, rules change, or automatic merge is authorized by this status file.
