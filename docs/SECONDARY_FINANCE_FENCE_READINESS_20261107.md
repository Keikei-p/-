# 協力店兼務アカウントの旧社内金額閲覧防止 — 本番切替前の安全検証（2026-11-07）

## 最新mainで確認した具体的な原因

- 本番 `firestore.rules` の `isCompanyMember(companyId)` は**旧社内ユーザーと旧社内memberの有効状態・会社区分**を見るが、別の `partnerWorkspaceContexts/{uid}` にある **activeなpartner_secondary所属**を確認しない。
- そのため、会社に兼務する協力店メンバーが旧自社ログインを残すと、単価/売上フラグをfalseにしても、`products` `records` `recordCorrections` のGET/LISTを取得できる経路がある。これは既存の本番ソースでのEmulator回帰で実証済み。
- `revenueGoals` には別条件もあるが、協力店兼務が売上許可を引き継いだ場合に備え4原票まとめて検証する。
- 一般的な取引先（会社区分partner）へのアクセスは現在の `isCompanyMember` で拒否される。**旧社内にも現在有効な兼務アカウント**が主な漏えい経路。

## 今回の開発候補（NO DEPLOY）

- `security/secondary-finance-read-fence.mjs`：ソースのGit Blob SHA `d9f4df6a2ac0f8b5720534a2461ec66b94379190` に完全一致したときだけ、4原票の `allow read` へ **サーバー保存のactiveなsecondary contextによる拒否**を追加した候補Rulesを生成。
- 前提が一致しないRulesや、対象外のパス変更は安全停止。実際の `firestore.rules` や `firebase.json` を変更しない。
- `tests/secondary-finance-read-fence-emulator.test.mjs`：架空のOwner（継続閲覧）、旧社内一般社員（許可済み閲覧）、協力店兼務（4原票GET/LIST拒否）、不正確な兼務マーカー（安全停止）、既存原票の完全保持、非金額チーム閲覧をEmulatorで確認。
- **既存のrecords新規作成のRules条件は変更しない**。ただし、読み取りを遮断すると旧社内recordsを読んでから保存・訂正する古い画面が正常に動かなくなる可能性があるため、実機での入力継続を実証するまでは**本番公開禁止**。
- No Deploy CIでは本番秘密鍵・Firestore API・既存データへ接続しない。デモEmulatorのみ。

## 本番解決に必要な順序

1. **ユーザー本人の3メールで既存診断ページ**を実行。現行自社Ownerが4原票をGET/LISTで閲覧できること、兼務協力店3件の状態と既存ログイン・件数画面の状態を確認。診断ページは `https://nico-factory.web.app/finance-boundary-four.html`。パスワード・UID・メール・金額や原票IDをこのチャットに送らない。
2. 既存の `staging/partner-primary-handoff/handoff.cjs` は、本人が明示同意した場合にのみ「旧member停止+旧context停止+現ユーザーを協力店へ移行+元ユーザー/メンバー/旧contextの監査アーカイブ」を同一Transactionで処理する候補。既存の4原票・金額・売上・件数履歴を触らない。現時点では未配備。
3. 自社側の本人が移行すると、**旧自社実績を読むUIは使えなくなるのが正常**。協力店の件数入力・訂正が、同じAuth UID・既存データを維持して動くことを実ユーザー・実機で確認する。
4. 修正版Rules候補の **本番read先行遮断と既存入力の可否**、金額以外の会社管理・招待・ログインを個別検証する。全社一括適用や旧原票削除は行わない。
5. 最新READY管理バックアップの整合性と別環境への実復元、独立レビュー/署名、費用上限、実UID GET/LIST本人検証が揃ってから小範囲の正式権限切替を判断。前回の422文書のEmulator復元はライブ取得スナップショットの実証であり、READY本体の復元ではない。

## 最終判定

**NO DEPLOY / PRODUCTION_DOCUMENT_WRITES=0 / PRODUCTION_RULES_WRITES=0**。このPRは金額遮断の根本候補を作り、既存入力を壊しうるリスクをEmulatorで明確にするためのもの。合成テストが成功しただけで本番の会社/元原票権限を変更しない。

**現在本番の営業実績・売上・単価・CB・旧履歴・件数入力は維持する。**
