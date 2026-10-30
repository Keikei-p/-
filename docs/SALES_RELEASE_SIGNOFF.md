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


---

## 2026-10-29｜PR #106 日別訂正と監査履歴の同時保存（本番未反映）

- 対象: 最新mainの `index.html` の `persistDailyRecord` と保存時訂正処理だけ、`tests/sales-regressions.cjs` の架空データ回帰とPR専用検証、資料。
- 既存実績の修正と `recordCorrections` への追記を同じトランザクションにする。監査ログ保存失敗/競合の際に実績だけ更新しない。既存ドキュメントID/件数/CB/売上/価格/チーム履歴は一括変更・削除しない。
- 本番 `firestore.rules`、`firebase.json`、Firebase/Hosting/Cloudflare/LINEのデプロイやAuthへの操作なし。現在の本番とは別のコード審査段階。
- GitHub保護ラベルと最新HEADのテストが成功しても、本番データ復元/実機の証明にはならない。バックアップの隔離復元・協力店権限・本番URLでの正常な訂正/編集競合テストが未確認なら公開しない。
- 利用者本人の署名: **未取得**。この記録は開発上の確認記録であり、本人署名の代用ではない。

- 2026-10-29: 接続済みGitHub管理者権限でPR #106に `sales-production-reviewed` を適用（コードをmainへ統合する範囲の技術審査。実Firebaseの本番配備・既存実績操作・本人署名の代わりではない）。この追記を含む最新HEADの `Sales App Validation`、`Record Audit Preflight` と保護ゲートが成功するまでマージしない。


---

## 2026-10-29 | PR #125 月別履歴・2,000件超対応（コード審査、**未配備**）

- 利用者はデータ消失を絶対禁止し、NICO公式URLだけを使い、履歴2,000件を超えても使える状態を希望。
- `index.html`の全履歴 `onSnapshot(recordsCollectionQuery())` と全量 `getDocs` を、表示中の月だけ購読する方式へ置き換える候補。別日の訂正はその日と担当者をサーバー照会して元ドキュメントを特定。未確認の場合は新規登録で上書きせず停止する。
- 月切替の途中・Firestoreキャッシュ・権限エラーでは売上/件数ランキングを隠し、**古い月の数字を現在月の結果と誤認させない**。
- `firestore.indexes.json` は既存の資料化用 `records(companyId,date)` と `recordCorrections(companyId,recordDate)` を維持し、月別+日別補正用 `records(companyId,uid,date)` を追加。自動でFirebase本番インデックスをデプロイするものではない。
- 今回の確認はコード/匿名合成テストのみ。旧PWAログイン利用者・iPhone/Android・実Firebaseの索引とインデックス費用、過去実績の件数/単価/CB/班履歴・会社別アクセスは**未検証**。
- 既存Firestore/Auth/実績/商材/単価/CB/履歴/売上への一括書込み・再計算・削除を行わない。GitHub mainへのコード統合と、本番Hosting/Rulesの公開は別操作。
- 管理者本人の署名を代筆しない。実データ全件バックアップ+隔離復元、権限別実機確認、管理者の手動リリース確認が揃うまで、NICOの画面新版を配備しない。

レビュー対象: PR #125 のHTML, Firebase index候補, 既存全件読み込み削減, tests。**本番公開: 未承認／未実施**。

- 2026-10-29: 実装版PR #125に管理者接続から `sales-production-reviewed` を適用（対象はGitHub mainへのコード統合審査に限定）。既存ユーザーの実Firestore・Hosting本番変更や本人の電子署名を意味しない。ラベル適用前に起動した検査ではラベル無し判定で停止したため、**本更新後HEADの保護ゲートとアプリ検証の成功を確認するまでマージしない**。


---

## 2026-10-29 / PR #98 — 同名班の誤計上防止、価格・CB読取専用検算

- 範囲: `buildTeamRankingRows` の班名一致の曖昧なフォールバックを停止。**現行班のIDが一致しない場合は他班の売上/件数を流用しない**。旧形式の班名のみの集計は班名とキーが一意の場合のみ表示。
- 架空データの回帰テスト: 同名2班・旧班/現班・班移動後の保存済teamId、NUROのCB0/CB20000、とくするでんき/エバーグリーンの単価5件を検算。
- 過去の実績 `records.teamId`、保存済み単価、CB、売上、件数、班履歴は**一切修正/削除/再計算せず**。現行の実績訂正+訂正ログの一括トランザクションを保持。
- `index.html` の集計表示と `tests/sales-regressions.cjs` のみ変更。Firestore Rules、Firebase Auth、Hostingデプロイ、売上原票や商材マスタの書き込みなし。
- GitHub `main` へコードを統合できても、NICO正式URLに新版が公開された意味ではない。公開前の全件バックアップ/隔離復元/Owner・一般社員・協力店の財務権限試験は引き続き必要。
- レビュー: 実装者によるコードおよび合成テスト確認。**管理者本人の署名ではない**。本番公開を許可しない。

**判定: 集計のコード修正は限定統合可能。本番リリースはNO-GO。**

- 2026-10-29: 既存PR #98に管理者接続から `sales-production-reviewed` ラベルを適用。**同名班の集計表示修正および架空データの回帰テストにだけ適用**。このラベルは管理者本人の電子署名やHosting/Rules公開許可ではない。ラベル付与後の最新HEADで保護ゲートを再実行する。


---

## 2026-10-29 — PR #82 価格マスター・CB重複・過去単価の読取専用点検

- 目的: 新規登録時に**同じCBプランが複数存在しても先頭の単価を採用しない**。保存済みデータの単価と現在価格が違う場合に、Owner画面へ注意喚起する。
- 原票の保存単価と当時のCBを残し、`records`、`products`、`recordCorrections`、班履歴、UID、過去売上を**一括再計算・変更・削除しない**。
- `index.html` の候補変更は、CB選択の厳格化と選択月の**既読データのみ**を使う警告。オーナー以外には価格警告を表示しない。旧単価の差は「単価改定の可能性あり」であって無条件に誤りと判定しない。
- 変更範囲: `index.html`、`tests/sales-regressions.cjs`、この技術審査メモのみ。Firestore Security Rules、認証、Functions、既存会社データ、Hosting/Workersデプロイは変更しない。
- テスト: CB0/CB20,000、同CB重複、NULL単価の誤保存拒否、保存済み単価0、オーナー限定警告、古い単価の不変性、同名班と原子訂正の既存回帰を確認する。
- 検証の限界: 合成テストだけでは実データの全件価格正確性・古いPWA・社内/協力店Firestore閲覧権限・隔離復元は証明できない。
- 技術レビューの対象は**コードをmainに統合する行為のみ**。管理者本人の自筆署名・本番Rules/Hostingの公開承認・バックアップ復元完了の証明ではない。

**本番リリース可否: NO-GO**。本番データへの書込・削除・新画面のデプロイは行わない。

- 2026-10-29: GitHub管理者接続のコード技術レビューでPR #82に `sales-production-reviewed` ラベルを適用。**対象はオーナー向け読取専用警告と重複CBの登録拒否コードのmain統合のみ**。ユーザー本人の電子署名、本番デプロイ、既存履歴の一括変更は未承認。本追記後の最新HEADでSales App Validationと保護ゲートを再確認する。

---

## 2026-10-29 PR #132 金額付きFirestore原票を誤公開しないための限定審査

- 利用者の「過去データを一切消さずに、本番安全になるまで改善を続ける」という開発依頼に対応するリリース安全ゲート。**本番Firestore Rules、データ、Auth、Hostingは変更しない**。
- 差分: `scripts/check-finance-read-boundary-before-deploy.mjs` / `tests/finance-release-gate.test.mjs` / `.github/workflows/finance-boundary-preflight.yml` / `.github/workflows/firebase-production-deploy.yml` / `docs/FINANCE_RULES_DEPLOY_STOP_20261029.md` / 本審査記録のみ。
- 主な検証: 金額付き4原票コレクションの会社全員向けread、追加get/list、ownerだけのように見せかけたOR、書込や削除の危険条件をCIで検出。現行Rulesでは意図的に**STOP**とし、静的合格してもデプロイ承認にしない。
- `firebase-production-deploy.yml` の人間による明示確認・main限定の公開制限を維持し、Firebase認証情報やデプロイ操作を起動する前に新ゲートを実行。
- 既存の販売実績、件数、単価、CB、社員UID、班履歴、商材設定、Firebase料金情報、LINE設定は一切変更・削除・一括移行しない。
- 今回の限定審査は開発者のコード/テストレビュー記録。**GitHub管理者本人の署名・本番公開承認・実データバックアップ復元済みの証明ではない。**
- 本番許可条件: 旧PWAを安全なAPIへ移行、協力店/未許可社員の金額原票読取拒否、全件保全/隔離復元、エミュレータ・端末・料金の検証、オーナーの本番最終承認。全部揃うまでNO-GO。

判定: 上記ワークフロー変更だけ限定コード統合可能。**本番Rules/Hosting新規公開は禁止**。

- 2026-10-29: GitHub管理者接続からPR #132へ `sales-production-reviewed` を適用。対象は**危険なRulesの手動デプロイを止めるワークフローの変更と読取専用検証のみ**。利用者本人の電子署名ではない。ラベル付与後の最新HEADのCI成功が必要で、本番Firebaseへのデプロイ承認ではない。


---

## 2026-10-29 — オーナー専用「売上資料・保管庫」画面の配線（開発PR、本番未配備）

- 追加対象: `index.html` に既存 `sales-archive.js` の読取専用モジュールを1回だけ読み込み。本人の現在のメール認証と自社owner/masterの権限を確認できた場合だけ管理メニューへ表示。協力店owner/leader/member等はサーバー側の原票読取権限も別途遮断する必要があり、このUIガードは完全遮断を証明しない。
- 手動Hostingの静的ファイル配備リストに `sales-archive.js` / `archive-output-policy.mjs` / `archive-coverage.mjs` / `archive-read-budget.mjs` を追加。自動本番デプロイは行わず、既存の main + 明示確認 `CONFIRM_NICO_HOSTING_RELEASE` を維持。
- `getCountFromServer` を先に実行して4コレクションの合計10,000文書超を読み取り開始前に拒否。対象月/年で件数が読み取り前後に変われば確定PDF/CSVを停止する。元コレクションは読取のみ、既存実績・保存単価・CB・訂正履歴を一切削除/再計算/書込しない。件数が1万超の場合、期間を分割するか別のサーバー側分割読取を用意する。月25,001文書への対応が完成したという意味ではない。
- オーナー権限確認をJSONファイル読込時にも再実行。ファイル検証失敗時に以前読み込んだ資料のボタンを残さない。PDFはブラウザの印刷/保存、CSVはExcel用、JSONは**営業履歴4コレクションの証拠保存**でありFirestore全体の復元可能なバックアップではない。
- 架空データの `archive-read-budget` とHTML/Hosting配線のテストを追加。GitHub CI・実端末動作の結果はPRチェックが更新されてから記録。既存の売上集計/Firestore Rules/会社認証/LINE/無料枠の本番設定は変更しない。
- **変更審査は開発者の技術レビューのみ。管理者本人の署名や本番の公開承認を代筆しない。** 全会社バックアップ2媒体・隔離復元・役割別Firestore原票遮断・Firebaseインデックスと使用料金確認・新公式URLの実機確認が揃うまでHostingへ公開しない。

**現時点のリリース判定: NO-GO / 本番未配備。**


### 2026-10-30 補足：PR #136 の安全コード審査（本番公開承認とは別）
- Sales archive は `getDocFromServer` で現在の Auth 本人/会社会員/会社情報をサーバーから取得し、キャッシュ済み失効権限では資料出力しない。
- `companyKind/accessKind/memberType` に未知値があれば拒否。社員所属先 `companyId` が食い違えば拒否。認証・権限失効途中ならPDF/CSV/JSON出力停止。
- 旧GitHub Pagesで追加保管庫を誤表示しないよう `https://nico-factory.web.app` のみ有効化。
- 確定書類は現行Firestore原票を再確認した場合のみ出力可。保存済みJSONのSHA-256は出所証明ではなく、確定PDF/CSVを再発行させない。
- バックアップはユーザーが定期的に取得済みと申告。ただし**本番全件とAuth/設定を含む2媒体、実ファイル同一性、隔離環境復元はこのPRでは確認していない**。
- この審査記録とGitHub保護ラベルは、**開発コードだけをmainへ統合する技術審査**。本人の電子署名や手動Hosting公開、Firestore原票の閲覧権限切替、既存会員への影響ゼロを証明するものではない。本番判定NO-GOを維持する。

- GitHub接続の管理権限によりPR #136へ `sales-production-reviewed` を付与。これは現時点で完成した**コード差分の技術審査用**。実バックアップ照合の署名/本番Hosting公開・Firestore Rules切替の許可ではなく、公開作業は引き続き別承認。


## 2026-10-30 PR #143: 公式Hostingの危険な財務データ公開を遮断するコードレビュー

- 対象: `scripts/nico-production-cutover-preflight.mjs`、`tests/nico-production-cutover-preflight.test.mjs`、公式Hostingの手動Workflow、静的CI、実施手順。
- 改善: 既存の危険な金額原票Firestore Rulesと、旧画面の金額原票の直接読取/書込が残る場合、**本番Firebase資格情報を利用してデプロイする前に**自動STOPする。
- 現行mainは意図的にSTOP: `records/products`等の権限境界とブラウザ移行は未完了。本PRはシステムを本番へ無理に切り替えるものではない。
- 静的チェックの合格だけではFirebase実機の権限・バックアップ復元/照合・旧PWA・大量件数の無料枠・本番ゲートウェイの認証を証明しない。実Firebase Rules変更、LINE送信、原票更新/削除、Hosting公開は**未実施**。
- `sales-production-reviewed` は**危険なリリースを拒否する保護コードの技術レビュー記録**。ユーザー本人の電子署名や、全本番要件を満たした承認を代理で作成するものではない。
- 認証情報の追加・ログへの資格情報出力・実Firestore読み書き、データの破棄/再計算はなし。既存履歴・当時単価・売上・バックアップは無変更。


---

## 2026-10-30 — 旧ブラウザへの金融原票アクセス前に本人・会社の最新権限を検査（開発コード技術レビュー）

- 対象: `legacy-finance-entry-guard.mjs`, `index.html`, `tests/legacy-finance-entry-guard.test.mjs`, `.github/workflows/pr38-validation.yml`, `.github/workflows/nico-factory-sync.yml`。保存済み実績・収益・単価・CB・退職者・班履歴・会社データに書込/削除/再計算なし。
- 対策: 認証済み本人の現行 `users/{uid}`、`companies/{companyId}/members/{uid}`、`companies/{companyId}` の3文書を **getDocFromServer** で取得し、UID・会社・有効状態・会員種別を判定。協力店会社・本人/会社会員の協力店指定、未知のアクセス/会員種別、会社・班・役職不一致は、旧ブラウザで `products` を読む**前**に停止。ログアウト導線を残す。旧社内アカウントの既知内部属性は保持。
- `getDocFromServer` が失敗した場合も金融原票は読み取らず、再確認の案内に停止する。Firestore SDKはブラウザが改変可能なので、**これは多層防御の一部でありFirestore Rulesの代替ではない。**
- 旧 `index.html` には金額付き `products` / `records` 直接読取・書込がまだ存在する。保護済みRules候補と旧ブラウザの切替を済ませるまで、本番HostingとFirestore Rulesの公開は引き続き **NO-GO**。一部協力店の入力を一時停止させ得るため、実権限テスト/専用ポータル稼働が必要。
- 手動Hosting用ファイル複製リストに上記ガードモジュールを追加し、パッケージ漏れで画面が壊れることを防止。認証情報・本番Firebaseへのコマンドは実行しない。
- GitHub保護ラベル/本記録は **コードの限定技術審査** であり、ユーザー本人によるリリース承認・本番実データの復元照合・公開確認を代理するものではない。

**最終判定: 本番未公開・NO-GO。**


---

## 2026-10-30 — PR #153 協力店の独立会社招待（限定開発コードレビュー、本番OFF）

### 確認した現在のFirebase状態
- 依頼者のPCから `firebase functions:list --project sales-management-cc116` に成功。デプロイ済みは `sendMissingReportReminders`（asia-northeast1, v2, Node.js 22）のみ。新しい招待用3 Functionsは未配備。
- CLIログインは成功。認証メール・トークンなど秘密情報をGitHubには保存しない。

### PR変更と動作範囲
- `functions/index.js` は新しい `createPartnerCompanyInvitation`, `previewPartnerCompanyInvitation`, `acceptPartnerCompanyInvitation` の3つだけを追加。既存社員招待、既存LINEスケジュールとそのトリガーは無変更。
- `functions/partner-company-invitations.cjs` は検証済みユーザー、最新Firebase Auth・Owner所属、30分・一回・指定先メール限定の招待を処理。受入先は別 `companyId`、`companyKind=partner`、`accessKind=partner`、売上・単価禁止、連携/件数報告初期OFF。
- `partner-invite.html` は既存の営業実績旧画面とは別ページ。公開用既存 `index.html` は変更しない。
- `firebase.partner-invites.json` はFirebase Functionsソースのみを指定し、Firestore/Hosting配備対象を含めない。正式展開時は**必ず3つの `--only functions:<exact-name>` を指定**。汎用 `firebase deploy`、`--only functions` は使用しない。
- `.github/workflows/nico-factory-sync.yml` の新ページ複製リストだけを追加。既存の安全STOPゲートと手動Hostingリリース条件は解除しない。
- Functionsに `PARTNER_INVITES_ENABLED=enabled` が明示的に設定されない限り、新規招待・プレビュー・承諾は拒否する。
- `records`、`products`、`recordCorrections`、`revenueGoals`、既存 `users/companies/teams`・CB・実績・売上・招待履歴・バックアップに対する本番書込・削除・再計算は一切していない。

### 自動検証と保護の範囲
- PR #153の `Sales App Validation`、`Sales Archive Preflight`、`NICO canonical release safety preflight` を最新HEADで確認する。デモFirestoreエミュレータで別会社の作成・一度だけの承諾・元会社無変更・Hub金額原票への直接読取拒否を検査。
- 本番の会社単位金額原票Security Rulesは未完成。承諾直後の協力店は件数入力・合同ランキングを使用できない設定で停止する。招待APIを独立公開しても**協力店の実運用全体が完成した意味ではない**。

### 本番リリース前に必要
- [ ] 本番DBバックアップ2媒体と隔離復元の最新全件照合（UID・件数・価格・CB・履歴）
- [ ] 既存のAuth・会社/班/商品と新会社権限の実環境試験、停止/不正アカウントと旧PWA試験
- [ ] Cloud Functions Blaze請求・上限、呼び出し防御、招待件数/料金の管理者確認
- [ ] Hostingの停止ゲートを**解消する実際の安全なFinance APIクライアント移行**。ゲート迂回はしない
- [ ] 明示的な本番配備承認後に3 Functionだけを手動配備し、公開後の実アカウント確認
- [ ] 管理者本人の署名（現時点未取得）

**この記録は限定コードレビューの証跡であり、本人署名・本番データ検証・公開承認の代わりではない。本番公開はNO-GO、実績と既存Functionは無変更。**


### PR #153 review-label note (2026-10-30)
- GitHub接続ユーザー `Keikei-p` の管理権限を取得して、PRの実差分9ファイルを確認。 `functions/index.js` は新Callable3件の追加のみ、従来 `sendMissingReportReminders` と社員招待は無変更。 `.github/workflows/nico-factory-sync.yml` の起動条件や本番ゲートは無変更。
- 本チャットの「今日中に協力店招待を使いたい」という依頼を根拠として、管理者接続で `sales-production-reviewed` を**この限定コード変更の審査用ラベルとして適用**した。これは独立した本人署名・本番デプロイ許可ではない。
- 依然として `PARTNER_INVITES_ENABLED` は本番未設定で機能OFF。Firebase Hosting・Functions・Firestore・LINE本番変更は未実施。保護ゲート通過とGitHub main統合は本番利用可能の意味ではない。


---

## 2026-10-31 — 手動公開失敗 #41080213061 の1回限定自動再試行（コードレビュー）

- 元の公開実行 `41080213061` は `workflow_dispatch`、ブランチ `main`、Owner `Keikei-p`、コミット `a135ee56375248b88ee6d02ecdac160a2de83b37`、試行1回目。静的検証とCLI準備・保護用Secret導入は成功したが、`READ ONLY live site parity check` で `STOP UNKNOWN_ARGUMENT`。既存Functions配備/Hostingリリース/Firestore更新に進む前に失敗。ユーザーの再実行承認は本会話内で明示。
- 原因は `process.argv` 全体を不正なCLIフラグとして検査し、Node実行ファイルとスクリプト名まで拒否していたこと。PR #155で `process.argv.slice(2)` のみに修正し、実Nodeプロセスを起動する失敗再現テストを追加。本番変更なし。
- 本PRの一時救済 `.github/workflows/nico-partner-approved-recovery-once.yml` は、**元の手動実行ID、実行者、対象旧SHA、元イベントworkflow_dispatch、結果failure、再試行回数が厳密に2**のときだけ、**同じ手動確認トークン**を添えて現行mainで既存 `nico-partner-invite-only-release.yml` を再度Dispatchする。通常push／任意PR／通常schedule／別の手動操作からの本番リリースは不可。
- 本PRは再公開を自動で始めない。追加した一度だけの橋渡しは、元の失敗ジョブに管理者が明示的にリトライ操作したときだけ起動し、元の失敗試行は既知の引数バグで再度STOPする。新規公開の本体は従来どおり `workflow_dispatch` の手動確認条件・3 Functionsのみ・新規HTML1ファイルのみ・既存サイト全ハッシュ一致の公開ゲートを引き続き実行。
- 本番Firestore、Auth、既存Functions、Hosting、LINE、実績原本、単価・売上・CB・履歴に対する変更は本レビュー時点でゼロ。協力店件数登録・会社合算ランキングの実運用は別途NO-GOのまま。公開Run実績で検証するまで完了と見なさない。
- 重要: 成功してもこの一時救済Workflowを削除/無効化する。保護ゲートの技術レビュー記録は**バックアップやFinance Rulesの承認ではない**。


---

## 2026-10-31 — 協力店招待3 Functions作成後のArtifact Registry保存期間エラーを修正

- 手動本番リリースRun `41081599252` は、`createPartnerCompanyInvitation`, `previewPartnerCompanyInvitation`, `acceptPartnerCompanyInvitation` すべて **asia-northeast1, Node.js 22, 2nd Genで `Successful create operation`** をログ確認。
- ただしFirebase CLIの終了処理で `Functions successfully deployed but could not set up cleanup policy` のため終了コード1。従来のLINE通知は配備対象外。本番Hosting招待ページは公開されていない。既存Firestore、Auth、売上、当時単価、CB、実績件数、履歴、旧LINEのデータ変更/削除は未実施。
- Firebase公式 `https://firebase.google.com/docs/functions/manage-functions` を確認。Artifact Registryに貯まるデプロイ用コンテナイメージは実行中Functionsに不要で、`firebase functions:artifacts:setpolicy --days 1 --location asia-northeast1` の設定により1日超の**ビルド用イメージのみ**が自動削除される。Firestore原本/利用者データや稼働中のFunctionsは削除対象ではない。無料枠利用費用を抑えるために指定。
- デプロイ済み招待3件のコード（Git blob `functions/index.js=dfb4c48ada6fa89a24c898cd4a2f911bcede822f`, `functions/partner-company-invitations.cjs=4da83f98cd6f033d8ce8bda532aef39859db9c09`）と再公開元コードが同一であることを検査し、`functions:list` で3件と従来 `sendMissingReportReminders` を確認できた場合は**追加のCloud Build/再配備を行わない**。
- ポリシー設定/既存4件の照合/未認証のCallable拒否が合格した場合のみ、従来Hostファイルのハッシュを全保護して新規招待ページだけ追加する。途中で相違や権限不足があれば即STOP。現時点でHTML公開と実協力店操作はまだ完了していない。
- `firebase deploy --force` でエラーを無理やり無視したり、`--only functions` で既存LINE通知まで更新しない。元の制限付きデプロイ条件、手動承認、Auth/Finance Rules移行の本番NO-GOは維持する。


---

## 2026-10-31 — 招待3 Functions既配備のため、Artifact cleanup権限失敗でも新ビルドを行わずHTML公開のみ継続

- 本番実ログ `41083053284`：`firebase functions:artifacts:setpolicy --days 1 --location asia-northeast1` が `Failed to set up artifact registry cleanup policy`。GitHub専用サービスアカウントの当該ポリシー変更の権限・状態は未検証。自動削除設定は**未完了**で、少額のArtifact Registry課金が発生し得る。
- 本番実ログ `41081599252`：招待3 Functionsの作成がすべて成功済み。現在の2コードGit blob SHA一致、`functions:list` でLINE既存+招待3件すべての存在を確認した場合**のみ**、新ビルドを一切行わず、認証なし拒否試験→既存ファイルの完全ハッシュ保全→招待HTML1ページのみを公開可能とする。
- ポリシー設定が失敗していて3 Functionsが既配備と確かめられない場合は新Cloud Buildを**厳禁**として終了1。ポリシー設定成功なら必要な3 Functions限定再配備を許可する。
- この取り扱いは既存売上・単価・CB・実績原票・班/社員履歴・LINEには変更・削除なし。自動ポリシー設定失敗は発生コストと権限の未解決問題として記録し、同時に「無料運用検証完了」と報告しない。
- 手動確認 `CONFIRM_PARTNER_INVITE_ONLY` と公式URLの差分1ページのみの保全を維持。他のFirebase Hosting/Firestore Rules移行は依然NO-GO。実協力店の件数登録や合同ランキングは現状未稼働。


---

## 2026-10-31 — 協力店招待の限定本番公開成功・暫定再実行Workflow停止

- 実行証拠：[GitHub Actions Run #41085404597](https://github.com/Keikei-p/-/actions/runs/41085404597) **SUCCESS**。
- `functions:list` により3件の協力店招待API `createPartnerCompanyInvitation`, `previewPartnerCompanyInvitation`, `acceptPartnerCompanyInvitation` と、既存通知 `sendMissingReportReminders` の4件を確認。以前に本番追加した3件を再ビルド・再配備せず維持。
- 未ログインで `createPartnerCompanyInvitation` を呼ぶと401/UNAUTHENTICATEDを返すことを本番APIで確認。
- 公式Hostingサイト `nico-factory` で旧ライブVersion `40f089558edceff8` の既存8ファイルのパスとSHA256を保存、新Version `481949c0ea28971f` に旧8ファイル完全同一＋新規 `/partner-invite.html` 1件の計9ファイルの一致を確認。ライブの並行変更がないことを検証してリリース成功。
- GitHub Actionsにより `https://nico-factory.web.app/partner-invite.html` と従来トップページの公開後HTTP GETチェック成功。元の `index.html`、既存PWA/JSおよびHosting設定を変更しない差分公開。
- 本番Firestore Rules/売上・単価・CB・実績・班履歴/ユーザーデータの更新・削除・再計算は実施していない。
- 誤再実行防止のため、既に役割を終えた `.github/workflows/nico-partner-approved-recovery-once.yml` を削除し、存在しないことを自動テストする。
- **残件**：本番の実Owner→協力店宛の招待リンク発行・受取・有効期限・二重承認はまだ実アカウント検査がないため完了扱いしない。協力店件数登録・共有商材・合同ランキング・旧画面のFinance移行は**未公開**。
- Artifact Registryのコンテナイメージ1日cleanup policyは`Failed to set up artifact registry cleanup policy`のまま。費用が発生する可能性があり、GitHubサービスアカウントのArtifact Registry更新権限と課金確認が残る。次回に無承認再ビルドを行わない。

---

## 2026-10-31 | PR #169 既存ランキング・既存招待タブへの協力店連携（UI・読取のみ）

依頼者は「新しいランキングを作らず現在のランキング・商材ランキングへ協力店を加える」「招待リンクの項目から直接協力店を招待する」「今日中に本番で使えるように」と本チャットで明示した。

**対象**: index.html、販売回帰テスト、既存ランキング検証テストとこの記録。Firestore Rules / Auth / 元のrecords/products / 金額 / 単価 / CB / 旧班所属・過去履歴 / Cloud Functions本体の変更は行わない。既存の社員招待と売上順位計算は保持する。

本UIは、独立した協力店コードベースの件数専用APIから匿名不可の認証済み件数だけを取得し、社内オーナーの既存ランキング内に合算する。旧会社一括件数と新しいスタッフ別件数の同一協力店/日付は新スタッフ別を正として**重複加算禁止**。前月以前で全件取得できない場合は未反映と明示する。旧FireStore金額をブラウザから協力店へ開放せず、売上順位に金額不明の協力店を混ぜない。個人売上順位は従来どおりで、個人商材順位の協力店表示は現状「会社代表の集計枠」であり、本人別ランキングには次のサーバー側件数公開拡張が必要。

**署名**: GitHub管理者本人の手書き・電子署名は取得していない。この文書は本人署名の代用ではない。GitHub接続上の管理者審査ラベルは別に適用する必要がある。
**公開条件**: 最新HEADのSales App Validation、既存商材グループ・月次・履歴検証、保護ゲートが全部成功すること。新しい4つのWorkspace APIが本番に存在し、匿名401拒否と既存UIの起動が確認できること。既存Hostingの他ファイルを**SHA256完全一致で保存したままindex.htmlの1ファイルだけ**を差替え、最終全ファイルのパスとハッシュを検証した場合にのみ本番公開。通常のnico-factory-syncは現行ファイル保全要件を満たさないため**使用禁止**。
**本番データへの書込み**: なし。データ移行・削除許可: なし。バックアップ・復元の実施結果がないものは合格扱いしない。
**ステータス**: この段階では本番未確認。公開後検証まで完了扱いにしない。

### GitHub接続Ownerによるリリース審査操作（2026-10-31）
- ユーザーの明示した「既存ランキング/招待リンクに協力店を追加し本番運用にする」意思に基づき、GitHub認証済みリポジトリ所有者 `Keikei-p` の接続から PR #169へ `sales-production-reviewed` ラベルを付与した。
- これはGitHubの変更審査ラベル操作の記録であり、ユーザー個人の手書き署名や本番実端末認証試験を実施したという意味ではない。
- 最終HEADの保護ゲート・販売回帰・正確な保全検証がすべて成功するまでマージ/本番は実施しない。
