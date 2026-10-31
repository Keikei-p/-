# 協力店の会社別リーダー／メンバー招待 — リリース記録

2026-10-31依頼：協力店の初回登録・承諾後に自社管理画面の会社一覧へ現れ、自社オーナーが会社・班・リーダー／メンバーを選んで本人招待できること。

## 実装
- `functions-partner-workspace/service.cjs`：本社Owner向け `registeredCompanies`（報告のない会社も表示）、承認済み会社への `hubAddTeam` と `hubCreateInvite` を追加。認証済み本人が30分内にリンクを承諾。未承認・他社・停止会社は拒否。
- `partner-workspace.html`：会社→班→役割→メールの選択UIとリンクのコピー。既存の協力店オーナー招待機能は存続。
- `tests/partner-workspace.test.cjs`：権限・停止・件数原票・財務非表示・歴史保全の回帰テスト。

## 安全と公開条件
原本 `products`, `records`, `recordCorrections`, `revenueGoals` を触れず、協力店独自商品の詳細を本社へ公開しない。協力店に `canViewRevenue:false` と `canViewUnitPrice:false` を設定。

GitHub `main` 統合とFirebase本番公開は別。既存 `.github/workflows/nico-partner-private-coordinated-release.yml` はソースを固定SHAで保護し、Finance Rulesの切替ゲートも未解決。双方を意図せず解除・書換しない。
本番Firebaseへ公開するには独立の復元テスト・Owner/協力店の実ログイン・元データ整合・レビュー済み専用リリースが必要。

- [ ] PR最新HEADのテスト合格
- [ ] 本番データのバックアップ復元確認
- [ ] 既存Ownerの売上・単価・件数、本番の招待・登録・訂正を検証
- [ ] 固定SHAと公開手順の独立レビュー
- [ ] Firebase Hosting/Functionsへ本番反映してURL・実機確認

本記録は承認者の署名、リリース済み証明、実機検証を代行しない。