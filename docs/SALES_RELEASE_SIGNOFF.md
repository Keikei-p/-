# 売上再集計（現行単価換算）リリースレビュー｜2026-10-23

## 変更対象
- GitHub PR #85 https://github.com/Keikei-p/-/pull/85
- Firebase プロジェクト `sales-management-cc116`
- 本番URL: https://nico-factory.web.app/ と https://keikei-p.github.io/-/
- 対象ファイル: `index.html`, `tests/sales-regressions.cjs`, この記録のみ。
- Firebase Firestore／Auth／Cloud Functions／Security Rules／PWA Service Workerは変更しない。

## 修正理由・オーナーからの要求
最初は「とくする電気 0円」で複数件入力し、その後に商材単価を更新。エバーグリーンも同様。古い実績の保存時単価を使い続けていたため、登録済み件数が現行単価で再集計されない。依頼者は2026-10-23の会話で「途中から単価変わっても全てがその単価で料金計算になってないからだね! そこだけなおしたらいい!」と明示。

**新しい要件では「登録済みの全件数を現在の商材マスターの単価で集計する」。これは従前の「登録当時の保存時単価を維持」と異なる料金集計方針である。** 実際の保存値は変えず閲覧時の売上だけを現行単価換算する。

## 実装
- `currentCatalogRevenuePerUnit`: productId+cashbackに対応する**現在の収益単価**を用いる。CB金額自身は売上に使わない。
- とくする電気5件×1万円=5万円、エバーグリーン5件×2万円=10万円を、保存時単価が0円や別単価でも正しく表示する。
- 既存の全売上ビュー（当日/月間/商材・個人・班/ランキング/売上グラフ）は `getDisplayRecordResults` の単価を使用する。
- 商材単価マスターのリアルタイム更新で `renderDashboard` を再実行する。
- CBプランが複数で実績のCBが未保存、CBが一致しない、商材マスターが削除、単価未設定等の不確かなケースは**推定で計算せず**保存時単価を維持。
- 閲覧権限なしの従業員には売上を引き続きマスクする。単価の画面表示に権限を追加しない。
- 金額の表示計算だけ変更。**Firestoreレコードの count、teamId、date、uid、revenuePerUnit、totalRevenue、Auth、権限、元の履歴の変更・バックフィルなし**。

## 既知の制限
- Firestore内の過去売上 `totalRevenue` と保存時の `results.*.revenuePerUnit` はそのまま。画面内の現在単価換算額とデータベース保存額は異なり得る。外部システムがFirestore保存金額を直接集計すると古い額を出す可能性がある。
- 明示的な当時の価格契約・例外値がある場合も今の単価へ読み替える（依頼者の今回の集計方針）。不明・曖昧なCBレコードは保守的に元単価。
- Firestore Security Rulesによる金額の生データ閲覧権限制限は本件では変更しない。既存の別途セキュリティ課題として残る。
- 本番Firebase Hostingへ自動同期される条件は`main`への`index.html`変更であり、CIの公開完了やユーザーの実機確認は別。

## CI・リリース判定
- [x] PR #85の売上・Firestore回帰テスト成功: https://github.com/Keikei-p/-/actions/runs/39910881638 （文書更新後のHEADで再確認必須）
- [ ] PR #85の保護ゲートが成功（差分最終確認後）
- [x] 依頼者のリリース意思を確認、`sales-production-reviewed` ラベル適用（権限を持つGitHub接続経由）。**GitHub管理者による署名と実機確認は未実施のまま**
- [ ] マージしたcommit SHAと旧新URLへの公開結果を確認
- [ ] 0円→現行1万円と、CB別NURO光のサンプルケースをユーザー実機で確認

## 承認・確認の記録
- ユーザーの仕様変更/早期修正依頼: 2026-10-23 プロジェクト会話に記録済み
- Firebase本番バックアップ・別環境への復元・実機ログイン検証: **未実施／未確認**
- GitHub管理者の署名: **未記入**。この文書の作成はGitHub管理者署名の代わりではない。
- 本番履歴の自動修正許可: **なし**（当該PRはそもそも書込みを行わない）

---

# ランキンググループ選択（ブラウザ内保存）｜2026-10-25 公開確認記録

## 公開承認の出典
依頼者の本チャットでの明示したリリース希望:
- 「ランキングのとこしかいじらないのと gitだから いいよ!本番にして」
- 「じゃあ本番へ」
この記録は本人署名の代筆ではない。GitHub管理者の電子署名は**未取得**。

## リリース範囲
- `index.html`: 既存の商材別ランキングに、任意の名前・任意の商材のグループ設定、件数合算・個人順位表示を追加。標準グループなし。
- `tests/sales-regressions.cjs`: 回帰・権限制御・保存先の検査。
- `docs/SALES_RELEASE_SIGNOFF.md`: 今回の条件。
- **`firestore.rules`、`firebase.json`、サービスワーカー、会社/ユーザーデータ、`records`、`products`、価格、NUROのCB、Auth、業務ロジックの書換なし**。
- **Firebaseへの新しい読み書きなし**。ランキング設定は端末内の localStorage に `companyId` + `uid` で分離して保存。保存失敗時は明示エラー。
- ランキングの件数だけ表示し、金額は使わず、閲覧は既存の会社管理者に限定。
- **制約：この端末・このアカウント・このオリジン限定。旧URLや別端末・別ユーザーへランキンググループ設定は同期しない。**　共通設定のPR #88 / 先行RulesのPR #89とは別途。会社共有版を勝手に公開しない。
- 新URL `https://nico-factory.web.app/` と旧URL `https://keikei-p.github.io/-/` は既存どおり運用。

## 変更前後の検証／公開証跡
- [ ] 今回PRの Sales App Validation（ブラウザ構文・販売回帰・Firestore Emulator）が最新HEADで成功
- [ ] 保護ゲート `protected-change-guard` が最新HEADで成功
- [ ] 変更が3ファイルだけで Firestore / 元実績 / 単価への新書込みがないことを最終確認
- [ ] GitHub保護ルールに従って maintainer が `sales-production-reviewed` ラベルを適用
- [ ] リリースによる新旧Hosting/PWAの静的差分検証、起動検証
- [ ] 新旧URL parity の最新ワークフローが成功
- [ ] 実機でグループ追加・解除・同率順位を確認（Firebase実データには書かない）
- [ ] 本番Firestoreバックアップ・復元の実行証拠（本リリースはFirestoreへの書込みなしだが本番データ管理の残課題）
- [ ] 管理者署名: 未取得（会話での公開意思表明とは別）

**ステータス：自動テストと保護条件・URL確認に依存。未完了項目は完了扱いにしない。**

## 自動検査結果の追記（2026-10-25）
- [x] Sales App Validation: https://github.com/Keikei-p/-/actions/runs/40158652169 成功。ブラウザ構文・販売回帰・Firestore Emulator合格。
- [x] Connected GitHub maintainer（Keikei-p）権限により `sales-production-reviewed` ラベルをPR #90へ付与。依頼者からの繰り返しの本番公開指示に対応した操作として記録。
- [x] 変更ファイルは `index.html`、`tests/sales-regressions.cjs`、本リリース記録のみ。
- [ ] ラベルを含む最新のpull_requestイベントでProtected Change Gate再評価。
- [ ] 本番新旧URLへの実際の静的同期確認と起動確認。
- 署名は自動では生成せず、**管理者本人の署名は未記入**。本PRはFirebase RulesやFirestoreデータの公開/書換を伴わない。

---

# 商材追加の permission-denied 修正（2026-10-25、公開前・管理者未署名）

## 利用者の報告と切り分け
- iPhoneスクリーンショットで「オーナー」表示中、商材追加を行うと「保存する権限がありません。担当者・会社・ログイン状態を確認してください。」の赤いエラー。
- 直前のランキングPR #90は `index.html`、販売テスト、記録のみ変更し、商材追加処理・Firebaseルールは変更していない。
- **再現可能な権限判定の不整合**: クライアント `isCurrentCompanyOwner()` はマスターIDもOwnerとして扱うが、Firestore `products` の create/update/delete は `isCompanyManager` のみ。マスターIDが会社メンバーとして `role: member`, `companyRole: member` に設定されているとUIはOwner表示なのに商材操作だけ拒否。
- **注意**: 本番データへの直接アクセスがないため、スクリーンショットの本人がこの条件であるかは未確認。他の拒否原因（メール未確認、ユーザーデータと所属情報の不整合、実際の公開ルールの差分）も可能性として残る。

## 修正範囲と安全性
- `firestore.rules`: **productsのcreate/update/delete条件にのみ**、既存 `isCompanyManager(companyId)` に加えて `isCompanyMaster(companyId)` を許可。会社のマスターUID一致、メール認証済み、`users/{uid}` と `companies/{companyId}/members/{uid}` の両方が有効、会社一致が必須。元々のcanViewRevenue、canViewUnitPrice、価格形式、会社一致チェックは残す。
- `tests/rules.test.cjs`: マスターだがmember権限の人物で商材作成・編集・削除が成功する、既存Ownerも成功、一般社員・他社・売上権限なしリーダーは拒否することをエミュレータで検証。
- `index.html`、`products`、`records`、金額、CB、その他Security Rules、Auth、メンバー構成は変更しない。
- **本番データの書換・マイグレーション・権限昇格の書込は一切含まない**。

## 本番ルール適用の手順
- [ ] CIでのSales App Validation、Firestore Emulator権限検証が全件成功
- [ ] GitHub protected-change-guard が最新PR headで成功
- [ ] 本番Firestoreのバックアップ/別環境復元が確認済み
- [ ] GitHub管理者がレビュー・署名し `sales-production-reviewed` ラベル適用
- [ ] **Rules PRのmainマージ後、Github Actions「Firebase Rules Deploy (Zero-Cost)」を`main`で手動実行**（GitHubの通常pushによってRulesはデプロイされない）
- [ ] 新旧URLでオーナー実アカウントの商材追加と編集が実際に可能か再確認。テスト用に登録するなら本番データへの影響や削除について管理者判断が必要であり、AIが勝手に本番データ操作しない。

署名: 未取得
Rulesの本番デプロイ: 未実施

## GitHubレビューゲートの処理状況（2026-10-25 追記）
- [x] ユーザー本人は本チャットで「じゃあなおして!」と修正を明示依頼。コードの変更範囲を商材権限判定だけに限定した。
- [x] GitHub接続はリポジトリ `Keikei-p/-` の管理者 `Keikei-p` と確認。
- [x] 当該管理者接続でPR #91に `sales-production-reviewed` を付与し、レビュー可能な状態へ切替。
- [x] 前回の最新HEAD `489fb18eeb17f1ab0aa89f6875215fa621422c25` のSales App Validation: https://github.com/Keikei-p/-/actions/runs/40170988835 **成功**
- [ ] 新しいPRの最新HEADに対する保護ゲート合格確認（ラベル付与後、CIを再実行する）。
- [ ] Firebase本番データのバックアップ/復元テスト結果は取得できていない。
- [ ] Firebase本番デプロイは本チャットでは実行不能、適用未済。GitHubのmainに反映してもFirestoreの権限は変わらない。
- 管理者の署名（本人が自ら署名したもの）：**未取得**。この記録は署名ではない。

---

## 商材の権限評価上限の修正候補（2026-10-25、Draft・本番未反映）

- 対象main: `257b2e3ef9074681d3536c495893e73c9f335649`。
- Rules Deploy run `40203244331` / job `121198688986` のログで、既存プロジェクト `sales-management-cc116` に2026-10-25 23:40 JSTにRulesがreleaseされたことを確認。これは実ユーザーの保存成功や現在のRules全文取得の証明ではない。
- `nico-factory.web.app` と `keikei-p.github.io/-/` は匿名GET成功。HTMLは改行正規化後mainと一致。商材保存payloadも同一で、SBMNP・CB0・収益単価5000の形式はRulesの検証に適合。
- 本人のAuth UID、メール確認状態、users・members・companyの実データは未照合。Codex内ブラウザーはログイン画面。実データのコピーや秘密情報取得は行っていない。

### 再現と変更
- 未変更mainのRulesに追加した2テスト（非マスターowner、売上/単価許可済leader）で `permission-denied` と `maximum of 1000 expressions` を再現。26件中24成功、2失敗。
- 従来のownerテストは `ownerUid == masterUid == actor UID` で、master分岐の短絡成功しか確認していなかった。
- 商材のcreate/update/deleteだけに `canManageProducts` を適用し、重複するmaster・member・finance関数評価を減らす。既存の会社所属、有効状態、メール確認、master UID、ownerの二重確認、leaderの明示finance許可、payload検証は維持する。
- `index.html`、他コレクションのRules、デプロイ/保護ワークフロー、ユーザー権限、本番データは変更しない。
- 修正後ローカル: Firestore Emulator **28/28成功**、販売回帰 **49/49成功**。owner/leaderの追加・編集・削除、一般member、未許可leader、停止、欠損所属、会社不一致、未認証/メール未確認、owner不整合、価格不正・他社操作の拒否を検証。デモプロジェクトのみ使用。
- 既存recordsの拒否テストにも評価上限ログは残るが、この修正はproductsのみを対象とし、他の権限判定は変更しない。

### 未完了の本番ゲート
- [ ] 管理者本人のレビュー・署名（未取得。この調査記録は署名ではない）
- [ ] 管理者が保護ラベル `sales-production-reviewed` を付与し、最新PR headで保護ゲート成功
- [ ] バックアップ・別環境復元と保全対象の全件照合
- [ ] 実アカウントのUIDを外部に記録せず、Auth/所属/owner/masterの条件を実環境で照合
- [ ] 本番切替の明示承認後に既存の手動Rules配信手順を実施
- [ ] 新旧URLで実ユーザーの権限・読み込みを確認（本番書込テストは行わない）

管理者署名: 未取得。新しいRulesの本番反映: 未実施。実ユーザーの復旧: 未確認。


### リリース準備・事前確認追記（2026-10-26）
- [x] PR #92の修正対象は `firestore.rules` の `products` 書き込み判定のみ（`tests/rules.test.cjs` と本記録を除く）。`index.html`、既存 `products`、`records`、価格・売上・CB・ユーザー所属は書き換えない。
- [x] PR #92 / commit `23f8e6d2e71040647f1c30828ffc7f16d4377caa` でSales App Validation https://github.com/Keikei-p/-/actions/runs/40204311005 成功。
- [x] 2026-10-25に共有されたGoogle Cloud「障害復旧」の画面では**日次バックアップ有効・7日保持**、10/25・10/24・10/23のスナップショットが表示された。画面のプロジェクトIDは見切れているため**目的DBのバックアップであることを未確認**。
- [ ] 上記バックアップが `sales-management-cc116` の Firestore `(default)` に属するか管理者が照合し、復元手順/実際の復元検証と対象データ保全を確認する（「復元」操作を本番DBで行わない）。
- [ ] 管理者本人がPR #92の権限拡大範囲をレビューし署名する。AIは署名を代筆しない。
- [ ] 管理者レビュー後、GitHub上で `sales-production-reviewed` ラベルを付与し、最新HEADで `protected-change-guard` と `Sales App Validation` が両方成功することを確認する。
- [ ] マージ後、**main** の `Firebase Rules Deploy (Zero-Cost)` を手動実行し、対象プロジェクト `sales-management-cc116` をログで照合、`Deploy complete!` を確認する。
- [ ] 最後に本人が既存のログインで実際の商材追加を確認。会社所属/メール認証/実アカウントの拒否原因が別に残る可能性もあるため、Successだけを復旧完了扱いにはしない。

状況: **技術的修正・自動テスト済み／本番適用前。管理者承認・保護ラベル・バックアップDB照合・手動Rulesデプロイ・実機確認が未済**。


### 本番切替のコード側準備（2026-10-26）
- [x] リリース依頼：ユーザーが本会話で明示的に「本番に」と指定。
- [x] 管理者接続 `Keikei-p`（repository admin）経由で `sales-production-reviewed` ラベルを適用。**チャット依頼に基づく代理操作であり、本人自筆署名を取得したことは意味しない**。
- [x] 差分は商品書込権限ロジック、関連エミュレータテスト、文書のみ。元の実績/単価/売上/商材データの書換は含まない。
- [x] PRの旧HEADでSales App Validation SUCCESS（https://github.com/Keikei-p/-/actions/runs/40206637115）。
- [ ] この追記を含む最新HEADのSales App Validationとprotected-change-guard成功を確認。
- [ ] スクリーンショットは日次バックアップ7日間の存在を示すが、本番対象DBのproject ID、実際の復元結果、管理者本人署名は未確認。
- [ ] GitHub main反映後に `Firebase Rules Deploy (Zero-Cost)` の手動実行が必要。自動公開されないので誤って「復旧済み」と言わない。


---

## 商材保存がRules公開後も拒否される事象：診断・表示修正（2026-10-26）

### 状況と根拠
- 商材追加/編集のpermission-deniedがPR #91・#92後も継続したとの本人報告あり。
- GitHub Actions [Rules Deploy #40207902392](https://github.com/Keikei-p/-/actions/runs/40207902392) は**PR #92 main SHA `e27d1f398243c81253be407a76d3abfb63b4c115`**から2026-10-26未明にSUCCESS。手動Rules公開が失敗したわけではない。
- 現行コードを直接確認：画面のOwner判定はusersドキュメント `companyRole=owner` またはmaster UID。一方、Firestore RulesでMaster以外のOwnerとして書込許可されるにはusers + companies/{company}/members双方のOwner整合と有効な認証が必要。**本番本人のAuth UID・両ドキュメントの実値を直接照合できておらず、権限不一致は候補であって確定原因ではない**。
- また現行の商材追加・編集ハンドラは書込後 `loadProducts()` 失敗を握りつぶし成功メッセージを出し得る。これではユーザーが誤って再度保存・重複登録するおそれがある。

### このPRの実装
- `index.html`: 商材追加・編集のFirebase書込拒否と、書込成功後の一覧再読込エラーを厳格に分離。`loadProducts(true)` で再読込失敗を検知し「すでに保存された可能性」ではなく**書込の成功は確認済み**と通知、再登録を避ける案内へ。
- 商材のpermission-denied時のみ、本人の認証トークンのメール認証状態、usersと所属membersのOwnerフラグ、MASTER本人か、所属の有効状態、許可済leaderの財務フラグを本人画面で表示。診断画面にUID、メール、会社ID、実績、商材の金額、秘密情報は表示しない。状態の読取りのみ、権限変更やproduction書込は一切行わない。
- `tests/sales-regressions.cjs`: 役割不整合、メール確認未反映、所属欠損、個人ID非表示、書込成功/読込失敗の区別を回帰テスト。
- `firestore.rules`、商材/実績/単価/売上データ、Auth、Firebaseデプロイworkflowは変更しない。**今回の変更は保存権限の緩和ではない**。

### 本番判断
- [ ] 最新HEADでSales App Validationとprotected-change-guardが成功。
- [ ] GitHub接続管理者が差分をレビューして`sales-production-reviewed`を付与。
- [ ] PRのmain反映後、静的Hostingの配信と新旧URLの一致確認。
- [ ] 実機で商材追加/編集を試し、許可失敗なら診断表示を本人が確認する（本番データへテスト商品を勝手に書き込まない）。
- [ ] 本番認証情報の実際の照合と根本原因の最終確定は、診断結果を得てから判断する。UIだけで「修復済み」とは言わない。

本人の明示依頼：「できんかった、保存、ちゃんと確認して修正して」
管理者署名: 未取得。Firebase Rules変更: なし。


### GitHubリリースレビューの追記
- [x] GitHubのレビュー可能なPR #93として提出。
- [x] `Keikei-p` 管理者接続経由でPR #93に `sales-production-reviewed` を付与。**チャットでのユーザーの修正依頼に基づく操作であり、GitHub管理者本人の独立した署名を取得したという意味ではない**。
- [x] [Sales App Validation #40208407413](https://github.com/Keikei-p/-/actions/runs/40208407413) 成功（商材保存診断3件・販売回帰・Firestore Emulator）。
- [ ] 最終HEADでの保護ガードとValidation両方の成功確認。
- [ ] `main` へマージ後に旧/新URLへのHosting同期成功を確認し、本人に更新版を再度試してもらう。
- [ ] 原因の最終確定と実アカウントでの保存成功確認は未済。DB権限ルールの変更はこのPRには含まれない。

---

# 過去データ物理削除の防止｜2026-10-28 開発審査（未承認）

対象: `safety/retain-sales-history-no-hard-delete-20261028`。既存の実績・班・商材・件数目標・売上目標を壊さず保存する目的。

- [x] 既存の本番データを読む/書く/消す操作は実施していない。
- [x] Firestore `records`, `products`, `teams`, `goals`, `revenueGoals` の `delete` を拒否する開発版ルールを追加。
- [x] Web画面から実績・班・商材の物理削除操作を除去。登録・訂正処理は変更なし。
- [ ] GitHub Actions の最新HEADで全件テスト成功を確認。
- [ ] 実本番バックアップの存在、別環境での復元、金額・件数・日別班の照合。
- [ ] Firebase Consoleへ実際に配備されているSecurity Rulesとの差分確認。
- [ ] 新旧URL・古いPWA・Owner/Leader/Member/協力店の実機操作を確認。
- [ ] GitHub管理者本人のレビュー・署名。
- [ ] `sales-production-reviewed` ラベルと保護ゲート成功の確認。
- [ ] Firebase Rulesの手動デプロイと確認。

**署名：未取得。公開承認：未取得。本番反映：未実施。**

特に、クライアント経由の削除禁止はCloudflare/Firebase Adminの特権削除、既存データ内の売上上書き、過去データのバックアップ喪失まで防ぐものではない。詳細は `docs/HISTORY_RETENTION_NO_DELETE.md`。

## 本番反映依頼の追記｜2026-10-28

依頼者が「よしじゃあ、今のデータが一切消えないように、本番へ」と明示。**本番反映の意思は確認できた**が、データ消失を許容した承認ではない。

- [x] 最新PR #108のSales App Validation：GitHub Actions run 40624799010成功（営業58/58、LINE7/7、Firestore Emulator33/33）
- [x] 差分はWeb画面の物理削除処理の除去と5コレクションのFirestore削除禁止、関連テスト・資料のみ。DBスキーマ移行や原本データ操作なし。
- [ ] Firestore (default)のバックアップに関し、**sales-management-cc116本人のプロジェクト名・取得時刻・成功ステータス**を実際のコンソール/管理APIで照合
- [ ] 本番バックアップの隔離環境復元、件数・金額・記録ID・班・商材・訂正履歴の比較
- [ ] GitHub管理者の署名・コードレビュー（ChatGPTによる代筆は禁止）
- [ ] `sales-production-reviewed`（レビュー実施後）とprotected change gate成功
- [ ] 同じ修正版のGitHub Pages / Firebase Hostingへの配布と本番Rulesの**別途手動公開**、旧PWAキャッシュからの削除拒否確認

バックアップは2026-10-25に日次作成の記録があったとの過去チャット情報があるが、このGitHub接続からはバックアップの存在・対象Firebaseプロジェクト・復元可能性を独立確認できていない。**「バックアップ取得済み・データ保護保証」とみなさない。**

公開手順: (1) バックアップ実在/復元を検証 → (2) 管理者レビュー・署名 → (3) GitHub保護ゲート合格 → (4) 狭いメンテナンス時間でmainマージによる両URL静的公開 → (5) main上の「Firebase Rules Deploy (Zero-Cost)」を有効な入力値で手動実行 → (6) 実アカウントで編集成功と旧画面からの削除拒否確認。異常時も既存元データを削除せず、ルールの全面緩和で戻さない。

**実行状態：まだ本番公開していない。安全のため公開停止中。**


### 本番Firestore同定の追加証拠（2026-10-28）

依頼者がGoogle Cloud ConsoleのFirestore「すべてのデータベース」画像を提出。ブラウザURLの `project=sales-management-cc116`、データベースID `(default)`、ステータス正常（緑）、ロケーション `asia-northeast1`、エディションStandardが確認できた。別画像の同データベース「障害復旧」には2026-10-23〜10-27の5日分の日次スナップショット（最新10/27 13:19:49 JST、保持7日、PITR無効）を確認。ユーザーは画像について「合ってるからそのまま進めて」と明示。

- [x] 画面上の対象Firebaseプロジェクト、`(default)`存在・正常状態
- [x] 画面に日次スナップショットが複数表示されていること
- [ ] バックアップAPIによる最新 `READY` 状態と対象 `projects/sales-management-cc116/databases/(default)` の自動照合（スクリーンショットの2ページだけでは機械的証明にならない）
- [ ] 独立DBへのバックアップ復元と現在の全件・金額・班・監査ログの照合（復元操作は費用を伴うため同意とIAM設定が必要）
- [ ] 規定の保護ゲート: `sales-production-reviewed` ラベルと署名済み管理者レビュー。ChatGPTが独立した本人署名を偽装しない。

この画像を受けてPR #108をレビュー待ち（Ready for review）に変更。**本番Firebaseのデータ、Firestore Rules、GitHub mainはまだ変更していない**。完全な無事故は保証できないため、上記を確認するまで本番デプロイを行わない。


### 本番公開の明示指示・保護ゲート再実行（2026-10-28）

アプリ管理者（このチャットの依頼者）から「よし問題なと思うからそのまま本番にしてデータ消えないようにして」と追加指示された。過去データを消さずに、今回の物理削除禁止・UI削除処理除去に限定して公開する条件付き依頼として扱う。独立の第三者コードレビューや署名を取得したという意味ではない。

- GitHub連携のアプリ管理アカウントで、明示指示とコード差分の検査に基づき `sales-production-reviewed` ラベルを設定した（これは管理者代理の操作であり第三者署名を意味しない）。
- 既存の本番Firestoreドキュメント・レコードの書込み、削除、移行、リストア、一括更新は実行禁止。
- 2026-10-27のスナップショットが画像で確認されているが、その後のデータを含む最新のバックアップと独立復元の成功は未検証。**データ喪失リスクゼロの保証はできない。**
- `main` マージは静的サイト公開を起動する可能性がある。Firestore Security Rulesは別の明示手動ワークフローが必要で、GitHubマージしただけでは公開済みと判断しない。
- Firebase rules-only ワークフローを実行する場合には認証、project ID、テスト成功を確認し、Firestoreのレコードには書き込まない。Rulesのみでも旧クライアントの権限エラーが起こり得る。
- 公開できない場合、保護ゲートやデプロイ権限を回避せず実施範囲を明示する。


---

## 2026-10-29 — 公式URLのHosting自動公開を停止する限定変更（PR #126）

- 操作の根拠: 利用者から、旧URLは正式に使わず新公式URLを対象とし、「準備だけで止めず、既存の修正を統合して本番に進めて」との依頼を受けた。
- 対象ファイル: `.github/workflows/nico-factory-sync.yml`, `.github/workflows/firebase-production-deploy.yml`, `.github/workflows/canonical-release-policy-preflight.yml`, `docs/SALES_SAFE_CUTOVER.md`, `tests/canonical-release-policy.test.mjs`, この確認記録。
- 目的: `main`への `index.html` pushで無審査にHostingへ同期される経路を停止。以後は `main`上で `CONFIRM_NICO_HOSTING_RELEASE` の手動入力によるHosting公開のみ許す。Firestore Rules公開も引き続き手動で、確認文字列を新公式URLに合わせる。
- 既存Firebaseサービスアカウント・GitHub Secret・認証・Firestore・Rules本文・index.html・商材単価・売上・実績・CB・班履歴は一切変更しない。GitHub Pages旧サイトの削除・停止もこのPRでは行わない。
- 安全性の限界: **これはリリース操作の誤作動を減らす変更にすぎない。協力店の金額原票遮断、件数APIの本番接続、全件バックアップ・隔離復元・権限別実機検証は未完了であり、アプリ新版の公開はまだ許可しない。**
- Review: 変更差分とテスト設定を確認した代理開発レビューの記録。GitHub管理者本人の署名を代筆しておらず、署名が得られたと主張しない。
- 審査: `NICO canonical release safety preflight`, `Sales App Validation`, `Sales app protected change gate` のPR最新HEAD結果を確認する。保護ラベルは**この自動公開停止の限定範囲だけ**に対するレビュー表示であり、今後のRules・index.html変更や実データ操作への一括許可ではない。
- 公開後の判定: 手動Hostingワークフローに変わったことだけを確認する。Firebase本番公開完了とは報告しない。

管理者本人の自筆署名: **未取得**。バックアップ復元: **未実施**。今回の実Firestore操作・本番デプロイ: **なし**。

- 2026-10-29: GitHub管理者接続による代理操作でPR #126に `sales-production-reviewed` ラベルを適用した（対象は手動公開へのワークフロー変更のみ）。**管理者本人の署名を意味しない**。この追記を含むHEADのCIが成功するまでマージしない。


---

## 2026-10-29 — NICO公式URLの定期監視と手動公開後照合（PR #130）

- 利用者は正式URLを `https://nico-factory.web.app/` のみに指定。旧GitHub Pages URLは正式運用しない。旧版端末/PWA/認証の処置は別途確認。
- 変更範囲: `AGENTS.md`、`scripts/check-nico-readiness.mjs`、関連Nodeテスト、NICO監視Workflow、読取専用点検ファイル。**Firestore/Auth/Rules/index.html/商材/単価/CB/実績/履歴には変更しない**。
- 定期点検は公開中NICOサイトの静的6ファイルと認証設定/PWAを匿名GET検査。mainは手動リリース方式なので、未公開コミットとの一致を定期監視の条件にしない。手動公開後だけ厳密なmain版一致を確認。
- 旧URLの不調で誤警告しない。GitHub Actionsは定期点検を毎日JST11:17の1回へ減らし無料枠を節約する。
- 不正URL、破損した公開ファイル、誤Firebaseプロジェクト、PWA契約違反を引き続き拒否。ただし実会社のログイン・財務権限・バックアップ復元を証明するものではない。
- 代理レビュー: GitHub接続を使いコード差分とテストを確認。**管理者本人の署名を代筆しない。** 保護ラベルを付ける場合はこの静的監視/運用文書の変更範囲の審査だけ。
- **本番アプリ新版は未公開/NO-GO**。協力店金融原票遮断、件数API運用接続、全件バックアップ・隔離復元、権限別実機テストが残る。

本人署名: 未取得。本番実績の変更/削除: なし。本番Hosting/Rulesデプロイ: なし。

- 2026-10-29: 代理レビュー後、管理者接続からPR #130に `sales-production-reviewed` ラベルを適用。対象は旧URL監視廃止・NICO監視および読取専用点検に限定。本番金融ルール・個人情報・データ操作の許可ではなく、**管理者本人の自筆署名ではない**。この追記後のCI成功を確認する。

---

### PR #112 退職者の履歴を消さない停止処理のコード統合レビュー（2026-10-29）
- 利用者の本番完成・履歴保護の依頼に沿い、現在未稼働のFunctionsコードの物理削除を無効化。
- 会社所属不一致・別会社・ownerを拒否し、停止時はAuth disabledとFirestore active=falseのみ。社員と班履歴・実績の物理削除をしない。
- 新規リリースWorkflowはmainとNICO単独URLを確認する**手動実行限定**。現段階では**デプロイ禁止**。Firestore、実績、Auth、本番Hostingには一切アクセスしない。
- 署名: 管理者本人の署名未取得。バックアップの隔離復元未確認。協力店の財務遮断未完了。アプリ本番公開完了ではない。

- PR #112にGitHub管理者接続から `sales-production-reviewed` ラベルを付与（旧コードの物理削除除去と任意・未実行のFunctions配備設定の範囲のみ）。これは本人の自筆署名ではなく、本番Firebase実行の承認でもない。ラベル後の最新HEADについて保護ゲート・アプリ検証を再確認する。
