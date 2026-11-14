# NICO FACTORY — 自社Owner協力店訂正・ランキング 本番切替判定

**2026-11-14／統合 Draft PR #704／STAGING・NO DEPLOY／署名未取得**

この文書は確認済みコードとテストの事実を整理した**公開停止記録**です。管理者署名でもデプロイ許可でもありません。

## 実装済み（本番非公開）

- `functions-partner-workspace` の `listHubPartnerCounts`（登録済み件数参照）と `correctHubPartnerCounts`（Owner限定・版番号付き訂正）。`getPartnerWorkspace` など既存の4つの基本Callableを置換しない。
- 書込は `companies/{partner}/partnerWorkEntries`、Hub日別件数 `partnerWorkCountDays`、追記専用 `partnerWorkAudits` の同一トランザクション。自社Owner本人のサーバー検証・承認済み会社関係・旧版拒否・旧光/AIR合算保持・未知の金額フィールドの監査への複製拒否。
- 自社アプリ内の協力店会社カード→担当者訂正画面を接続。保存後の認証済み再読込が成立した時だけランキングキャッシュを破棄する。
- **読取** `NICO_PARTNER_OWNER_CORRECTION_READ_ENABLED`、**書込** `NICO_PARTNER_OWNER_CORRECTION_V3_ENABLED`、**画面訂正** `NICO_SAME_APP_OWNER_CORRECTION_V3_RELEASED` はそれぞれ**初期OFF**。有効にした実績はない。

## 本番API衝突：ソース上は重複なし

`tools/production/inspect-owner-correction-function-inventory.mjs`でGitHub上の**6コードベース**を実検査。Ownerの新規2 Callable名は `partner-workspace` 内で一意。旧 `firebase.partner-workspace.json` をそのまま保ち、名称/地域を推測で変更しない。

ただし**実際の本番Firebase Functions一覧**は未照合。開発リポジトリ内の一意性は本番に未知の同名関数がない証明ではない。

## 既存の手動本番デプロイを流用できない理由

`.github/workflows/nico-partner-private-coordinated-release.yml`は過去審査済みの**4つのCallableのみ**を更新する凍結リリース。新しいOwner List/訂正APIは対象外。また `service.cjs`、`index.js`、`partner-workspace.html` 等の旧SHA固定により、PR #701の新しい内容では意図的に停止する。

このワークフロー、保護ハッシュ、`sales-production-reviewed`の承認、独立した`docs/SALES_RELEASE_SIGNOFF.md`は**勝手に変更・代筆・回避しない**。独立レビュー後、既存Functionsを誤更新しない限定的な新リリース工程を別途承認する。

## 金額遮断：本番公開を止める8つの静的リスク

最新PRの静的本番切替プリフライトに次が残る。

1. `FINANCE_RAW_RULES_ALLOW_PARTNER_OR_UNVERIFIED`（現行Firestore Rulesで原票アクセスを完全に遮断できていない）
2. `DIRECT_BROWSER_FINANCE_COLLECTION_records`
3. `DIRECT_BROWSER_FINANCE_COLLECTION_products`
4. `DIRECT_BROWSER_FINANCE_COLLECTION_recordCorrections`
5. `DIRECT_BROWSER_FINANCE_COLLECTION_revenueGoals`
6. `LEGACY_RECORDS_DIRECT_QUERY`
7. `LEGACY_RECORDS_DIRECT_WRITE`
8. `LEGACY_SECONDARY_OWN_COMPANY_FINANCE_ROUTE`（旧自社画面を選ぶと協力店二重所属のサーバー確認を省略し得る。**遮断候補の本番適用・実UID検証前に公開しない**）

新たな8番は、現行ブラウザの選択分岐から見つかった**潜在的な旧画面経路**で、個人情報漏えい発生の実証ではない。既存の自社・協力店画面切替を勝手に削除せず、同意済み本番の金融Rules拒否と実UIDの画面/GET/LISTの二重確認で閉じる。

上記は既存自社の売上/単価表示や入力を無条件に消してよいという意味ではない。既存Ownerの金額アクセスを残し、協力店・二重所属・停止会社等からの金額原票GET/LIST/書込をサーバー/Rules双方で拒否する。古い端末/PWAの経路も対象。段階的な画面非表示だけでは情報遮断の本番証明にならない。

候補 `security/secondary-finance-read-fence.mjs` は**DEMO Firestore Emulator限定**の生成物で、`firestore.rules` は変更していない。旧自社権限を持つ二重所属者向けの部分対策であり、全協力店役割の本番金額遮断が証明されたわけではない。

## 既存の実Firebase読み取り・隔離復元の証跡（2026-11-12実行、11-14再確認）

過去の「復元が全く未実施」という整理を修正する。実際の[本番読み取り専用Workflow #42036092110](https://github.com/Keikei-p/-/actions/runs/42036092110)では2026-11-12 06:37 UTCにcontrolled/ offline双方が**SUCCESS**。限定GETで本番Firestore **512文書**のスナップショットを取得し、隔離ローカルエミュレータへ復元したこと、文書ID・フィールド一致（`fieldsAndIdsRestored: true`）、元DBの全件指紋が変わらない（`fullInventoryStableBefore: true`）、本番書込0（`productionDocumentWrites: 0`）、Rules未適用（`applied: false`）をログで確認した。ライブRulesは当時レビュー対象のSHA-256 `d1d9998d874a1a31c81ddf6996e08cd9de3a3d13bd684e245140bf03cab32179` と一致した。

**未証明の事項：** 同ログは`metadataTimestampsRestored: false` と `managedBackupRestored: false` を明記。つまり全メタデータ・管理バックアップからの完全復旧を証明していない。512文書は**11月12日時点の件数**で、最新の本番データ件数とは限らない。実UIDの金額GET/LIST拒否や現在のRulesが当時と同一かもこの証跡からは断言できない。リリース直前には最新スナップショット・管理バックアップの独立復旧と、その時点のルール/実アカウント再検証が必要。

### 2026-11-14 金額遮断の再現テスト（安全なオフライン検証）

`tests/secondary-finance-read-fence-emulator.test.mjs` に、**自社の旧所属を残したまま協力店へ二重所属した架空UID**を同一条件で比較する試験を追加。現行の`firestore.rules`が金額原票の読取を許すことと、既存の**未デプロイ**候補`security/secondary-finance-read-fence.mjs`ではGET/LISTを拒否することを対照確認する。[エミュレータ実行 #43556172475](https://github.com/Keikei-p/-/actions/runs/43556172475)の比較テストを含む5件が**全件PASS**。元の自社機能48件も**全件PASS**。既存金額経路の単体回帰67件もPASS。統合4ランキングテスト [#43556172474](https://github.com/Keikei-p/-/actions/runs/43556172474) と[Sales App Validation #43556172434](https://github.com/Keikei-p/-/actions/runs/43556172434)もSUCCESS。候補を本番に反映したとは扱わない。

## 必須のGo/No-Go（未完了）

- [ ] 対象Firebase `sales-management-cc116` にある**実際の**Functions名、リージョン、codebase、ソースSHA、料金上限を読み取り棚卸し。知らない既存関数の上書き/削除は禁止
- [ ] 本番Firestore全件のバックアップと**隔離DBへの復元**を実際に確認。件数・金額・訂正履歴・旧会社明細まで照合。復元先は本番DBではない
- [ ] 協力店の実UIDで `products`/`records`/`recordCorrections`/`revenueGoals` GET/LIST拒否。兼務と直接所属の両方を確認
- [ ] 自社Ownerの過去売上・単価・実績・登録・訂正が現在と同じように成功することを実アカウントで確認。データ削除/初期化はしない
- [ ] 自社＋協力店の当月実データを、公開ON商材・会社・班・個人の各レベルでRead-only照合。旧光/AIRは合算、legacy company-only報告はスタッフへ捏造配賦しない
- [ ] Hub Owner件数訂正v3の同一Staff/同一日トランザクションの競合拒否・旧データ保持・監査を本番前に検証し、個別の書込承認を取得
- [ ] 新規Callableの最小範囲リリース、読取許可→金額遮断確認→書込許可→画面公開の**独立した**切替順序・復旧プランを管理者が署名
- [ ] 最新HEADのSales App Validationと、署名済み本番保護ゲート成功を確認し、公開後にスマホ・自社・協力店双方を実機検証

## 現在の結論

- 静的コードベース重複確認：**PASS（開発リポジトリ内のみ）**
- 一連の保存・Owner訂正・ランキング反映：**オフラインテストPASS**。実Firebaseアカウントでは未確認
- 金額遮断：**DEMO候補の検証のみ**、本番は**未承認**
- 本番Functions/Hosting/Rulesデプロイ：**未実施**、従来機能は維持
- 公開判断：**NO-GO（安全条件・管理者レビュー・実環境証明が未了）**

次の重点は「実UIDの金額GET/LIST拒否と自社Owner既存操作の両立」と「独立復元確認」であり、過去の1文書不一致を先に書き換えない。

## 2026-11-14 統合候補の実測・本番阻害要因（機能追加を止め、完成作業のみ）

**唯一の統合対象:** [Draft PR #704](https://github.com/Keikei-p/-/pull/704) / 候補SHA `74d1475276a77cbad315504ca7d6b3b1bd4a1c31` / 基準main `1f75da8c9fdc7a997089d962b7fa12f974fc70c4`。このSHA以降Codexが更新した場合は最新HEADを検証してから作業する。本書は**実証した内容と未実証内容を分離する判定書**であり、管理者の承認・署名ではない。

### GitHubで合格を確認した工程
- [統合214テスト #43550813824](https://github.com/Keikei-p/-/actions/runs/43550813824): 214/214 PASS（件数保存・訂正・商材ON/OFF・4合同ランキング・未報告/0件・過去月・共通/Functions版のコード一致。オフラインのみ）。
- [Sales App Validation #43550814003](https://github.com/Keikei-p/-/actions/runs/43550814003): SUCCESS。
- [商材ON/OFF・過去件数 #43550814024](https://github.com/Keikei-p/-/actions/runs/43550814024): SUCCESS。
- [Owner訂正・金額遮断エミュレータ #43550814174](https://github.com/Keikei-p/-/actions/runs/43550814174): SUCCESS **ただしDEMOのみ**。本番UID/本番ルールの拒否成功を意味しない。
- [Owner APIソース棚卸し #43550814142](https://github.com/Keikei-p/-/actions/runs/43550814142): 7/7 PASS、6コードベースにおけるOwner callable名衝突なし。**実Firebase上での関数名・リージョン・コードベース棚卸しは未実施。**

### 失敗CIの原因を混同しない
- [本番保護ゲート #43550814092](https://github.com/Keikei-p/-/actions/runs/43550814092): `index.html`変更について維持管理者が付ける `sales-production-reviewed` と、真正な署名入り `docs/SALES_RELEASE_SIGNOFF.md` が不足。**保護を解除・自動代筆してはいけない**。
- [旧版4順位検査 #43550813694](https://github.com/Keikei-p/-/actions/runs/43550813694): 旧 `functions-partner-workspace/index.js` の固定blob SHAと統合版が違うため初期ステップで停止。
- [旧版同一画面検査 #43550814087](https://github.com/Keikei-p/-/actions/runs/43550814087): 旧 `service.cjs` / `index.html` 版を固定した検査で停止。
- [旧版班カード検査 #43550814163](https://github.com/Keikei-p/-/actions/runs/43550814163): 12試験中10件成功、2件は元画面のblobハッシュ固定との不一致。
- [旧Owner訂正独立パッケージ #43550814145](https://github.com/Keikei-p/-/actions/runs/43550814145): 新統合コードが旧凍結パッケージの期待SHAと違い、パッケージ組立安全停止。
- **残る失敗を「全部同じ原因」と決めつけない。** 個別ログを見て、現在の統合スイートで再現する機能障害は最小パッチ＋回帰テストで修正。凍結済み過去release向け条件は維持し、正式な独立レビュー無しに期待SHAを更新しない。

### 現行ファイナンス切替診断が報告した7つのNO-GO＋旧自社画面の迂回経路
[read-onlyソース棚卸し #43550814142](https://github.com/Keikei-p/-/actions/runs/43550814142) に次が出力された。**静的候補診断**であり、実FirebaseセキュリティRulesの結果でもない。
1. `FINANCE_RAW_RULES_ALLOW_PARTNER_OR_UNVERIFIED`
2. `DIRECT_BROWSER_FINANCE_COLLECTION_records`
3. `DIRECT_BROWSER_FINANCE_COLLECTION_products`
4. `DIRECT_BROWSER_FINANCE_COLLECTION_recordCorrections`
5. `DIRECT_BROWSER_FINANCE_COLLECTION_revenueGoals`
6. `LEGACY_RECORDS_DIRECT_QUERY`
7. `LEGACY_RECORDS_DIRECT_WRITE`
8. `LEGACY_SECONDARY_OWN_COMPANY_FINANCE_ROUTE`（旧自社画面を選ぶと協力店二重所属のサーバー確認を省略し得る。**遮断候補の本番適用・実UID検証前に公開しない**）

既存Ownerの実績・売上・単価と旧端末/PWAの入力が稼働しているため、単に金融読取を削除・Rulesを全拒否して解消してはいけない。会社所属、兼務、所属移行、停止権限の**実UIDを使った財務GET/LIST拒否**と、Ownerの現行読み書き成功の両方が必要。

### 公開までの作業を絞る
1. **実Firebaseの読取限定確認**：Functions名/地域/codebase、既存全関数の上書きリスク、料金設定。
2. **バックアップと隔離復元**：全件スナップショット、売上・過去実績・監査・件数の復元照合。
3. **実アカウント認証と金額遮断**：Ownerの正常な金融操作を維持し、協力店/兼務・移行アカウントで4原票のGET/LIST拒否を証明。現行Rulesの解消策はこの結果に基づく最小限の安全修正のみ。
4. **当月の既存件数の読取照合**：会社・班・個人・公開ON商材・旧会社Quick・光/AIR合算を正本と突合し、以前からの1文書差異はユーザー指示どおり別記。
5. **真正なレビュー→段階公開**：管理者が署名した新統合HEADの限定スコープ公開許可、旧4APIを勝手にデプロイしない仕組み、初期OFFと失敗時の停止/復旧、公開後に両社実アカウントで動作・金額遮断を再確認。

機能追加は行わない。**現状の本番判定はNO-GO**であり、署名済み・実UID/隔離復元済みと偽らない。
