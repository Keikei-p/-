# 協力店リーダー｜安全な受け入れ準備（開発専用・2026-10-27）

## 現状
この変更は `feature/secure-finance-gateway-20261022` に積む**開発用の追加PR**です。本番Firebase `sales-management-cc116`、GitHub Pages、Firebase Hostingには一切反映しません。協力店の招待・ログインを本番で開始しないでください。

本番の従来 `firestore.rules` は会社所属者に `products`・`records`・`recordCorrections` の金額込み生データ読取りを許容します。従来アプリに協力店を招待すると情報漏洩につながります。**画面非表示だけでは保護できません。**

## 権限の不変条件
- 新規協力店はメール確認済みの同一会社所属・role=`leader`・companyRole=`member`・チームが一意に指定済みである必要があります。
- 協力店として登録するとき、サーバー管理者が **users/{uid} と companies/{cid}/members/{uid} の双方に `accessKind: "partner"`** を付けます。片側のみに存在する場合も、より厳しい協力店制限を適用します。
- 協力店の `teamId` は users と members の双方で一致させます。不一致・班未割当・owner/master混在はアクセスを拒否します。
- 協力店には revenue/unitPrice 両方の取得を**サーバーで永久拒否**します。たとえ既存の閲覧フラグを誤操作して `true` にしても、協力店の区分がある限り拒否します。
- 協力店向けAPIは現在の所属班だけの件数・実績を返し、他班の氏名・実績ID・件数を返しません。新規/訂正入力も、現在の所属班のメンバーが対象の場合だけ許可します。班移動時の代理計上はOwnerが処理します。
- Firestore生データの金額付きドキュメントは**安全版Rulesでのみ**制限しています。これだけ先に本番投入すると従来アプリが故障するため、単独公開を禁止します。
- Master/Ownerや既存社員の本来の権限・既存records/products/CB/履歴/件数は変更しません。

## 隔離環境での試験手順
1. 本番と異なる `demo-` のエミュレータで安全版Rulesとテストを実行する。実ユーザー情報は使用しない。
2. 協力店役の架空ログインを作成。会社/班の紐付けを双方の書類に設定して `accessKind: "partner"` を管理者側から付与する。
3. 協力店が自班の件数を閲覧・登録でき、他班のID・件数・名前を閲覧/登録/訂正できないことを確認する。
4. `canViewRevenue`/`canViewUnitPrice`/`canCreateInvite` を誤って true にした検体でも、金額・商材単価・CB収益・社員の生ドキュメント・他班の記録を取得できないことを確認する。
5. Owner/Master・既存許可済社員が従来の閲覧範囲を維持することを確認する。
6. `node --test cloudflare-finance/tests/*.test.mjs`
7. `firebase emulators:exec --project demo-finance-staging --only firestore "node --test cloudflare-finance/tests/finance-locked-rules.test.cjs"`

## 本番導入までに必要（未完了）
- [ ] 招待時の協力店指定を、認証済みOwnerだけが操作できるUI/サーバー処理にする。従来の招待だけでは `accessKind` は付かない。
- [ ] 協力店用フロントエンドで旧SDKの金額付きコレクション読込みを**完全停止**し、Gateway経由に統一する。
- [ ] 協力店画面に「自班のメンバー一覧」を安全に提供し、実際の代理入力を確認する。
- [ ] ユーザー/班移動時の既存実績、ゼロ報告、訂正競合、売上再計算を本番に触れずに試験する。
- [ ] Finance GatewayのCloudflare Secret、費用、権限、Worker URLを確認する。初期の公開/書込/課金承認スイッチはOFF維持。
- [ ] 本番DBの成功済みバックアップ、隔離復元、実績全件一致、Firebase Auth等の保全を実証する。
- [ ] 新旧URL・古いPWAキャッシュ・iPhone/Android/PC・Owner/Leader/Partnerログインで受け入れ試験。
- [ ] 明示的な本番切替承認、事前レビューと保護ゲート通過。

**現時点で協力店に本番用アカウントを発行しないこと。**
