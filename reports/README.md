# 朝・夜・未報告 LINE自動報告 — クラウド試験仕様

## 概要
従来の通知設定 `companies/{companyId}/settings/notifications` にある**ひとつの `enabled`** を、朝・夜・未報告の自動送信共通ON/OFFとして利用する。新しいチェックボックスや権限フラグは追加しない。

送信対象になる条件は、会社が有効、`enabled: true`、`lineEnabled: true`、連携済み `lineGroupId`、設定曜日に該当する場合に限定。現時点で本番のCloud Functionsは動作しておらず、旧通知設定だけではLINE送信は成立しない。

| 日本時間 | 種類 | 文面 |
|---|---|---|
| 09:00 | 朝礼 | 班別月間目標件数・月間累計獲得件数 |
| 19:00 | 最終報告 | 班別月間目標件数・月間累計獲得件数 |
| 19:05 | 未報告確認 | 未報告班の名前だけ。件数・金額は送信しない |

**売上額、単価、CB、商品別売上をLINEへ送信しない。**
`@All` はテキストでありLINEの正式なメンション通知ではない。

## 作成したもの
- `reports/format.mjs`: 件数専用の朝礼・最終・未報告文面
- `reports/worker.mjs`: Cloudflare Cron、Firestore REST取得、LINE Messaging API Push、送信重複防止
- `wrangler.sales-reports.toml`: 3つの固定Cron（UTCの00:00/10:00/10:05）
- `tests/report-format.test.mjs`: 件数だけであること、未報告抽出を検証
- `index.html`: 既存の通知設定ON/OFFを朝夜未報告の共通スイッチとして表示

## 本番反映前の準備
1. LINE公式アカウントのMessaging APIを有効化。対象グループにBotを追加。Webhookで連携済みグループIDを確認する。
2. Firebaseで専用のサーバー用サービスアカウントを作る。GitHubや公開Web画面にはJSON秘密鍵を置かない。Cloudflare Workersの暗号化Secretsを使う。
3. Firestore複合インデックス `records(companyId ASC, date ASC)` を有効化する（売上アーカイブPR #104の定義を参照）。
4. `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --config wrangler.sales-reports.toml` と `npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config wrangler.sales-reports.toml` を実施。FirebaseプロジェクトIDも確認する。
5. `REPORT_DELIVERY_ENABLED = "false"` のまま、ステージング環境でCloudflare Workersへデプロイし、Cron実行ログで件数の整合性・通信回数・エラーを検証。
6. ownerのLINE接続先と曜日、通知ON/OFFを確認し、許可されたテストグループに対してのみ実送信テスト。
7. 「レコードの保存値 vs 集計値」「二重送信」「未報告ゼロ」「0件報告」「月替わり」「日付/曜日」をテストした後に、`REPORT_DELIVERY_ENABLED = "true"` を承認のうえ切り替える。

## 注意
- このPRは**未デプロイ・送信OFFが初期値**。実LINE通知はまだ稼働していない。
- 同一会社・同日・同種類の送信予約を一つのドキュメントで管理し、繰り返し送信を防止する。予約後に障害が起きた場合は安全側で自動再送を止め、`notificationDispatches` の失敗を監視して手動復旧する。完全な「必ず1回」の保証ではない。
- 時刻は現段階では固定。既存の `notificationTimeInput` の時間設定は旧未報告リマインド向けで、新しい固定Cronの時間は変更しない。
- 実績データ全量ではなく該当月、未報告の場合は当日のみクエリする。会社数の増加に応じてFirebase/Workers/LINE無料枠の読み取り回数を監視する。
- 並走中のFirebase Functions版のスケジュールを後で起動する場合、重複通知しないよう送信責務を統一する。
- Cloudflare Workerは特権のあるサービスアカウントを使用する。最小権限・秘密鍵のローテーション・ログの秘密情報マスキングを徹底する。

## ローカル検証
```bash
node --test tests/report-format.test.mjs
node --check reports/worker.mjs
```


## 自社＋協力店の一括報告（2026-10-29追加、現在は開発版のみ）

\`reports/combine.mjs\` と \`reports/worker.mjs\` では、次の2形態をどちらも**朝9:00・夜19:00に1通のLINEへまとめる**。

1. **自社と同じ会社にある協力店班**: 自社会社の \`notifications.partnerTeamIds\` に登録された班IDだけを「協力店」欄へ分類。それ以外は自社欄へ載せる。商材別売上・単価・CBは集計文に含めない。
2. **別会社として登録された協力店**: 受け取り側（自社）の \`notifications.aggregatePartnerReports === true\` と \`linkedCompanyIds\` 明示許可、協力店側の \`linkedHubCompanyId\`・\`countsShareApproved === true\`・\`countsShareLineGroupId === 自社lineGroupId\` の**双方の意思表示**がある場合だけ、協力店を集約する。曜日も双方の通知設定で許可が必要。どちらかが同意を取り消したら集約送信を止める。条件不足の場合、途中までの「合計」を誤って送らない。

### 通知設定に必要な追加フィールド（新しい本番設定ではない）

自社オーナーが管理する \`companies/自社ID/settings/notifications\` に、既存の通知フィールドはすべて残したまま次を追加する設計。

\`\`\`json
{
  "aggregatePartnerReports": true,
  "linkedCompanyIds": ["partner-company-id"],
  "partnerTeamIds": ["existing-partner-team-id"]
}
\`\`\`

協力店の**その会社のオーナー**が管理する \`companies/協力店ID/settings/notifications\` に追加する設計。

\`\`\`json
{
  "linkedHubCompanyId": "own-company-id",
  "countsShareApproved": true,
  "countsShareLineGroupId": "own-company-line-group-id"
}
\`\`\`

**重要**: 開発版PR #107にはオーナー専用の設定画面と、`reports/report-sharing-rules.mjs` による対応Security Rules候補を追加し、Firestoreエミュレータでオーナー以外の変更拒否を確認しました。ただし、**現在公開されている本番のアプリとFirestore Rulesは未変更**です。追加フィールドはまだ本番では通常保存できません。バックアップ・復元・権限・旧新URLの検証を終えるまで、Firebaseコンソールで直接書き込んだり、本番Rulesを手動で切り替えたりしないでください。

### 送信例（件数のみ）

\`\`\`text
@All
🌸本日最終報告🌸
📅 2026-10-29

🏢自社
⭐️1班
🎯目標：10件
✅現在：5件

🤝協力店
【自社登録の協力店】
⭐️2班
🎯目標：8件
✅現在：3件

【協力店A】
⭐️1班
🎯目標：12件
✅現在：7件

📊合計目標：30件
📊合計実績：15件
\`\`\`

未報告通知は未報告の班だけ。アプリの通知 ON/OFF は今までと同じひとつの設定を使う。LIVE送信は \`REPORT_DELIVERY_ENABLED = "false"\` が初期値のまま。

### 本番安全条件

- 同じ会社にいる協力店リーダーは **\`accessKind=partner\` の両方の所属データ**が確認されることを必須にし、売上許可や単価許可の値が誤ってtrueでも金融情報を返さないサーバー設計（PR #105）。ただし、**本番の \`records/products/recordCorrections\` の原票閲覧Rulesは依然として同社会員による読み取りを許しているため、現段階で「完全非公開」を保証しない**。
- 会社をまたいだ件数共有は、単にリーダー権限を与えただけでは許可しない。双方のowner承認とLINE送信先の一致確認を必須にする。
- 実績登録・訂正・班変更の履歴を改変せずに、件数だけを合算。目標や件数の異常・漏れがあれば送信停止。**勝手に0件へ修正しない**。
- 送信元は今は開発版。LINEの資格情報・実グループ・本番会員・新旧URLの端末で検証完了するまで**本番デプロイ・実LINE送信は禁止**。既存のバックアップも削除しない。
- クラウドの無料枠は上限があるため、会社数・班数に応じてFireStore読取とLINE Push量を運用前に評価する。


## 最新の開発版テスト
- `tests/report-combine.test.mjs`: 自社・協力店の目標/件数をまとめ、金額を除外、同意が無い場合は停止。
- `tests/report-worker.integration.test.mjs`: 合成Firestore＋LINEで**本当に1通だけ送られる**ことを検証。送信OFFのときはLINE送信・Firestore予約書込ゼロ。
- `tests/report-sharing-ui.test.mjs`: オーナー専用設定画面と既存通知設定の保持。
- `tests/report-sharing-rules.test.mjs`: ステージング用Firestore Rulesでオーナーの保存・取り消しを許可し、一般社員・協力店リーダー・他社からの変更を拒否。実本番ルールには未適用。

## 2026-10-29 追加：無料枠・誤集計保護（Draftのまま）
- `REPORT_DELIVERY_ENABLED="false"` かつ `REPORT_DRY_RUN_VALIDATE="false"` では、Cronが起動しても**サービスアカウント認証／Firestoreクエリ／LINE送信／送信予約を一切しない**。初期設定では無料読み取り枠を消費しない。
- 検証したい場合のみ `REPORT_DRY_RUN_VALIDATE="true"` を一時設定する。その場合はFirestoreの**読み取りを行う**が、`REPORT_DELIVERY_ENABLED="false"` ならLINE送信や予約書込みはしない。無料枠を確認し、検証後はOFFに戻す。
- 取得した実績について、会社ID・対象日または対象月・所属班・実績IDの重複・保存件数と商材別件数が一致するか検査し、異常があれば**全送信を抑止**する。目標が他社・別月または同じ班で重複していた場合も送信を止める。
- `tests/report-worker.integration.test.mjs` で偽のFirestore応答に別会社・別月・重複・件数不正を注入し、LINE送信・予約ゼロを確認する。
- 設定変更・本番Cloudflare配備・Firestoreの実データ変更・LINE実送信は行っていない。
