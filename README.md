# 営業実績管理アプリ — NICO FACTORY

正式利用URL: **https://nico-factory.web.app/**  
既存Firebaseプロジェクト: `sales-management-cc116`  
開発状況・本番までの残り作業: **[本番完成ボード](docs/RELEASE_BOARD.md)**

## いまの状態（2026-10-29）
本番サイトは引き続き運用中。**GitHub mainに統合されたコードと、実際に公開中のサイト・Firestore Rulesは同一とは限りません。** 特に協力店への財務原票遮断はまだ本番確認できていません。検証前に協力店へ権限を追加しないでください。

新公式URLのみを正式に使用します。旧GitHub Pagesは正式運用しませんが、旧端末の認証・PWAキャッシュに残るアクセスを無視せず、安全に切替します。GitHub mainへのpushでFirebase Hostingは**自動更新されません**。

## 機能と権限
- メール認証、会社・班・メンバー、商材、実績、目標、個人/班ランキング、スマホUI。
- owner/master: 管理権限を持つ。収益・単価の許可された閲覧。
- 許可済み社内leader/member: `canViewRevenue` と `canViewUnitPrice` を別に判定。新規招待の初期値は非表示。
- 協力店: **件数のみ**を扱う専用サーバー経路が完成するまでは、本番の財務原票へアクセスさせないこと。画面の金額マスクだけで安全と判断しない。

## 作業・公開フロー
1. [本番完成ボード](docs/RELEASE_BOARD.md) に記載された主担当PRを確認。重複PRを一括マージしない。
2. 変更は専用ブランチ/PR。最低限 `node --test tests/sales-regressions.cjs` と対象の単体テストに合格する。
3. **本番のFirestore原票、単価、CB、売上、班履歴、社員UIDを一切削除・移行・無承認再計算しない。**
4. 本番全件バックアップの独立2媒体保存と隔離復元、ロール別アクセス検証、NICO公式URL/iOS/Androidの実機動作確認を終える。
5. Hosting/Firestore Rules/Workers/LINEは別々に明示承認し手動リリース。実機と配備証跡を確認するまで「本番完成」と報告しない。

## 関連ファイル
- `index.html` — 実利用画面（mainの新版が自動公開されるわけではない）
- `firestore.rules` — 実行されるRulesの候補（GitHub変更と本番反映は別）
- `firebase.json` / `firestore.indexes.json` — Firebase設定、インデックス候補（明示配備が必要）
- `cloudflare-finance/` — 財務/件数Gatewayの**初期OFF**開発コード。勝手に公開しない
- `reports/` / `wrangler.sales-reports.toml` — 朝夜・未報告LINE、**送信OFF**
- `sales-archive.js` / `tools/readonly-backup/` — オフライン資料化・バックアップ検算。実本番データの復元試験とは別
- `functions/` — 本番未配備のFunction候補。料金・セキュリティ確認なしにデプロイしない
- `AGENTS.md` — AI/人間の開発時の厳守事項
- `docs/RELEASE_BOARD.md` — 本番完了までの作業順と判定（**進捗の正本**）

> 個人・会社の秘密情報、サービスアカウントJSON、バックアップ原票、LINEトークンはGitHub/チャットへアップロードしないこと。
