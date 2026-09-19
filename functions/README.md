# 将来用 Cloud Functions

このフォルダは将来 Firebase Blaze プランへ移行する場合の参考実装です。

現在の本番は Spark プランで、アプリはこのFunctionsコードを呼び出していません。
また、`firebase.json` からFunctionsデプロイ設定を外しているため、通常の本番運用ではデプロイ対象になりません。

現在の会社管理・招待・権限制御は `index.html` と `firestore.rules` が本番実装です。
