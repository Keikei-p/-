# Firestore読み取り専用バックアップ（開発版・本番未実行）

## 重要な区別
- 以前の年次JSONは `records/products/recordCorrections/teams` の4コレクションの営業履歴だけを保存。
- 今回追加した `functions/export-firestore-readonly.mjs` は、Firestoreのルートコレクションと各ドキュメント下のサブコレクションを読み取って収集する**管理者のPC専用CLIの開発版**。会社・スタッフ・設定などを含められるが、**実データでは一度も実行していない**。
- Firebase Authのアカウント、Cloud Storage、Hosting、Security Rules、インデックス、Secretsは収集しない。Firestoreも取得中に更新される可能性があるため、**同一時刻のスナップショットと保証しない**。
- Firestore Admin SDK経由のJS数値では、元のFirestoreの整数型と「小数点のないdouble型」が厳密に区別できない場合がある。**型を完全復元できる検証は未完了**。エクスポートに対して `productionDeletionEligible:false`、`fullTypedRestorationVerified:false` を明記。
- **このJSONが保存できたことを理由に、Firestore原本を削除してはいけない。**

## 使う前の前提条件（現時点では実行しない）
1. オーナーが本当に対象プロジェクトを確認し、全会社のデータを取得する権限があること。1社だけのデータを抽出するものではない。
2. PCの暗号化されたローカルドライブに、未使用のファイル名を用意すること。実顧客データやサービスアカウントの秘密鍵はGitHub/チャットに貼らない。
3. 管理用Firebase資格情報をPCの環境変数 `GOOGLE_APPLICATION_CREDENTIALS` で指定（公開Webに渡さない）。Node 22以上と `functions` のfirebase-admin依存を用意する。
4. Firestoreの無料読み取り枠の消費を確認し、業務への影響がない時間に手動で実施する。10,000件を上限として開始し、上限到達時は**部分成功ではなく失敗**とする。集計対象は実在ドキュメントだけでなく、空の親を持つドキュメント参照も含む。
5. 2媒体の別保存、SHA-256検証、型・ID/件数・売上整合、隔離復元が確認されるまで本番ルールの変更や削除を実行しない。

## 将来、管理者PCだけで実行する場合の例
```powershell
# 実行してよいと承認された場合のみ。プロジェクトIDを必ず確認する。
cd C:\path\to\repository
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\private-service-account.json"
node functions/export-firestore-readonly.mjs `
  --confirm-readonly-project=sales-management-cc116 `
  --acknowledge-read-quotas `
  --max-documents=10000 `
  --output="D:\encrypted-backups\firestore-readonly-2026-10-29.json"
```

- `--output` は存在しない絶対パスだけを受け付ける。ファイルの上書きは拒否。
- 管理用資格情報や原本をログへ出力せず、取得件数・SHA-256・欠落したFirebase領域のみ通知する。
- Firestoreの更新・削除・インポートを行うAPIは呼ばない。
- 保存形式の改ざん・不整合や取得上限超過・取得失敗は処理を停止して、**バックアップ完了とは扱わない**。
- このコマンドには自動スケジュール、Web公開、Cloud Functionsデプロイ設定を追加していない。

## 本番への切替禁止条件
- 実際に書き出した全ドキュメントIDの一覧と読み戻しが検証されていない。
- Firestore以外の会社運用情報とFirebase Authの復旧方法が検証されていない。
- 同じ元データのコピー2本が別媒体に存在することが確認されていない。
- 会社側の財務権限・金額遮断Rulesと、新URL `https://nico-factory.web.app/` の実機動作が検証されていない。

**本開発版に本番データの書込み／削除処理は存在せず、本番データのバックアップ取得も実施していない。**

## 2コピー独立検証（ファイルのみ、Firebaseアクセスなし）

管理者が**同じ保存済みJSON**を2つの別媒体に保管できた場合だけ、以下のオフライン検証を実施する。

```powershell
node scripts/verify-firestore-snapshot-pair.mjs "D:\encrypted-backups\snapshot.json" "E:\encrypted-backups\snapshot.json"
```

- 2ファイルを独立して開き、双方の型/パス/ハッシュ/件数を検査。同一実体ファイルやハードリンクを拒否。
- 別の日に取得した2つの版を、同一バックアップと誤認しない。保存内容が違えば停止する。
- **異なるパスであっても物理媒体が別である保証はない**。SSD/USB等の保存先を人間が確認する。
- チェックのPASSは「バイト・原票形式の整合」を示すだけ。Firebase Auth/Storageや実際の復元に成功したわけではない。**Firestoreの元データは削除禁止**。
