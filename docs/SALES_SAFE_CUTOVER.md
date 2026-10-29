# 本番保護・NICO公式URL単独運用 / 安全切替手順

## 絶対条件
- **正式運用URLは https://nico-factory.web.app/ のみ**。以前のGitHub Pages URLはもう利用しない。旧端末やブックマークが残る場合の安全な利用停止は別手順で確認する。
- 正式運用URLは既存Firebaseプロジェクト `sales-management-cc116` のFirestore/Authを参照。Firebaseデータの自動移行は行わない。
- **現在のFirestoreドキュメント・商材・単価・全件数・過去実績・売上・社員権限を編集しない。**
- `finance-locked.rules` は候補であり、本番 `firestore.rules` には自動反映しない。
- Firebase Rulesの本番更新は手動実行＋明示的な入力を要求。元データのアクセス拒否だけ先に適用しない。
- Codexは `AGENTS.md` に従いDraft PRで開発。Codexに本番Secretとデプロイ権限を付与しない。

## フェーズ
1. コード静的検査・匿名のEmulatorテスト（ローカルまたはGitHub Actions）
2. 新安全APIの認証／単価計算／代理入力／重複防止／履歴維持／訂正監査まで実装
3. NICO公式URLだけで新版クライアント・認証・件数登録が動くか検証。古いページを使っている端末がないか切替前に確認
4. 移行後の公開用*新規*ドキュメントを本番正本から別に作る場合、元データは read-only で取り込み、件数・ID・日付・所属・報告状態を照合。金額は未許可者への書き出し禁止
5. 本番データの安全なバックアップ可否を確認。課金が必要な場合は承認なく有料サービスに切り替えない
6. Master/Owner、従来許可済みLeader、売上のみ許可、単価も許可、完全未許可、停止中、他社の各ケースをテスト
7. iPhone・Android・PCでNICO公式URLを検証。旧PWAのインストールや古いブックマークが残っている端末を確認
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
- NICO公式URLの版確認・PWA更新・認証・入力・修正テスト。旧URLの動作を正式リリース条件にはしない
- 全変更ファイルのdiffと復旧手順
- Ownerによる本番切替承認と、Firebase無料枠内の費用確認

## 2026-10-29 公式URL単独化とデプロイ停止ゲート（Draft）
- 本番URLは `https://nico-factory.web.app/` のみ。旧GitHub Pages URLが公開されたままの場合は、個別に利用停止または安全な転送を検証する。旧URLへFirestore Rulesの穴が残らないことも必要。
- **Hostingのmain push自動公開を停止**し、`workflow_dispatch` と明示文字列 `CONFIRM_NICO_HOSTING_RELEASE`、mainブランチの両方が成立したときだけ新URLへ公開する候補。
- Firestore Rulesの確認文字列を `VERIFIED_NICO_URL_AND_DATA` に変更する候補。どちらもPRブランチでは本番公開されない。
- これらの変更が承認される前に手動公開を行わない。協力店向け財務分離・本番全件バックアップ/隔離復元・実端末テストが完了するまで実績アプリの新UIは公開不可。
- GitHub Pages側の公開停止、DNS/認証許可ドメイン変更、本番Firestore変更はこのPRでは一切行わない。
