# NICO FACTORY — 協力店二重所属の金額遮断・本人移籍 本番公開手順（2026-11-04）

> **状態: 未公開 / Draft PR #355 / NO DEPLOY。** 既存件数・売上・単価・CB・訂正履歴・LINEを変更しない。GitHubのCI成功は本番運用承認ではない。

## 本番読み取り専用監査の確認済み事実
- Firebase: `sales-management-cc116`、既存公開URL: `https://nico-factory.web.app/`（別サイトへの切替は禁止）。
- 2026-11-04 の production READ-ONLY inventory（**旧版の適合判定**）: active secondary context **1**、旧自社金額原票への読取経路が残る非Ownerアカウント **1**、自社Owner二重所属 **0**、旧基準の移籍候補 **1**、過去の移籍履歴 **0**、Firestore READY backup **7**。**2026-11-04後半に候補適合条件を厳格化（名前・有効な班・スタッフ役割・旧Member/Company整合性）したため、「移籍適合1」は現時点の確定値ではない。最新コードをレビュー後に読み取り専用監査を再実行し、そこで0となったら本人移籍を停止して原因を安全に調査する。**
- 公開中の Rules 正規化SHA256: `d1d9998d874a1a31c81ddf6996e08cd9de3a3d13bd684e245140bf03cab32179`（監査日時の値であり、公開当日の再確認必須）。
- 旧 `records` の1文書に `results` 集計と `totalCount` の **1件不一致**。**原因未特定につき修正・再計算・削除・再単価計算は禁止**（Issue #352）。
- Draft PR #355 の NO DEPLOY Actions `41756601979`: 業務回帰156/156、Rules Emulator50/50、計206/206合格。**実UIDと本番のBrowser/Functions連携は未検証**。
- 問題追跡 Issue #206。元自社の金額原票を旧UIDが読める危険は公開中Rulesでは未解決。

## 機能とデータを守る確定契約
1. 金額付き原票 `products`, `records`, `recordCorrections`, `revenueGoals` は、生データを協力店UIDへ返さない。UI非表示だけでなく Firestore `get/list/write` を拒否する。
2. **自社Owner** は従来どおり売上、当時単価、CB、目標、商品編集、履歴を使える。Ownerのdual UIDが判明したら**即停止**。理由: contextを持つUIDの全金額原票を拒否する候補Rulesは、Ownerの金額も見えなくする。
3. 協力店は同じWebアプリから件数とCB内訳・合同ランキング・班詳細を利用。本人による明示的な正式移籍まで自動で現所属を変更しない。
4. 旧自社 `records` 等を一切書き直さない。移籍時に変更してよいのは**当該本人の** `users/{uid}`、`companies/{old}/members/{uid}`、`partnerWorkspaceContexts/{uid}` と、新規のサーバー専用 `partnerHistoricalTransfers/{uid}` だけ。協力店で登録済みの件数原票、班・スタッフ履歴、本人以外の会員は不変更。
5. 旧ユーザー/旧Member/旧Contextの完全スナップショットを同一トランザクションで作成し、失敗したらすべてロールバック。既存archiveがあれば上書きせず拒否。

## 公開の実行ゲート（順序を崩さない）

### 0. 再監査 — 読み取り専用
- 現在の `main`、承認対象コミット、公開中Hosting **実HTML** と本番Functionsの実際の `entryPoint`/`updateTime`/`environmentVariables` を確認。既存 `main` からの全面Hosting上書きや旧URLへの切替は禁止。
- 現行RulesのRuleset名/正規化ハッシュ、READYバックアップの**最新日時**を再確認。Firestore全件を読取専用スナップショットとして取り、ローカルEmulatorに復元してフィールド・ID・件数・財務値の一致を確認（**本番へのrestoreは行わない**）。
- `partnerWorkspaceContexts`、社内Owner、旧会員、協力店メンバーと班、Firebase Authメール認証を再監査。**Owner dual 0、未承認Context 0、対象本人の本人確認**が未達なら停止。
- PR #354の「保存済み件数不整合の自動上書き防止」も独立に確認し、1件差分を機械的に修正しない。

### 1. Rules先行の遮断（公開前に検証）
- Draft #355 `firestore.rules` の候補は、contextが**存在するUID**に対し4種類の金額原票get/list/create/updateを拒否する。contextがinactiveでも拒否し、所有者例外と誤解しない。
- Firestore Emulator で Owner は従来の財務データ読み書きが通ること、1件のsecondary UIDが金額原票4種を読めないことを確認。
- **重要: 既存の通常 `firebase-production-deploy.yml` は静的Finance Gateが停止するため、これを迂回して一括デプロイしない。** 公開ルールの exact Ruleset fingerprint + 細部差分 + 専用の復旧手順を別途レビューしてから、最小Rulesリリースを行う。現時点では未適用。
- Firestore RulesはOR型の複数allowがあり、追加allow get/listの迂回がないことを全パスで検証する。

### 2. Workspace Functionsのバージョンを揃える
- 追加Callable: `transferPartnerSecondaryMembership`（認証済み本人のみ、`preview`はread-only、`confirm`で確認文字列必須）。
- **新規Callableだけのデプロイでは不十分。** 正式移籍後の古いスマホの保存済み会社IDに対するフォールバックと `partnerWorkspaceContexts` tombstone は、`getPartnerWorkspace`、`managePartnerWorkspace`、`submitPartnerWorkspaceCounts` と同じ新版 `service.cjs` を必要とする。招待のOwner二重所属禁止を効かせるため `acceptPartnerWorkspaceInvite` も同じ版へ更新が必要。
- 5関数のみの限定デプロイをレビュー。関係ない既存Functions（元招待/quick counts/LINE）・Firestore Rules・Hostingを**この工程で変更しない**。`PARTNER_WORKSPACE_ENABLED` と既存の `PARTNER_COMPANY_CODE_AUTH_ENABLED` の環境変数値を変えない。
- 既存 `.github/workflows/nico-partner-workspace-release.yml` は「元の4関数が全てLIVEなら再利用」と判定するため**今回の更新をしない可能性がある**。その旧Workflowを流用せず、レビュー済み正確な5関数名だけ更新し実体を readback する安全な経路を別途用意する。
- Firebase Functionsのビルド/Artifact Registryの費用や削除ポリシー、既存関数の `updateTime` 変化を確認。古いFunctionsの削除・画像削除・請求増加を伴う操作は承認なしに実行しない。

### 3. 同じ本番アプリのUIを限定更新する
- 現行公開 `index.html` と PR #355 の `index.html` 差分を照合し、**現行本番で運用中の変更を巻き戻さない**。`index.html` を旧mainからそのまま上書きしない。
- 既存招待の承諾時は明示的な移籍確認を表示。すでに二重所属の本人だけにアカウント設定の `preview`・確認・`confirm` を表示。ログインや画面再表示で自動移籍しない。
- 自社Ownerの売上、商材、当時単価、既存実績入力と、協力店の件数・2列・CB別・合同ランキング・班詳細を回帰確認。

### 4. 実ユーザーの本人操作とE2E（本人の承諾まで本番所属不変更）
- 対象本人が協力店でログイン→最新の件数と班詳細を確認→本人が「正式移籍」に同意→成功レスポンスだけでなくサーバーの所属を読み取り確認→スマホで再ログイン→件数閲覧・修正→本社ランキング/班詳細の件数反映を確認。
- 金額原票の旧自社アクセス拒否（get **と** list）を対象実UIDで確認。自社Owner実UIDは売上・単価・履歴の閲覧が維持されることを別に確認。実UIDで未検証なら「絶対に見えない」と報告しない。
- 現場で実際に使う担当者の同意なしに所属移行、テスト件数追加、パスワードリセットをしない。

### 5. 公開後の保全照合
- 事前事後の `products`・`records`・`recordCorrections`・`revenueGoals` の全件フィンガープリントが一致（通常運用による正当な新規実績入力があれば対象と原因を分離）。
- 協力店の日別 ledger / 件数 / CB別 / audit履歴が消えていない。既存の1件不整合は未変更。
- `activeSecondaryContexts` が対象1件から0になり `partnerHistoricalTransfers` が1件増え、`OwnerConflicts` は0維持。ただし他ユーザーの新規参加による変動は個別再判定。
- 既存 Functions、LINE自動報告、Hosting、招待メール再送を含めてチェック。Rollback は最後に検証したRuleset/Functions/Hostingの各版を使用し、旧データや原票の初期化・復元上書きはしない。

## 現時点の判断
**本番公開は未承認**。過去のread-only在庫とEmulatorの成功だけでは、実アカウントの財務遮断・スマホ再ログイン・公開されたHTML/Functionsの完全な動作までは証明できない。現行本番の個人情報・売上は公開ログへ出さない。Issue #206/PR #355/PR #354に照らし、確認できた工程だけ完了とする。
