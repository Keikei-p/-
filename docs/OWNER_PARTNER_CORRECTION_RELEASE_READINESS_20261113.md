# NICO FACTORY — 自社Owner協力店訂正・ランキング 本番切替判定

**2026-11-13／開発ブランチ PR #701／STAGING・NO DEPLOY／署名未取得**

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

## 金額遮断：本番公開を止める7つの静的リスク

最新PRの静的本番切替プリフライトに次が残る。

1. `FINANCE_RAW_RULES_ALLOW_PARTNER_OR_UNVERIFIED`（現行Firestore Rulesで原票アクセスを完全に遮断できていない）
2. `DIRECT_BROWSER_FINANCE_COLLECTION_records`
3. `DIRECT_BROWSER_FINANCE_COLLECTION_products`
4. `DIRECT_BROWSER_FINANCE_COLLECTION_recordCorrections`
5. `DIRECT_BROWSER_FINANCE_COLLECTION_revenueGoals`
6. `LEGACY_RECORDS_DIRECT_QUERY`
7. `LEGACY_RECORDS_DIRECT_WRITE`

上記は既存自社の売上/単価表示や入力を無条件に消してよいという意味ではない。既存Ownerの金額アクセスを残し、協力店・二重所属・停止会社等からの金額原票GET/LIST/書込をサーバー/Rules双方で拒否する。古い端末/PWAの経路も対象。段階的な画面非表示だけでは情報遮断の本番証明にならない。

候補 `security/secondary-finance-read-fence.mjs` は**DEMO Firestore Emulator限定**の生成物で、`firestore.rules` は変更していない。旧自社権限を持つ二重所属者向けの部分対策であり、全協力店役割の本番金額遮断が証明されたわけではない。

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
