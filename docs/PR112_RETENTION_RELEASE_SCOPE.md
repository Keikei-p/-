

---

## 2026-10-29 — 退職者の物理削除を利用停止へ変更する保全コード（PR #112）

- 作業目的: 退職・所属解除の際に、Authユーザーや `users/{uid}`・`companies/{companyId}/members/{uid}` を削除せず、元UID・社員名・班履歴・過去実績との参照を保持する。
- 変更内容: 現在は使用されていないCloud Functions候補の `deleteCompanyMemberAccount` を、両方の会社所属一致・owner保護を確認して `active:false` とAuth無効化だけに限定。古い呼出名は互換性維持。既存の本番Firestore・Authは一切更新しない。
- 対象ファイル: `functions/index.js`、`tests/sales-regressions.cjs`、`scripts/check-sales-safe-pr.mjs`、`.github/workflows/member-retention-manual-release.yml`、このレビュー記録。
- FunctionsのデプロイはSparkプランの現行環境では**実施しない**。将来必要な場合のみ既存プロジェクトへの影響・料金・全件バックアップ/隔離復元・別途明示承認を得る。新Workflowは手動入力必須・main限定・NICO公式URLのみ・通常push/PRでは動かない。
- このPR自体では `index.html`、`firestore.rules`、`firebase.json`、売上・単価・CB・実績件数・所属/会社データ・Firebase Hostingを変更しない。
- 実データ完全バックアップ/復元、協力店の財務原票遮断、2,000件超の画面切替は**まだ未完了**。これを本番完成と誤認しない。
- 管理者本人署名: 未取得。この文書は作業者による技術レビュー記録であり、署名の代用ではない。

