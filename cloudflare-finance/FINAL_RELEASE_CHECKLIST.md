# 営業実績アプリ｜金額漏洩を止める本番リリース判定票（2026-10-22）

## 作業状況
- 現行: `https://nico-factory.web.app/` と `https://keikei-p.github.io/-/` は同じFirebase `sales-management-cc116` を使用し、会社で通常利用中。
- 現行本番の `index.html` と `firestore.rules` は、この開発ブランチから**一度も更新しない**。
- 新社員の初期設定は画面では `canViewRevenue=false`, `canViewUnitPrice=false` でも、本番Rulesの `products/records/recordCorrections` は同じ会社の社員に元データの直接読み取りを許すため、**現時点の漏洩リスクは解消されていない**。
- 開発版の `cloudflare-finance/finance-locked.rules` と `cloudflare-finance/src/index.js` で、未許可者の生データ読取を拒否し、許可済みの売上/単価だけ返すAPIを実装・エミュレータで検査。
- `cloudflare-finance/preview/index.html` は `SAFE_FINANCE_CUTOVER=false` / Gateway URL空欄に固定。**未公開**。
- ユーザーがFirestore日次・7日保持を設定したが、最後のスクショでは**作成済みバックアップ0件**。本番バックアップの存在、復元試験、全件照合は未確認。
- Firebaseはユーザー申告でBlaze。有料プランは無制限の無料ではない。Cloudflare Workers/Firestoreの料金設定と正式な費用承認は未確認。

## 本番前の必須チェック（未確認は☐のまま）

- [ ] Google Cloud Firestore `(default)` で成功済みバックアップの作成時刻・サイズ・保持期限が実在
- [ ] 別DBへの隔離復元テスト、および実績ID/日付/社員/班/商材/件数/単価/売上/監査履歴を**秘密情報をログに残さず全件照合**
- [ ] Firebase Auth / Firestore Rules / Storage / 会社設定と招待情報について、Firestore標準バックアップ対象外も保全
- [ ] OwnerがBlaze/Cloudflare Workersの使用量・利用料金・IAM・Secret取り扱いを承認
- [ ] 全CIが最新の開発コミットで成功：`Test protected-finance gateway (NO deployment)`、`Sales App Validation`、`Sales app protected change gate`
- [ ] Owner/Master、明示許可済み社員・Leader、売上のみ許可、単価まで許可、未許可一般社員、新規未招待、他社、退職者を**隔離環境＋両URLの実機**で検証
- [ ] 実績新規登録、代理入力、当日/過去訂正、重複/同時保存、ゼロ報告、商材作成/編集、ランキング、報告、履歴ID/班の不変を確認
- [ ] iPhone/Android/PCで、旧PWAのキャッシュ済みバージョンを含め、金額読取拒否でも安全版が入力・閲覧できると確認
- [ ] 新旧URLの静的アセット一致・Service Worker更新・Rollback手順・管理者の作業時間を確認
- [ ] Ownerが最終の本番切替を承認（バックアップと受入試験の実証前に書込ゲート/本番Rulesを変更しない）

## 非破壊の安全な切替順序

1. GitHub PR #73をDraftのまま、上記の**隔離環境で**テストと障害対策を完成させる。
2. Firestoreのバックアップの存在と復元可能性、全件の変化なし、コストと秘密情報の管理を確認する。
3. 新旧URL双方の利用者に同一安全版を配布でき、旧キャッシュの利用者が取り残されない状態を確認する。アプリからのRaw Monetary Firestore SDK読み込みが全経路で行われないことを実機/検証で確認する。
4. Ownerの明示承認後、メンテナンス時間を設け、認証付きAPI・安全版UI・Firestore Rulesを**相互互換が保てる計画**で段階的に変更する。Rulesだけを先に厳しくすることを禁止する。
5. 本番データをテスト目的で編集したり、一括削除・再計算したりしない。異常時は保護ゲートを停止し、原因・漏洩可能性を評価して復旧する。**旧Rulesを自動的に戻すと金額漏洩が再発する**ため、安易なロールバックは禁止。

## 現時点の技術的停止条件

- 認証付きGatewayの実公開URL・Secrets・Cloudflare料金/上限の確認なし
- プレビューは`SAFE_FINANCE_CUTOVER=false`、本番双方の全機能・旧PWA互換実機テスト未実施
- `firestoreQuery`が1コレクション2,000件以上で安全停止し、規模が増えると一覧を表示できない
- 金額非許可者に一度取得された既存キャッシュをリモートで遡って回収することはできない
- 金額を含む旧実績データを削除・加工・修復しないこと

**上記が解消するまで本番Rules変更、公開UI切替、API書込有効化は不可。**
