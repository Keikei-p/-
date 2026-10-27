# 朝・夜・未報告 LINE自動報告 — クラウド試験仕様

## 概要
従来の通知設定 `companies/{companyId}/settings/notifications` にある**ひとつの `enabled`** を、朝・夜・未報告の自動送信共通ON/OFFとして利用する。新しいチェックボックスや権限フラグは追加しない。

送信対象になる条件は、会社が有効、`enabled: true`、`lineEnabled: true`、連携済み `lineGroupId`、設定曜日に該当する場合に限定。現時点で本番のCloud Functionsは動作しておらず、旧通知設定だけではLINE送信は成立しない。

| 日本時間 | 種類 | 文面 |
|---|---|---|
| 09:00 | 朝礼 | 班別月間目標件数・月間累計獲得件数 |
| 19:00 | 最終報告 | 班別月間目標件数・月間累計獲得件数 |
| 19:05 | 未報告確認 | 未報告班の名前だけ。件数・金額は送信しない |

**売上額、単価、CB、商品別売上をLINEへ送信しない。**
`@All` はテキストでありLINEの正式なメンション通知ではない。

## 作成したもの
- `reports/format.mjs`: 件数専用の朝礼・最終・未報告文面
- `reports/worker.mjs`: Cloudflare Cron、Firestore REST取得、LINE Messaging API Push、送信重複防止
- `wrangler.sales-reports.toml`: 3つの固定Cron（UTCの00:00/10:00/10:05）
- `tests/report-format.test.mjs`: 件数だけであること、未報告抽出を検証
- `index.html`: 既存の通知設定ON/OFFを朝夜未報告の共通スイッチとして表示

## 本番反映前の準備
1. LINE公式アカウントのMessaging APIを有効化。対象グループにBotを追加。Webhookで連携済みグループIDを確認する。
2. Firebaseで専用のサーバー用サービスアカウントを作る。GitHubや公開Web画面にはJSON秘密鍵を置かない。Cloudflare Workersの暗号化Secretsを使う。
3. Firestore複合インデックス `records(companyId ASC, date ASC)` を有効化する（売上アーカイブPR #104の定義を参照）。
4. `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --config wrangler.sales-reports.toml` と `npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config wrangler.sales-reports.toml` を実施。FirebaseプロジェクトIDも確認する。
5. `REPORT_DELIVERY_ENABLED = "false"` のまま、ステージング環境でCloudflare Workersへデプロイし、Cron実行ログで件数の整合性・通信回数・エラーを検証。
6. ownerのLINE接続先と曜日、通知ON/OFFを確認し、許可されたテストグループに対してのみ実送信テスト。
7. 「レコードの保存値 vs 集計値」「二重送信」「未報告ゼロ」「0件報告」「月替わり」「日付/曜日」をテストした後に、`REPORT_DELIVERY_ENABLED = "true"` を承認のうえ切り替える。

## 注意
- このPRは**未デプロイ・送信OFFが初期値**。実LINE通知はまだ稼働していない。
- 同一会社・同日・同種類の送信予約を一つのドキュメントで管理し、繰り返し送信を防止する。予約後に障害が起きた場合は安全側で自動再送を止め、`notificationDispatches` の失敗を監視して手動復旧する。完全な「必ず1回」の保証ではない。
- 時刻は現段階では固定。既存の `notificationTimeInput` の時間設定は旧未報告リマインド向けで、新しい固定Cronの時間は変更しない。
- 実績データ全量ではなく該当月、未報告の場合は当日のみクエリする。会社数の増加に応じてFirebase/Workers/LINE無料枠の読み取り回数を監視する。
- 並走中のFirebase Functions版のスケジュールを後で起動する場合、重複通知しないよう送信責務を統一する。
- Cloudflare Workerは特権のあるサービスアカウントを使用する。最小権限・秘密鍵のローテーション・ログの秘密情報マスキングを徹底する。

## ローカル検証
```bash
node --test tests/report-format.test.mjs
node --check reports/worker.mjs
```
