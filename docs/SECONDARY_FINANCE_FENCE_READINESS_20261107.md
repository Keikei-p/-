# 協力店兼務アカウントの旧社内金額閲覧防止 — 本番切替前の安全検証（2026-11-07）

## 最新mainで確認した具体的な原因

- 本番 `firestore.rules` の `isCompanyMember(companyId)` は**旧社内ユーザーと旧社内memberの有効状態・会社区分**を見るが、別の `partnerWorkspaceContexts/{uid}` にある **activeなpartner_secondary所属**を確認しない。
- そのため、会社に兼務する協力店メンバーが旧自社ログインを残すと、単価/売上フラグをfalseにしても、`products` `records` `recordCorrections` のGET/LISTを取得できる経路がある。これは既存の本番ソースでのEmulator回帰で実証済み。
- `revenueGoals` には別条件もあるが、協力店兼務が売上許可を引き継いだ場合に備え4原票まとめて検証する。
- 一般的な取引先（会社区分partner）へのアクセスは現在の `isCompanyMember` で拒否される。**旧社内にも現在有効な兼務アカウント**が主な漏えい経路。

## 今回の開発候補（NO DEPLOY）

- `security/secondary-finance-read-fence.mjs`：ソースのGit Blob SHA `d9f4df6a2ac0f8b5720534a2461ec66b94379190` に完全一致したときだけ、4原票の `allow read` と既存の `allow create/update`、`records` の未作成文書GETに、**サーバー保存のactiveなsecondary contextによる拒否**を追加する候補Rulesを生成。協力店兼務UIDによる金額原票の直接書込も拒否する。
- 前提が一致しないRulesや、対象外のパス変更は安全停止。実際の `firestore.rules` や `firebase.json` を変更しない。
- `tests/secondary-finance-read-fence-emulator.test.mjs`：架空のOwner（継続閲覧）、旧社内一般社員（許可済み閲覧と旧社内実績の通常作成）、協力店兼務（4原票GET/LIST拒否＋金額原票直接作成拒否）、不正確な兼務マーカー（安全停止）、既存原票の完全保持、非金額チーム閲覧をEmulatorで確認。
- **修正した潜在バイパス**：従来の候補Rulesが `active=true` かつ `kind=internal` の不正な兼務コンテキストを拒否対象から外していた。さらに `active` が文字列や欠落していると否認されないケースがあった。今回 `partnerWorkspaceContexts/{uid}` が存在し、`active` が**明示的なBoolean falseでない限り**旧自社の金融4原票を拒否する候補へ修正。Ownerや通常社員には副業コンテキストがなければ影響なし。意図的な `active:false` は引き続き遮断しない。Emulatorで malformed-kind、string active、active欠落の全ケースを検証する。
- **本番のrecords新規作成のRulesは変更しない**。候補では旧社内通常社員の作成を保持しつつ、兼務協力店UIDの旧社内金額原票への直接書込も拒否する。旧社内recordsの読み書きに頼る古い入力画面は使えなくなる可能性がある。既存の件数専用Callableは独立したサーバー経路で、オフライン回帰は確認するが、**本人の実端末で件数の新規保存・訂正を実証するまでは本番公開禁止**。
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

## 2026-11-08 追補：金融原票の直接書込も封鎖する候補

- 本番コードは変更せず、エミュレータ限定の候補Rulesを強化。対象は `products`・`records`・`recordCorrections`・`revenueGoals` の既存read/create/update許可と、`records` の未作成GET許可。削除は元から禁止のまま。
- 合成ユーザーの兼務状態では金融原票のGET/LISTと旧自社records直接作成を拒否。非兼務の内部社員の既存入力・自社Ownerの閲覧は継続。
- 既存の件数専用Callableに対して新規入力・訂正のオフラインテストを追加。実アカウントの確認は未完了であり、**本番Rulesを更新する承認ではない**。
- `firestore.rules`、`firebase.json`、`functions-partner-workspace`、`index.html`、Hosting、売上・単価・CB・件数・履歴は一切変更しない。
