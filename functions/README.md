# 将来用 Cloud Functions

このフォルダは将来 Firebase Blaze プランへ移行する場合の参考実装です。

現在の本番は Spark プランで、アプリはこのFunctionsコードを呼び出していません。
また、`firebase.json` からFunctionsデプロイ設定を外しているため、通常の本番運用ではデプロイ対象になりません。

現在の会社管理・招待・権限制御は `index.html` と `firestore.rules` が本番実装です。


## 準備済み: オーナーによるメンバー完全削除

`deleteCompanyMemberAccount` は、Blazeプランへ移行してFunctionsを本番デプロイした後に使う想定です。

- 実行できるのは会社オーナーのみ
- 自分自身・他のオーナーは削除不可
- 先にFirestore側を利用停止
- Firebase Authenticationの対象UIDを削除
- `users/{uid}` と `companies/{companyId}/members/{uid}` を削除
- `records` の過去実績は保持
- Auth側が既に消えている古いメンバーもクリーンアップ可能

SparkプランのままではFunctionsを本番デプロイできないため、この処理はまだ本番アプリから呼び出しません。
