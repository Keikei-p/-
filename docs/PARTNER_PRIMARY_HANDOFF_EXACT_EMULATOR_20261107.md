# 営業実績アプリ：自社→協力店の所属移行と金額GET/LIST遮断 直接連結テスト

**2026-11-07 / 検証専用 / NO DEPLOY**

## 発見と背景

- `main` SHA `9632ea4bc063f165e0197a65f068e6d4529c4410` を確認。
- 本番読取監査 `42365757671` は **兼務アカウントの旧社内金額閲覧経路あり**・未配備Functions4本・実UID拒否未証明・本番バックアップ隔離復元未確認と報告。本番ユーザーを自動的に移行しない。
- `staging/partner-primary-handoff/handoff.cjs` の本物の `buildService().commit()` は、本人による明示同意・認証ID tokenの再検証・両社の所属関係・Owner除外を検査し、**アーカイブ作成 + 元の自社member無効化 + 兼務context無効化 + 現在のuserプロフィールを件数専用に変更**する予定。Auth UID・元の売上/商材/CB/履歴/原票は保存する。
- 従来の `tests/finance-secondary-handoff-raw-access-emulator.test.cjs` は将来の移行状態を模擬したテスト。**実際の `commit()` 結果が直接その権限結果を作るか**についての連結試験が不足していた。

## 今回追加の直接連結試験

`tests/partner-secondary-primary-handoff-staging.test.cjs` に、Emulator起動時限定の試験を追加。

1. 架空の自社・協力店・Owner・兼務社員・4種類の元金額原票をローカルEmulatorへ配置。旧社内Memberの3原票 GET/LIST が許される**本番で懸念される現在の状態**を確認。
2. `buildService().preview()` の書込0件を確認し、本人の明示同意で**実際の `buildService().commit()`** を合成Transactionに実行する。
3. 変更されたドキュメントパスが `users/{uid}`、旧社内 `companies/{hub}/members/{uid}`、`partnerWorkspaceContexts/{uid}`、`partnerHistoricalTransfers/{uid}` の**4件のみ**であることを検証。
4. この4件だけを同じEmulatorに反映。その社員本人の旧社 `products` / `records` / `recordCorrections` / `revenueGoals` GET/LIST がすべて拒否され、自社Owner GETが維持されることを確認。
5. 元4原票のFirestore値が移行前後完全一致、移行アーカイブの元ユーザー・member・context完全保持、外部社員本人からアーカイブをGETできないことを確認。
6. 同一UIDの協力店ワークスペースの件数表示権限が維持されることを確認。旧自社のユーザーデータ・金額は本人から見えなくなるが、会社Ownerの元履歴は保存する。

## 新たな連結確認：同一UIDでの件数保存・訂正・監査履歴

- 真正のSTAGING所属移行 `buildService.commit()` を終え、旧自社の4金融原票の本人GET/LISTが拒否された**同じUID**で、`makeWorkspace.submit()` を実行。
- `partnerWorkEntries` に当日2件を保存し、`partnerWorkCountDays` の集計2件と不変の `partnerWorkAudits` v1を確認。読み取り画面 `makeWorkspace.view()` でも2件を表示。
- 同じ `expectedVersion:0` の再送はabort（重複・上書きなし）。v1から3件に訂正し、集計3件と独立のv2監査履歴を確認。
- 旧自社4金額原票、旧所属アーカイブ、旧会社・協力店スタッフ原票を変更せず、Finance Rules Emulatorへの旧会社GET/LIST拒否と自社Ownerの許可を**保存・訂正後にも**再検証。
- この連結は**デモ用の同一UID**と模擬Transaction + Firestore Emulator。公開URLのログイン・入力保存を実アカウントで検証した証拠にはならない。現行の本番`getPartnerWorkspace`等のFunctions配備・費用も別確認。
- 協力店の元会社全体Quick件数と担当者別保存件数は異なる原票のため、同一契約と確認せず自動合算しない。

## 本番移行前の件数入力停止防止ゲート（今回追加）

- `buildService` が実際の隔離 `makeWorkspace.view()` を同じ認証済みBearer / UIDで呼ぶ `readCountWorkspace` 依存を必須にした。**バックエンドが未配備、機能フラグOFF、閲覧不可、本人のスタッフ行なし、役職/所属班不一致なら、プレビューと移行の両方が書込0で停止。**
- プレビューとコミットの直前に東京日付の当人の個人件数とHub日計集計をトランザクションで再読込。`source=staff-entries-v1` 以外の旧日計、件数スキーマ不正、個人件数より少ない日計、日付・版数の食い違いがあれば旧自社所属を**失効させずに拒否**。
- 入力件数を自動補正したりQuick会社全体原票と個人入力原票を合算しない。所有者の既存売上、単価、CB、元ユーザーと監査履歴の内容は変更しない。
- 既存同意画面は今までどおり本人による明示チェックと二段階プレビューが必要。フラグ・Auth・Functions本番配備が済まない状態から「権限切替しても大丈夫」と推測しない。
- `preview` の `countPathReadOnlyPreflightPassed=true` は**Emulator/該当UIDのその時点の読取が成功した**ことだけを意味し、新規件数保存や継続運用を証明しない。最後は実UIDでの件数1件登録/訂正と4金融GET/LIST拒否、READYバックアップ本体復元が必要。
- このゲートを組み込んだStaging `handoff.cjs` は、本番のFunctionsには登録されておらず、本PRでの本番書き込み・移行は0件。

## 安全境界

- **実際のFirebase Productionへの移行やRules変更ではない。** staged service本体・Functions exports・Hosting・Firestore Rulesのソースは変更しない。
- Emulatorの権限テストに必要な資格情報は匿名の模擬IDだけ。GitHub Actionsにサービスアカウントや本番認証情報を渡さない。
- この試験で判定できないもの：本番3アカウントの実UID認証/金額4原票GET/LIST、旧PWAの全ルート、元原票の単価・件数・売上照合、READYバックアップの実隔離復元、Functions実配備と費用、実機での件数新規保存・訂正。
- 本番の所属移行は一部のユーザーにとって現在の自社権限を**意図的に終了**するため、本人の明示同意が必須であり、独立サインオフなしに本番実行しない。
- 旧Ownerや金額閲覧許可の保持、当日の未送信件数、同じメールの過去自社履歴を壊さないことが公開前提。
- 失敗したテストは修正してから本番可否を検討。CIの緑は公開承認ではない。

## 変更ファイル

- `tests/partner-secondary-primary-handoff-staging.test.cjs`
- `.github/workflows/nico-real-handoff-emulator-only.yml`
- 本書

**既存Auth/Firestore/Hosting/Functions/main/請求・LINE/元の件数/金額/履歴に本番書込0件。**
