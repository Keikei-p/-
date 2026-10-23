# 売上計算コード修正 本番リリースレビュー記録（2026-10-23）

## 対象
- Pull Request: #84（`fix/revenue-core-tested-release-20261023` → `main`）
- Firebase project: `sales-management-cc116`
- 旧URL: https://keikei-p.github.io/-/
- 新URL: https://nico-factory.web.app/

## 依頼者からの指示
2026-10-23、プロジェクト会話で売上計算の修正と本番反映を依頼された。ただし**この会話はGitHub上での管理者署名、Firebase実データ照合、公式バックアップの証拠の代わりにはならない**。

## 今回の変更範囲
- `index.html`: 過去のCB額を売上単価として扱う誤処理を削除。売上は件数×売上単価のみ。CB別単価未確認なら入力を止め、過去の保存済み単価を通常入力で勝手に上書きしない。明細合計を保存前に検算。
- `tests/sales-regressions.cjs`: 電気5件×¥10,000＝¥50,000、NURO光のCB別単価、未設定、整数、履歴単価の不変性をテスト。
- `docs/SALES_RELEASE_SIGNOFF.md`: 本レビュー記録。
- Firestoreデータ、Firebase Security Rules、Cloud Functions、ユーザー、班、商材、金額スナップショット、両URLの設定は**このPRから一切書き換えない**。

## 自動検証
- PR #84 変更前HEAD `fa01437b354f7d9265e52e840f83fee9ed98ace8` の検証：
  - Sales App Validation: 成功 https://github.com/Keikei-p/-/actions/runs/39906810711
  - sales-production-reviewed 未適用／リリース記録不足のため保護ゲートは意図どおり失敗 https://github.com/Keikei-p/-/actions/runs/39906810681
- **本ファイル追加後のHEADで改めてCIおよび保護ゲート結果を確認すること。**

## 未完了事項（完了したことにしない）
- [ ] 本番Firestore `records`, `products` の実データを照合（機密値はログに残さない）
- [ ] 現行データの保護バックアップの実在と復元可能性を確認
- [ ] 新旧URLの認証ユーザー別表示と既存PWAキャッシュの実機確認
- [ ] GitHub 管理者が差分と本レビューを読んだ上で `sales-production-reviewed` ラベルを付与
- [ ] GitHub 管理者が実際の署名と公開承認を記入
- [ ] マージ後にGitHub PagesとNICO Hostingのデプロイ成功と両URLの動作確認

## 重要：旧保存レコードを自動訂正しない
既存の「5件なのに¥10,000」は過去に保存した単価が誤っている可能性があり、この変更だけでは過去売上は¥50,000に変わらない。過去データの書換は別のオーナー権限付き履歴訂正の明示確認と、バックアップ／復旧確認が必要。絶対に自動一括修正しない。

## 人間の管理者による公開サイン（未記入）
- 承認者（GitHub管理者）: **未記入**
- 承認日: **未記入**
- 本番データ・両URL確認記録: **未記入**
- リリース承認: **未承認**

**このファイルをAIが作成したこと自体を、オーナーによる本番承認済みとは扱わない。**
