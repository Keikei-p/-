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
