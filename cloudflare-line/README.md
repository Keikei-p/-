# LINE通知 無料運用版（Cloudflare Workers Free）

## 目的

Firebase Cloud Functions / Cloud Scheduler をLINE通知用途から外し、
Cloudflare Workers Freeへ移行して「課金より停止を優先する」構成にします。

## 構成

- Webhook: `/line-webhook`
- ヘルスチェック: `/health`
- 未報告チェック: 5分ごと
- Firestore: REST API + Service Account
- LINE Secrets: Cloudflare Worker Secret
- 初期状態: `AUTOMATION_ENABLED=false`

## Worker Secrets

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

ソースコードには秘密情報を保存しません。

## 切り替え順序

1. Cloudflare Workerをデプロイ
2. `/health` が200になることを確認
3. LINE DevelopersのWebhook URLをWorkerの `/line-webhook` に変更
4. アプリから新しい連携コードを発行し、LINEグループで連携テスト
5. `AUTOMATION_ENABLED=true` に変更してWorker再デプロイ
6. 未報告通知の実送信を確認
7. Firebaseの `lineWebhook` と `sendMissingReportReminders` を削除
8. FirebaseをSparkへ戻す

## 重要

Cloudflare版の実送信確認が終わる前にFirebase Functionsを削除しないでください。
Sparkへ戻すのも最後です。
