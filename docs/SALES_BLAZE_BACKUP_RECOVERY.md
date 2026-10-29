# 営業実績アプリ｜Blazeプランでの公式バックアップ・復旧手順（2026-10-22）

## 大原則

本番Firebaseプロジェクトは **`sales-management-cc116`**、Firestoreデータベースは **`(default)`**。会社用URL `https://nico-factory.web.app/` と従来URL `https://keikei-p.github.io/-/` は**同じデータベース**を使用する。URLの変更はバックアップにもデータ移行にもならない。

依頼者から2026-10-22に「有料になっている」と報告あり。ただし **Cloud Billing設定とBlazeプランの現在値は管理コンソールで未検証**。この文書とGitHubの更新は**料金発生操作を実施しない**。実データの全件バックアップ・復元確認が未実施なので、未実施を完了扱いしない。

## 優先推奨：Firestore標準のスケジュールバックアップ

Google Cloudの公式「Firestore Backups」機能を利用。**時点整合性のあるデータとインデックス構成**を保持するため、単純なRESTでの巡回コピーより確実性が高い。標準バックアップは**新しいデータベースへの復元**用で、既存の `(default)` を自動上書きしない。

**必ず理解する費用と限界**
- 保存するバックアップ容量×保存日数で費用が継続発生する（Firestore backup storage GB/月相当）。復元するときにも別途費用が発生する。バックアップ保存にはFirestore無料枠は適用されない。
- 設定するだけで日次/週次の自動課金が始まるため、**既存スケジュールの有無、Firestore容量、請求予定額を先に確認**する。
- Google Cloudの予算アラートは**利用停止/支出上限ではない**。閾値超過しても請求が発生する可能性がある。
- Firestore標準バックアップに**Firebase Authenticationユーザー、Firebase Security Rules、TTLポリシー、Storage、Functions、Hosting、LINE/Cloudflare設定は含まれない**。別途の設定・コード保全が必要。
- 復元テストで新しいデータベースを作る場合にも利用料金が発生する。**本番の `(default)` データベースは削除、インポート、上書きしない**。
- ネイティブバックアップは同じデータベースのロケーションに保管される。独立保存先が必要なら別途エクスポートを検討。

### 管理者がスマホまたはPCで確認する手順（実行前の確認）

1. [Google Cloud Console のFirestoreデータベース一覧](https://console.cloud.google.com/firestore/databases?project=sales-management-cc116) を開き、**プロジェクトIDが `sales-management-cc116`**、**DBが `(default)`** であることを確認。
2. データベース一覧の **Scheduled backups / スケジュールバックアップ** → **View backups / Edit settings / バックアップを表示 / 設定を編集** を開き、日次・週次スケジュールが既に存在するか確認する（既存設定を勝手に変更しない）。
3. 容量（Firestoreの保管データサイズ）と [Google Cloud Billingレポート](https://console.cloud.google.com/billing) を確認。バックアップ用の毎月の許容予算を決め、予算アラートを設定（**アラートは請求上限ではない**）。
4. 短期間のロールバックを重視して日次バックアップを選ぶ場合の**設定候補**：Daily（日次）・Retention（保持）`7d`。これは未承認の参考値。**対象容量・費用を確認し、会社で承認した後に初めて［保存］を押す**。
5. 作成後すぐに実際のバックアップがあるとは限らない。バックアップ一覧に**成功済みのバックアップが表示されたこと**、実行時刻・保存サイズ・保持期限を確認する。最初の完了前は「バックアップ完了」と扱わない。
6. 復元可能性の確認が必要なときは**別の新規DB**（本番ではない）に復元し、元の件数、ID、日付、班、商材の単価、権限用ドキュメントの整合性を安全な管理環境で照合する。実稼働DBへの復元・切り替えは**別の承認**とする。
7. 誤消去、誤課金を防ぐため、請求額と保存済みバックアップの有無を月次点検する。**バックアップが実際に作られたことを見ないまま安心しない。**

### 先に確認できる読み取り専用コマンド例（Cloud Shellなど）

管理コンソールにログイン済み・権限がある場合に限り、以下は**設定確認だけ**（作成・削除なし）：

```sh
gcloud config get-value project
gcloud firestore databases list --project=sales-management-cc116
gcloud firestore backups schedules list --database='(default)' --project=sales-management-cc116
```

コマンドの読み取り権限が不足した場合、権限を無理に付けずに管理者へ確認する。**GitHub Actionsで本番サービスアカウントを使ってバックアップを自動開始しない**。

## 第二案：一回限りのマネージドエクスポート

バックアップを別のCloud Storageバケットに保管する必要がある場合のみ検討する。Google Cloud Console → Firestore → Databases → 対象DB → Import/Export → **Export entire database**。

- エクスポート先バケットをDB近隣ロケーションに作成、IAMと非公開設定を確認。**Cloud Storage保存料＋Firestoreエクスポートのドキュメント読み取り料金**がかかる。
- エクスポートは開始時点の完全なスナップショットではなく、実行中に変更されたデータが含まれることがある。
- バケット・費用・アクセス制限を確認する前は、Exportボタンを押さない。
- Cloud Storage保存先をGitHub・公開URL・チャットに貼らない。実績や顧客情報もチャットやCIのログに書かない。
- **Importは本番に対して絶対に実行しない**。隔離環境の復旧手順を先に文書化して費用承認を取る。

## 現行の別ツールとの役割分担

- `tools/readonly-backup/backup.mjs`：**明示的に実行された場合にのみ**Firestoreを読み取ってローカルAES-256-GCM保管。スナップショット整合性の保証はない、認証ユーザーやRulesも含まない。**現時点で本番取得未実施**。
- `scripts/verify-history-snapshots.mjs`：持ち込んだ二つのオフライン全件一覧を比較するだけ。実データをGitHubへ置かない。
- `docs/NICO_URL_SWITCH_RUNBOOK.md`：会社URL移行、権限・実機テスト、GitHub公開監視。
- PR #73：金額保護の開発版。**権限ルール本番切替禁止を継続**。公式バックアップがあっても実機/旧PWA/両URL/金額漏洩テスト完了を省略しない。

## 完了チェック（チェックを付けるまでは作業未完了）

- [ ] Cloud Billing対象・Blazeを管理画面で確認
- [ ] 既存のスケジュールとFirestore容量・バックアップ費用を確認
- [ ] 日次・週次のどちらか、費用と保持日数の会社承認
- [ ] 保護されたバックアップが**成功状態**で実在する
- [ ] 復元先は本番以外に限定し、復元テストと整合性検査に合格
- [ ] 金額漏洩・権限・旧PWA・過去訂正・代理入力の分離テストが完了
- [ ] 新旧URLの業務利用・ログイン・社員移行を実アカウントで確認

参照公式文書：
- https://cloud.google.com/firestore/docs/backups
- https://cloud.google.com/firestore/pricing
- https://firebase.google.com/docs/firestore/manage-data/export-import
- https://firebase.google.com/docs/projects/billing/budget-alerts
