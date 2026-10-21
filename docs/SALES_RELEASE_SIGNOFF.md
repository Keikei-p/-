# 本番保護に関する変更のレビュー記録（2026-10-22）

## 対象
GitHub `Keikei-p/-`; Firebase `sales-management-cc116`。
新URL `nico-factory.web.app` と旧URL `keikei-p.github.io/-/` を両方維持する。

## 変更の目的
CodexとAIが作業しても、金額・単価・件数・既存実績の保存値を書き換えず、未完成のFinance GatewayやSecurity Rulesを本番へ誤展開しないための管理基盤。

## このPRの内容
- `AGENTS.md`: Codexの変更禁止事項・両URLの維持・安全なリリース手順を規定。
- `scripts/check-sales-safe-pr.mjs`: 保護対象ファイルの変更に対して管理者レビューの合図とリリース記録を要求。
- `.github/workflows/sales-safety-guard.yml`: PR差分を秘密鍵なしで検査。
- `.github/workflows/firebase-production-deploy.yml`: **本番Firestore Rulesのpushによる自動展開を停止し、mainからの明示入力付き手動実行のみに制限**。
- `docs/SALES_SAFE_CUTOVER.md`: 両URL・旧ブラウザキャッシュ・実績保存・権限テストを本番切替前に義務化。
- 本記録（将来の金額分離リリースで再作成すること）。

## 本番データ
Firestoreの `products`, `records`, `users`, `companies`, `teams`, `invitations` その他すべてのドキュメントに対して read/write/migration/delete を**行わない**。
`index.html`, `firestore.rules`, `service-worker.js`, `manifest.webmanifest`, Firebase Hostingの設定値、Cloudflareの本番Workerコードにも変更なし。

## 保護機構の限界
- PR検査は**GitHubのmainブランチ保護でrequired statusに指定しない限り、直接pushを防げない**。GitHub管理画面でブランチ保護を有効にするまでは未完成。
- `sales-production-reviewed` ラベルと変更ごとのレビュー記録は差分確認の合図に過ぎず、金額漏洩リスクを解消するものではない。
- この変更は安全運用の基盤であり、Finance Gatewayの本番切替とは完全に別。

## 人間の承認欄
このファイルはAIが準備したレビュー用記録。**実際のOwner承認や本番データ照合済みの証明ではない**。
管理者は差分・CI結果を確認してからPRに `sales-production-reviewed` ラベルを付け、マージを判断する。
