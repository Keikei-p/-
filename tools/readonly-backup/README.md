# 営業実績アプリ｜本番に一切書き込まない暗号化ローカルバックアップ（開発版）

**対象:** Firebase `sales-management-cc116`。本ツールの実行は作業者のWindows PCなど**ローカル環境だけ**で、明示したときのみです。

## 何をするか / しないか
- Firestore REST APIの**ドキュメント一覧（GET）**と**コレクションID列挙（read-only POST）**だけを使います。POSTでもデータの変更はしません。
- ドキュメントID、下位コレクション、親ドキュメントが存在しない下位データも巡回。Firestore RESTの**型付きの元フィールド**を保持（整数文字列・日付・参照・バイナリ）。
- AES-256-GCMで暗号化したファイルをPCの指定先にだけ生成し、その場で復号検証します。**平文JSON、パス、顧客情報、売上額、価格等をCI・GitHub・ログへ絶対に出しません。**
- Firestoreへの書き込み・削除・インポート・マネージドエクスポート、Security Rules、認証情報、Hosting、Worker、請求設定、既存アプリコードは**実行・変更しません**。Firestoreのドキュメント読み取りだけを行います。
- 保存済みファイルの上書き、リポジトリ内保存、別Firebaseプロジェクトへの接続、バックアップ件数上限超過は停止します。
- 既存Firebaseデータを実際に読める認証情報がこちらにないため、**2026-10-22時点では本番バックアップを実行していません**。

## 暗号化済みバックアップの件数・内容をオフライン点検（0円・書込みなし）

本ツールで既に作成した `.salesbak` ファイルがある場合、PC上で復号して、原本データの内容を書き換えずに、**件数の内訳と全件のID/内容ハッシュ**を確認できます。実行中にFirestoreの読取料金・通信・APIアクセスは発生しません。

~~~powershell
# すでにローカルに保管した暗号化バックアップ用のパスフレーズを設定
$secure = Read-Host "バックアップの暗号化パスフレーズ" -AsSecureString
$env:SALES_BACKUP_PASSPHRASE = (New-Object System.Net.NetworkCredential("", $secure)).Password

# records・products・users・membersなどの件数と照合ハッシュだけを表示
node tools/readonly-backup/backup.mjs audit --file "C:\PRIVATE\sales-backup.salesbak"

# 二つの保管ファイルが完全に同じ状態かを照合
node tools/readonly-backup/backup.mjs compare --before "C:\PRIVATE\before.salesbak" --after "C:\PRIVATE\after.salesbak"

Remove-Item Env:SALES_BACKUP_PASSPHRASE
~~~

- 画面に個別レコードID、氏名、単価、売上金額や顧客データを出力しません。
- `records` は文書の数であり、**商材の契約件数（`totalCount` や各商材数量の合計）と同義ではありません**。契約件数の正確性には現行アプリの集計結果との別途照合が必要です。
- 完全一致は**指定された2つのファイルが一致したこと**のみを意味します。稼働中に正当な営業入力があれば別時刻のバックアップが不一致になるのは正常です。
- Firebase Authentication・Cloud Functions・Cloudflare・Storageの設定は含みません。
- **実データの最新READYバックアップ確認、全データを読み出せたこと、同一時点の整合性、隔離復元の成功を証明するものではありません**。これらの条件なしにFirestore Rules変更やSpark移行の本番切替はしません。

## 重要な限界
1. これは暗号化した**読み取り用保管コピー**であり、Firebase公式の復元可能なマネージドバックアップと同じものではありません。自動復元は実装していません。
2. データはページ順に読みます。更新が続く運用中は**厳密な同一時刻のスナップショットではありません**。更新の少ない時間帯に実施し、前後の照合、復元テストは別途必要です。
3. 読み取りはFirestoreの利用枠を消費する可能性があります。既存アプリの利用と合算した一日の上限を超えれば、課金プラン次第で費用や失敗が発生します。デフォルトは最大10,000件、上限超過で停止（それまでの読み取りは発生）。**現在のプラン・残り無料枠が分からないときは本番実行しないでください。**
4. 本ツールは**1つの(default) Firestoreデータベース**のドキュメントを対象とし、Firebase Authenticationのユーザー・Storage・Cloud Functions・Cloudflareの設定、GitHubリポジトリ、Firestoreセキュリティルール自体は含みません。復元計画ではそれらを別に扱ってください。
5. 暗号化パスフレーズを紛失するとファイルの復号はできません。秘密情報はチャットやGitHubに貼らないでください。
6. Google Cloudの**Firestore Viewer相当の読み取り専用IAM資格情報**を別途用意してください。本番書込み権限の広い鍵を転用しないでください。

## 操作手順（ローカルWindows PowerShell）
**管理者がFirebase利用枠・適切な閲覧権限・バックアップ保存先を確認した後のみ。**

~~~powershell
# 初回のみ（Node.js 22以上）
npm install --prefix tools/readonly-backup --ignore-scripts
node --test tools/readonly-backup/backup.test.mjs

# 読み取り専用の専用資格情報ファイルを、GitHub外の保護された場所に保存
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\PRIVATE\firestore-viewer.json"
$secure = Read-Host "暗号化パスフレーズ（20文字以上）" -AsSecureString
$env:SALES_BACKUP_PASSPHRASE = (New-Object System.Net.NetworkCredential("", $secure)).Password

# 既存ファイルと重複しない名前・リポジトリ外の保存先
node tools/readonly-backup/backup.mjs backup --project sales-management-cc116 --confirm READ_ONLY_LOCAL_BACKUP --max-documents 10000 --out "C:\PRIVATE\sales-backup-20261022.salesbak"

# 改変されていないか、後からオフライン検査可能（復号データを画面に出さない）
node tools/readonly-backup/backup.mjs verify --file "C:\PRIVATE\sales-backup-20261022.salesbak"

# 検証が終わったら、シェル内に保持した秘密情報を消す
Remove-Item Env:SALES_BACKUP_PASSPHRASE
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS
~~~

別の時点と同じ内容か比べる場合のみ：

~~~powershell
node tools/readonly-backup/backup.mjs compare --before "C:\PRIVATE\before.salesbak" --after "C:\PRIVATE\after.salesbak"
~~~

比較で不一致でも**差分を勝手に本番へ書き戻さないこと**。営業活動で正当に増えた実績も不一致になるので、同期間・同条件の差分判断が必要です。

## セキュリティ切替の停止条件
- 復元手順/独立バックアップを試していない
- 権限別の旧新URL実機テストが済んでいない
- 売上・単価・班の差分を承認していない
- 現行端末の旧PWAが安全版で使えると証明していない
- 無料枠・請求設定を確認できない

どれかひとつでも残っていれば、**PR #73はDraftのまま、Rules切替・Gateway有効化・mainへのマージは禁止**。

公式参考:
- https://firebase.google.com/docs/firestore/manage-data/export-import
- https://firebase.google.com/docs/firestore/pricing
- https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/listDocuments
