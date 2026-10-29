# 2026-10-29 / 金額付き原票のFirebase本番公開を安全停止するゲート

## 確認した危険性（現行mainの`firestore.rules`）
- `products`、`records`、`recordCorrections` の `allow read` が `sameCompany(resource.data.companyId)` だけを含み、売上/単価非許可の同じ会社ユーザーにも金額フィールドが届き得る。
- `revenueGoals` は自社owner/財務許可者のみの枝があるが、協力店会社のownerや誤った付与を想定した「companyKind=partnerを必ず拒否」の防御がまだない。
- フロントで隠してもFirestore SDKの権限は変わらない。古いPWAは生データを読み続ける可能性がある。

## 今回安全に追加する対策
- `scripts/check-finance-read-boundary-before-deploy.mjs` は、現在の本番向けRulesから金額原票への直接read/get/listやwrite権限の条件を静的に確認。**現在のRulesでは必ずSTOP**、静的チェックだけではProduction PASSを出さない。
- `.github/workflows/firebase-production-deploy.yml` は、Firebaseへのアクセスや認証情報の保存より**前に**上記静的検査を実行し、不適切なRulesの公開を止める。
- `tests/finance-release-gate.test.mjs` は、現在の危険なルールが拒否されること、閉じた開発用候補でも公開承認にはならないこと、追加のget/list・書込OR・削除の抜け道が拒否されることを架空テストする。
- 開発用候補ルールは `security/finance-phase2-read-boundary.mjs` に既にあり、本番デプロイはしない。現在の `firestore.rules`、過去の実績・単価・CB・所属班・ユーザー・Firebaseプロジェクトは**一切変更しない**。

## 本番公開の不可欠な順番
1. 全件の実バックアップと別媒体保全・Auth/ルール/設定保全。隔離エミュレータに復元してID/件数/売上/CB/保存時単価/班履歴を一致させる。
2. 安全な件数API/訂正・読み取りのGatewayと、新旧PWAキャッシュの切替・権限別の実機確認。
3. Owner・許可/未許可の社内leader/member・協力店Owner/Leader・停止済・他社・未ログインの全組合せで、Firebase Rulesの**エミュレータだけでなく実際の検証環境**のSDK直接read/writeが拒否されることを確認。
4. `firestore.rules`を安全な仕様にしたあとに、静的ゲート・Firebaseエミュレータの両方をPASS。本番ルールの変更は管理者の明示承認だけで手動実行。
5. 旧コードへ単純ロールバックすると金額漏えいが復活するので、元データに触れず安全経路を維持して修復する。

## 限界
- CIの静的検査はルールの安全性を**保証しない**。将来の複雑なOR条件、独立した追加のmatch、実アカウントの誤設定まで完全には判定できない。必ず実エミュレータ+実機検証が必要。
- Firebase Console/CLI等で直接デプロイされた場合、この**GitHub Actions経路のゲートだけ**では停止できない。
- 金額原票の権限が本番で閉じるまでは協力店の招待・件数本番登録・本番新版公開の完了報告をしない。

**今回の変更による本番Firebaseデプロイ/Firestore読み書き・削除: ゼロ。**
