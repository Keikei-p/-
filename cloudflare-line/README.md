# LINE通知 無料運用版（Cloudflare Workers Free）

## 目的

Firebase Cloud Functions / Cloud Scheduler をLINE通知用途から外し、
Cloudflare Workers Freeへ移行して「課金より停止を優先する」構成にします。

## 構成

- Webhook: `/line-webhook`
- ヘルスチェック: `/health`
- 未報告チェック: 5分ごとのCron。設定開始時刻から当日中1時間ごとに未報告班のみ通知
- Firestore: REST API + Service Account
- LINE Secrets: Cloudflare Worker Secret
- 本番設定: `AUTOMATION_ENABLED=true`（会社の通知設定やLINE連携がOFFなら送信しません）

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
5. `AUTOMATION_ENABLED=true` と会社側の通知設定・LINE連携を確認
6. 未報告通知の実送信を確認
7. Firebaseの `lineWebhook` と `sendMissingReportReminders` を削除
8. FirebaseをSparkへ戻す

## 重要

Cloudflare版の実送信確認が終わる前にFirebase Functionsを削除しないでください。
Sparkへ戻すのも最後です。


## 0円固定ガード

このWorkerは費用発生より停止を優先します。

- LINE Push APIは当月利用数を送信前に確認
- LINEグループ人数を取得し、次の1送信で増える人数を見積もる
- 月180通を内部ハード上限として、超える見込みなら送信しない
- LINE利用数やグループ人数を確認できない場合も送信しない
- Reply APIによる連携確認はLINEの配信通数カウント対象外
- Cloudflare WorkerはCPU 10ms / 50 subrequestsの上限
- Cronは5分おき
- Workerは自動チェックON、会社側の通知設定は初期OFF（有効化・連携した会社のみ通知）

### 0円固定の最終条件

1. Cloudflare WorkersをFreeプランのまま使う
2. LINE公式アカウントをコミュニケーションプラン（月額0円・追加メッセージ不可）にする
3. Cloudflare版の動作確認後、FirebaseのCloud Billingリンクを解除しSparkへ戻す
4. Firebase Cloud FunctionsをLINE通知経路として使用しない
5. 有料Google Cloudサービスを同じFirebaseプロジェクトで新たに有効化しない

この条件を維持した場合、上限到達時は課金ではなく機能停止を優先します。

## 未報告LINE通知の再確認（2026-10-10）

- 新規の会社設定は19:00開始。既に保存されている通知時刻は勝手に変更しないため、既存の会社はアプリの「通知設定」で確認してください。
- 当日中、開始時刻から1時間ごとに未報告を再評価します。全班の報告完了後は送信しません。
- Cronの数分程度の遅延は同じ予定時刻として扱います。
- LINEへの再試行は `X-Line-Retry-Key` を使い、二重送信を避けます。
- 無料通数上限（月180通）を超えそうな場合や利用数が確認できない場合は送信せず、`notificationDispatches` にブロック状態を記録します。
- サービス稼働（`/health` の200）とLINEの実着信は別です。LINEグループの実着信と `notificationDispatches` の `sent` / `failed` / `blocked_free_guard` を確認してください。
- 以後、`main` にWorker関連コードがマージされるとGitHub Actionsが構文・単体テスト後に自動デプロイします。
