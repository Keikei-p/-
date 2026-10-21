# AGENTS.md — 営業実績アプリ / Codex・AI開発作業安全契約

このリポジトリは**会社で本番運用している営業実績管理アプリ**です。Codex・開発AI・人間の作業者は以下を守ってください。

## 保全対象（破損・再計算・削除・一括変更禁止）
- Firebase project: `sales-management-cc116`。別のFirebaseプロジェクトを新設しない。
- Firestore既存ドキュメント: `users`, `companies` と `companies/*/members`, `teams`, `products`, `records`, `recordCorrections`, `goals`, `revenueGoals`, `invitations`, 報告・通知・履歴・その他全件。
- **現在の単価・価格プラン・CB・実績件数・売上・社員情報・Master/Owner/Leader権限・班所属履歴・ランキング原データ**を一切変更しない。
- 既存リポジトリ `Keikei-p/-` の名前変更・削除禁止。両公開URLを維持。
- 本番認証ユーザー削除、本番Firestoreデータ変更、本番バックフィル、本番マイグレーション、データの「修復」と称した再計算は禁止。明示許可があってもバックアップ・全件照合・段階的ロールバックのない操作は禁止。

## 双方の本番URL
- 会社名義: https://nico-factory.web.app/
- 旧アドレス: https://keikei-p.github.io/-/
- **両URLは同じFirestoreと認証を使う。** 片方だけ先行して互換性を壊さない。GitHub Pagesの旧URLは維持する。
- Firestore Rulesを先に厳しくすると旧ブラウザ／旧PWAキャッシュの実績入力が止まる。金額付きコレクションの直接読取を拒否する前に、**新旧URL双方で新しい安全な読込・入力・更新に移行できたこと**を証明する。
- 「旧URLを残す」と「旧バージョンのブラウザコードが永久にそのまま動く」は別。旧バージョンは期限を設け、切替時に安全更新の案内をする。

## 権限の不変条件
- Master/Owner: 売上・商材単価の閲覧可能、部下の閲覧許可切替を継続。
- 既に明示許可 `canViewRevenue===true` の社員・Leader: 対象の班・期間内で引き続き売上閲覧可能。
- 商材単価は売上とは別の明示許可 `canViewUnitPrice===true` が必要。
- 新規招待・許可未設定の一般社員／Leader: 売上も単価も初期非表示。
- 表示マスクは安全対策として不十分。**Firestoreの金額付きドキュメントへの生データ読取を未許可者に拒否**する。
- CB金額・商品名中の金額・修正履歴・結果キー・ランキングを含む間接漏洩も検証する。

## 開発・Codex運用ルール
1. 必ず `feature/`, `fix/`, `safety/` 等の**別ブランチ**で作業。いきなり`main`を編集しない。
2. PRを作り、実装・リスク・変更したファイル・実施したテスト・未確認事項を記載。必須テストが失敗したらマージ不可。
3. セキュリティ移行PRはDraftで開始。**テストだけで本番切替を許可しない。**
4. 既存動作と公開URLを保護し、変更は最小限。作業前後に対象ファイルの差分を点検。
5. 本番Firebase CLIやCloudflareの書き込み・デプロイを実行しない。**ユーザーの本番切替承認と手動作業ゲートが必要。**
6. `FIREBASE_SERVICE_ACCOUNT_JSON` 等の秘密鍵はコード・ログ・PRに絶対に出さない。資格情報をCodexの作業文脈にも貼り付けない。
7. 読取テストでも本番個人情報・単価・売上のログ出力禁止。検証は原則FireStoreエミュレータの匿名サンプルで行う。
8. Cloudflare WorkerのFinance Gatewayは初期状態を **disabled**。価格付きドキュメントをクライアントへ返すAPIは明示許可だけ。
9. 将来の金額保護実装は `docs/SALES_SAFE_CUTOVER.md` の手順に従い、書込競合・旧PWA・両URL・権限をテスト。
10. 分からない点は推測で変更しない。必要な実データの写しは持ち出さない。検証できない場合は本番作業を停止。

## 必須チェック（本番変更前）
- `node --test tests/sales-regressions.cjs`
- `firebase emulators:exec --project demo-sales-support --only firestore "node --test tests/rules.test.cjs"`
- Finance開発は `node --test cloudflare-finance/tests/*.test.mjs` と finance-locked Rules エミュレータ
- Firestore正本の件数・価格・売上・ドキュメントID・履歴の**変更前後完全一致**を検証。できない場合は中止。
- 新旧URLを匿名HTTP GETと役割別のログイン・入力テストで検証。本番書込テスト禁止。
- 自動デプロイの有無を変更前に確認。Rulesは明示確認の手動操作とする。
