# Cloud Functions — 営業実績アプリ

このフォルダには Firebase Cloud Functions の本番用コードがあります。

## 現在の主なFunction

- `lineWebhook`
  - LINE Messaging API のWebhook
  - アプリで発行した8桁の連携コードをLINEグループから受け取り、会社の通知設定へグループIDを保存
  - `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` を Firebase Secret Manager から参照

- `sendMissingReportReminders`
  - Asia/Tokyo で毎分実行
  - 会社ごとの通知曜日・通知時刻を確認
  - 当日の未報告人数を班単位で集計
  - 0件報告（`reportStatus: no_result`）も報告済みとして扱う
  - 同一時刻の二重送信を `notificationDispatches` で防止
  - LINE 429 / 5xx / 通信系エラーは最大3回まで自動再試行

既存の会社管理用Callable Functionsも残していますが、今回のLINE通知機能の本番デプロイ対象は上記2Functionです。

## 本番デプロイ条件

Cloud Functionsを本番利用するには Firebase プロジェクトが Blaze プランである必要があります。

GitHub Actions の `Firebase Production Deploy` を利用する場合、Repository Secrets に次の3つを設定します。

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

Secretの値はソースコードへ直接書かないでください。

## デプロイ対象

本番デプロイワークフローは以下を実行します。

1. JavaScript構文・Functions読み込み確認
2. Firebase認証確認
3. LINE用SecretをFirebase Secret Managerへ登録・更新
4. Firestore Rulesをデプロイ
5. `lineWebhook` と `sendMissingReportReminders` をデプロイ
6. Webhook URLへGETし、HTTP 405が返ることをスモークテスト

## データ保護

- 過去の `records` は削除しない
- 実績訂正で本人の `teamHistory` は変更しない
- 訂正内容は `recordCorrections` へ監査保存
- メンバー完全削除でも過去実績は保持する
