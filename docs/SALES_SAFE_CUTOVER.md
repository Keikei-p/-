# 本番保護・新旧URL並行稼働 / 安全切替手順

## 絶対条件
- 新URL https://nico-factory.web.app/ と旧URL https://keikei-p.github.io/-/ は双方継続。
- 両URLは一つのFirebaseプロジェクト `sales-management-cc116` と同じFirestore/Auth。
- **現在のFirestoreドキュメント・商材・単価・全件数・過去実績・売上・社員権限を編集しない。**
- `finance-locked.rules` は候補であり、本番 `firestore.rules` には自動反映しない。
- Firebase Rulesの本番更新は手動実行＋明示的な入力を要求。元データのアクセス拒否だけ先に適用しない。
- Codexは `AGENTS.md` に従いDraft PRで開発。Codexに本番Secretとデプロイ権限を付与しない。

## フェーズ
1. コード静的検査・匿名のEmulatorテスト（ローカルまたはGitHub Actions）
2. 新安全APIの認証／単価計算／代理入力／重複防止／履歴維持／訂正監査まで実装
3. 旧コードが新サーバーに依存せず、両URLで同一内容が公開できるように調整
4. 移行後の公開用*新規*ドキュメントを本番正本から別に作る場合、元データは read-only で取り込み、件数・ID・日付・所属・報告状態を照合。金額は未許可者への書き出し禁止
5. 本番データの安全なバックアップ可否を確認。課金が必要な場合は承認なく有料サービスに切り替えない
6. Master/Owner、従来許可済みLeader、売上のみ許可、単価も許可、完全未許可、停止中、他社の各ケースをテスト
7. 実機iPhone・Android・PCで両URLを確認。旧PWAキャッシュを使った遷移も確認
8. **入力・閲覧双方の新方式が本番で動き、元データ一致証拠が揃って初めてSecurity Rules候補の適用を検討**
9. 失敗したら本番切替停止。データを書き戻したり推測で補正したりしない

## 現在の意図的な制限
- `cloudflare-finance/src/index.js` のFinance Gatewayは「read-only基盤」まで。
- `cloudflare-finance/src/write-plan.js` は件数入力と履歴単価維持の純粋関数。**実際の安全な書込API、競合制御、同日重複防止、本番移行・DB照合は未完成**。
- 現在の旧SDKは `products`, `records` の金額付きドキュメントを直接購読する。**本番Rulesの早期適用は禁止。**
- Firestoreの単一ドキュメント内のフィールドだけをFirestore Security Rulesで非表示にすることはできない。非金額の公開用ドキュメントなどへ分ける。
- 並行URL維持は可能だが、旧ブラウザ内にキャッシュ済みの金額をサーバーから削除することはできない。以前取得した金額は回収不可能。
- 既存データと請求プランが最新状態で保護されているか、Firebase実環境に対する検証は別途必要。

## GitHubで管理者が必要な設定（※まだ自動設定されていない）
`Settings → Branches` または `Settings → Rules → Rulesets` で `main` に対して：
- Require a pull request before merging
- Require status checks before merging: `Sales App Validation / validate` と `Sales app protected change gate (read-only) / protected-change-guard`
- Block force pushes / branch deletion
- Do not allow bypass by Codex/bots. Solo開発なら必須review人数を付けると自己PRを承認できないので、管理者が手動マージを行う
- 本番SecretsはCodex用・PR用の環境に許可しない。GitHub Appにmain直接push権限を渡さないのが理想

注：GitHubルールセット／ブランチ保護はリポジトリの管理画面の実設定が必要。
チェックがあるだけでは必須にならず、直接mainへpushできる人を防げない。

## 本番切替前に記録すべきもの
- 旧データの件数／売上／単価ハッシュ一致確認結果（秘密値のログは保存しない）
- 許可済みユーザーの売上表示範囲、権限なし社員のSDK直接GET拒否
- 新旧URLの版一致、旧PWAキャッシュの動作、入力・修正テスト
- 全変更ファイルのdiffと復旧手順
- Ownerによる本番切替承認と、Firebase無料枠内の費用確認
