# NICO 営業実績｜本番切替の自動安全ゲート（2026-10-30）

## 現在の判定
**現行 `main` の正式Hosting版への一括公開はSTOP**。理由はバックアップの有無ではなく、同じ会社に属する協力店等が金額付きの `records/products/recordCorrections/revenueGoals` をFirebaseから読める旧Rulesと、旧画面の直接購読・書込が残るため。

- 公式URL `https://nico-factory.web.app/`。旧GitHub Pages URLは再採用しない。
- `scripts/nico-production-cutover-preflight.mjs` は**読取専用の静的検査**。本番Firestore・Auth・Rules・Hosting・LINEに接続しない。
- `.github/workflows/nico-factory-sync.yml` は手動実行・確認文字列を維持。追加ゲートにより、Firebase認証情報をファイル化する**前**に、危険な旧Rulesと旧画面参照を検出したら停止する。
- この検査がPASSしても、本番のFirebase Auth/Rules権限・件数APIの同期・全件バックアップと隔離復元・端末検証・費用確認がPASSした意味ではない。

## 本番配備の順序（既存の原票と履歴は一切変更しない）

1. オーナー側で既存バックアップの**全件**（実績・CB・単価・履歴・Auth/設定）を隔離環境へ復元し、原票IDと件数・金額・班履歴の一致を記録。バックアップ保管元は変更しない。
2. 承認済みの社内／協力店の各ロールで、Firebase ID tokenと最新所属を確認する本番APIを準備し、件数の新規・訂正・閲覧を**本番切替前にテスト環境**で実演する。会社・班別の権限・非表示商材を確認。
3. クライアントの旧 `records/products/recordCorrections/revenueGoals` の直接読取・直接書込を、権限付きの件数専用／財務専用APIに移行。過去の金額・当時単価・CB・実績IDを上書きしない。
4. 協力店、社内オーナー／リーダー／一般、無効会員、別会社の権限行列をFirestoreエミュレータと実機で検証。古いPWAは失効/更新を確認する。
5. 安全なFinance Rulesへ手動切替後、直接金額原票が協力店・一般会員から403相当の拒否となり、社内の承認済み機能だけが正常稼働するのを確認。
6. 最後に手動Hosting公開。LINE通知・Workers課金フラグは別途検証するまでOFF。問題があれば機能公開を停止し、原票の削除・手動での再計算はしない。

## コマンド（ローカル/Actionsの安全な静的監査）

```powershell
node --test tests/nico-production-cutover-preflight.test.mjs
node scripts/nico-production-cutover-preflight.mjs --json
```

現在は後者が `BLOCK` で終了コード2になるのが正常（事故ではない）。

※ このゲートを無効化したり、`release_confirmation` だけを理由にFirebaseの原票権限を迂回・公開しない。
