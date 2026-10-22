# 営業実績アプリ｜本番履歴を変更しないオフライン一致照合

このツールは、**準備済みの2つのJSON一覧ファイルを比較するだけ**です。Firebase / Firestore / GitHubへの接続・読み書き・削除・デプロイは一切しません。AIへ本番の秘密鍵や実データを渡さないでください。

## 目的と制限
- 比較するもの: 各ドキュメントのパスと**全フィールド**（商材/単価/売上/件数/日時/班/権限/履歴を区別せず全て）。配列の順番も維持します。
- 出力するもの: 総件数・変更/追加/削除件数・全体ハッシュだけ。本文、個人名、単価、各ドキュメントパスは出しません。
- **重要:** 2つの一覧が完全一致しても、どちらかが途中までの書き出しなら本番DBの全履歴を保証できません。全コレクション・サブコレクションを網羅した正しい基準スナップショットと独立したバックアップが別途必要です。
- 実データのスナップショットは**GitHubに追加・アップロード・コミットしないでください。** ローカルのアクセス制限された保存場所で管理し、必要時のみ比較してください。
- 本番のスナップショット取得方法・無料枠の確認・閲覧権限の確認・元データの復元手順が未確定なら、**本番切り替えは禁止**です。

## 入力フォーマット
これはFirebase標準エクスポート形式ではありません。全ドキュメントを適切な手順で、ドキュメントの完全な値を失わず同形式に変換する必要があります。例は架空データです。

~~~json
{
  "projectId": "sales-management-cc116",
  "documents": [
    {
      "path": "companies/fictional/records/sample-record",
      "value": { "count": 2, "createdAt": {"seconds":1,"nanoseconds":2}, "teamId": "fictional-team" }
    },
    {
      "path": "users/fictional-user",
      "value": { "role": "member" }
    }
  ]
}
~~~

比較（パスはあくまで例）:

~~~bash
node scripts/verify-history-snapshots.mjs /private/before.json /private/after.json
node --test tests/verify-history-snapshots.test.mjs
~~~

`PASS` は**渡された2ファイルだけの一致**。`BLOCK` の場合、当該実績を自動修正したり書き戻したりせず、本番公開作業を中止して原因を点検してください。

## 未実施のまま残す事項
- Firebase `sales-management-cc116` の本番全件読取・バックアップ（本ツールは実行しません）
- 新旧URLそれぞれの実アカウント・iPhone/PCによる閲覧/入力/権限・旧PWAの動作確認
- Firestore Rules変更、Finance Gateway有効化、既存アプリコード差替え、社員へのURL変更案内
