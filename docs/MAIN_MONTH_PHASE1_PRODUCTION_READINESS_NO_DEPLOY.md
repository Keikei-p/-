# NICO 月別合同ランキング + Phase-1金額遮断 本番準備判定（NO DEPLOY）

対象: GitHub `Keikei-p/-` / Firebase `sales-management-cc116` / https://nico-factory.web.app/

## 現時点の実測と区別

- PR #401: 本家main起点の月別班・担当者・商材、合同個人・商材暫定ランキング、公開ON/OFFと追加商材の件数。Draft、未本番。
- PR #380: 既存の自社金額を保護する候補Rulesと実UID財務遮断の安全ゲート。Draft、未本番。
- PR #403: PR #401 HEAD `3372630b67c2a94346ae1ae76a7fe03739e86774` にPR #380の候補Rules `6d6ac7fd3544b0326823e419a3acd7e1d060b714` とRulesテスト `0292ea176ad67e6486cd9fd1a0d08dc18a3317cd` を合わせた検証専用ブランチ。
- Actions #42201902961: 合成・回帰 198 PASS、Firestore Emulator 59 PASS、合計257 PASS / 0 FAIL。
- **Emulator成功は本番Rules切替・実UID GET/LISTの証明ではない。**

## 本番に触れる前の停止条件（すべて必須）

1. 独立した管理者が候補Rulesの正確な内容、差分、権限影響、復旧計画をレビューし、所定の保護ゲートと署名付き承認を記録する。CIの成功だけで承認としない。
2. 最新の管理FirestoreバックアップがREADYであることを対象プロジェクトとDBで確認。完全な読み取り専用インベントリを2回取得し、文書ID・型付き全フィールドのダイジェスト一致を確認。隔離環境での復元テストに合格。過去の390文書復元結果だけでは最新の保全証拠にならない。
3. 自社Ownerと、旧自社所属が残る**対象の協力店UID**を、信頼できる管理者読み取り専用経路で所属と共に照合。無関係の協力店アカウントの403で代用しない。
4. 本番旧Rules下でOwnerが既存 `products.revenue` と `records.totalRevenue` をGETおよび会社別LISTで読めることを、**本人のFirebase Auth IDトークン**で証明。管理者OAuth/SDKはRulesをバイパスするため代用不可。
5. 切替直前に対象協力店の会社コードログイン・自分の件数閲覧を実アカウントで確認。既存の件数保存・修正・LINE・金額計算の現行動作を維持。対象者の所属を削除・移行・データ初期化しない。
6. 候補Rulesを隔離Emulatorで実UIDの所属構造を模したテストに合格させる。実本番切替は**Rulesだけ**に限定し、Hosting・Functions・Auth・データを変更しない。
7. 切替直後、対象の協力店本人のIDトークンで自社原票・単価のGET/LISTが403、OwnerのGET/LISTが200、協力店の件数閲覧が成功することを確認。不合格なら他のオペレーターが変更していないことを確かめて自動ロールバック。並行変更があれば安全停止。
8. 公開後、Ownerの金額表示・CB計算、協力店の件数入力、既存履歴・ランキング・LINEとFirestore全件インベントリを確認。ランキング/UIはRules切替と**別の公開判断**にする。
9. Issue #352: 過去の自社保存実績1件の総件数と明細の不一致を調査。原票は自動修正しない。未照合の合同順位を確定値や0件として表示しない。

## 取り扱い禁止

- 本番資格情報・IDトークン・Cookie・メール・実文書ID・売上金額をChatGPT、PR、GitHub Actionsログに貼り付けない。
- 本番データ、過去の件数、金額、CB、単価、班履歴、Auth、LINEの削除・初期化・上書きを行わない。
- 旧Actionsの固定SHA保護を緩めない。
- このDraftのmergeやEmulator合格を本番承認として扱わない。

**判定: 統合候補の合成・Emulatorテストは合格。本番の実アカウント財務遮断・最新バックアップ・独立承認は未完了。PRODUCTION_APPROVED=false / DEPLOYED=false。**
