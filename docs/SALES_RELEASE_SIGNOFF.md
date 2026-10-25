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

# 手動商材ランキング｜第1段階 Firestore Rules先行リリース（2026-10-25・管理者未署名）

関連: https://github.com/Keikei-p/-/pull/88
目的: 新ランキング画面公開前に、会社Ownerだけが \`companies/{companyId}/settings/ranking\` の「表示グループ設定」を書き込めるよう準備する。既存records/products/teams/単価/CB/既存settingのアクセス権は変更しない。

- [x] Firestoreルール差分はsettings/rankingに対するowner-only create/update許可15行のみと機械照合済み
- [x] 追加予定のエミュレータテストに、owner書込・その他ロール拒否・他社拒否・余計な金額フィールド拒否を含む
- [ ] このRules単独PRの最新HEADで Sales App Validation / Firestore Emulator 成功を確認
- [ ] 実データの暗号化バックアップと検証済み復元手順・データ全件保護証拠
- [ ] Firestoreの利用枠・料金条件、前後の権限・新旧URLの互換性確認
- [ ] 管理者による差分レビュー、**本人署名**と \`sales-production-reviewed\` ラベル
- [ ] 本PRをmainへマージした後、管理者が「Firebase Rules Deploy (Zero-Cost)」を明示実行、成功確認
- [ ] 新旧URLの既存機能と商材実績入力に影響がないことを確認
- [ ] これら完了後、**別PR #88の画面部分のみ**の公開準備と確認へ進む

この記録は管理者署名ではなく、未確認条件を合格扱いしない。**本番デプロイ承認前はDraft・マージ禁止**。

署名者: 未署名
公開ステータス: 未反映
