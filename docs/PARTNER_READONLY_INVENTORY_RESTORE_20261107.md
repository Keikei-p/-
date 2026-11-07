# 営業実績アプリ：本番取得・隔離復元・無変更照合の限定実行（2026-11-07）

## 今回の対象
既存 `.github/workflows/nico-one-shot-isolated-restore-verify-20261107.yml` を再検証して、本番への**読取限定**のスナップショット／Emulator復元を実施する候補。GitHub `main` に統合された場合だけ既存のpushゲートで実行される。実行主体はGitHub Actionsのみ、Firestoreの本番文書を更新しない。

- 本番データベース：`sales-management-cc116`（変更しない）
- Emulator：`demo-sales-restore`、localhostのみ。到達先を127.0.0.1かつDemo project IDに固定し、**既存ローカル文書の上書きも拒否**。
- 固定SHA：実行時に本番読取の実装4モジュールをGit Blobハッシュで照合。独立コード変更が入ったら停止。
- 読取上限：**1回の完全走査で実在文書最大10,000件**、2回の前後照合＋管理バックアップのREADY時刻メタデータ検査。上限を超えたら**不完全な結果を合格にせず停止**。10000件を読む2回の走査と子コレクション一覧のAPI呼出しは課金上限の保証ではない。
- 本番用の元コード（Rules/Functions/index.html/Auth/商材/実績/LINE）を更新しない。
- 秘密情報と文書本文はActionsの一時記憶に閉じ込め、個別のID・氏名・料金・CBをログやArtifactへ送らない。成功ログは文書総数・全体指紋と真偽のみ。
- 読取の途中で本番実績が変化したら全件一致照合が失敗する。その場合でも本番のデータは触らない。

## 証明できること
- 本番から直に読んだ有限の完全なRESTドキュメント原票について、IDと値をローカルのDemo Emulatorへ完全復元でき、再走査の値が同じか。
- 現行のFirestore Rulesとレビュー済み候補の固定関係が崩れていないか。
- READY管理バックアップの存在と「直近48時間以内」のスナップショット時刻。

## 証明できないこと／本番の最重要ブロッカー
- **実際のREADY管理バックアップのデータ本体を復元した証明ではない**。管理バックアップは存在メタデータの確認のみ。
- Firestore Auth・Storage・Functionsのリカバリー、作成日時/更新日時そのものの復元はしない。
- 認証実ユーザー3件の旧自社金額GET/LIST拒否、同一メールの正式所属移行、件数入力とOwner訂正継続、追加Functions費用の承認はこの検証では行わない。
- 成功した場合でもFirestore Rules・Functions・Hostingの本番切替権限は付与しない。現行の`main`からのHosting一括デプロイを行わない。

## 本番CIとの整合

- 先行PR #474で、所属移行のEmulator検証を関係するPRの差分がある場合に限定し、古いmain SHAとの誤比較を修正済み。今回のバックアップPRは所属移行コードを変更せず、不要な認証/移行テストで誤停止しない。
- 本番スナップショット走査中に既存の入力が変われば、2回の指紋が一致せずSTOPしても、売上や件数を巻き戻さない。復元検証はローカルのデータ写しのみ。

## 出力の判定
`PARTNER_BOUNDARY_RESULT { ... "applied":false, "managedBackupRestored":false, "fieldsAndIdsRestored":true, "fullInventoryStableBefore":true, "productionDocumentWrites":0 }` だけがこの工程の合格条件。エラーならSTOPした事実のみ報告し、復元済みとは言わない。

**既存売上・単価・CB・件数・履歴を消さない／自動移行しない／本番データ書込ゼロ。**
