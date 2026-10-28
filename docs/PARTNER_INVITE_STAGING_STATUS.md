# 協力店を別会社として招待／同じ自社商材を共有（開発版・本番配備禁止）

## 今回の画面実装
- 招待リンク作成に**自社メンバー／協力店（別会社）**の選択を追加。
- 従来の「自社メンバー」リンクは **既存のFirestore招待処理を一切変更しない**。
- 「協力店」リンクは**Firebase Callableの新ルート**に限定。ログインユーザーが元の会社の代表オーナーかをサーバーで確認、相手のメール指定、30分失効、暗号乱数トークンをSHA-256で保存（原トークンは保存しない）。
- 受け取りリンク \`?partnerInvite=<token>\` は専用プレビュー・承認関数へ。**既存の\`?invite=<ID>\` に誤ってフォールバックしない**。
- 承認時、相手に既存所属がなければ**別会社IDを新規作成**。所有会社の既存メンバー・実績・単価・料金・班履歴は一切更新しない。招待再利用/既存会社所属/転送メール/期限切れを拒否。
- 協力店の商材管理画面を追加。自社の原本商品名/ID/表示順をサーバーで安全に公開（価格は不可）。独自商材は**非公開で追加**、代表オーナーが商材ごとに共有ON/OFFを設定。
- \`partnerRelations\` の双方承認フラグを受け入れ時に登録。協力店のprivate独自商材は他社へ返さず、公開を選んだ商材でも名称・ID・件数だけ扱う。

## 現状（重要）
これは**本番とは分離したドラフト開発PR**。UIとFunctionsがリポジトリ上で接続されたが、現行FirebaseへのFunctionデプロイ・Rules変更・元データ変更・ユーザー登録・LINE送信は行っていない。

**本番に先行公開してはいけない理由**
- 本番Firestore Security Rulesの \`records/products/revenueGoals/recordCorrections\` にはまだ金額が同居。協力店の所属を切り替えるだけでは金融情報への直接読取を完全防止できない。
- 現行の実績フォームは旧 \`products\` をクライアントから直接取得し、現在の会社の価格マスターを利用する。協力店画面に共通商材を表示できても、**協力店用の件数登録・訂正・ランキング・LINEがこの安全な商品IDに切替わったわけではない**。
- \`partnerRelations\` は新しいコレクション。Firestore RulesとFirebaseトークン検証、承認取消や会社閉鎖・旧PWA利用時の整合も実運用テストが必要。
- 既存のFirebase Functionsを利用するならBlazeの請求/無料枠を検証する。料金プランの切替やFunction削除はしない。

## 最終公開前の条件
1. 実バックアップを隔離復元し、ユーザー/会社/件数/商材/単価/班履歴/訂正ログを完全一致検証
2. 金額のある原票を協力店・未許可一般ユーザーがAPI/SDKで直接読めないSecurity Rules・新しい件数専用登録APIへ一斉切替
3. 新旧URL/古いPWAキャッシュ、iPhone/Android/PC、owner/leader/member/partner、招待・商材追加・公開ON/OFF・件数のテスト
4. 自社と協力店が共通商品マスターの変更を受けても、**保存済み過去実績の単価や記録を絶対再計算/改変しない**ことを全件照合
5. リーダー権限・協力店別会社の財務否認、競争ランキング、LINE朝夜件数合算/商材別合算を同じ安全な件数投影で運用し、古い金額付き生原票をブラウザから読ませない
6. 明示的な本番公開レビューと承認が通るまでGitHub main/Functions/Rulesへ配備しない

開発版のテスト：\`node --test tests/partner-company-functions.test.cjs\` と既存のSales App Validation。トークンや個別売上額はログに出さず、Firestoreモックの架空データで実際のCallable実装を呼ぶ。


## 追加検査と安全対策

- **直接原票への金融権限遮断**: \`security/partner-company-finance-lock.mjs\` は実行環境に適用しない**エミュレータ専用候補ルール**。会社 \`companyKind=partner\` をサーバーが発行し、協力店Owner/Leaderに誤って \`canViewRevenue=true\` と \`canViewUnitPrice=true\` があっても、金額付き \`records/products/recordCorrections/revenueGoals\` のFirestore直接GET/LIST/書込を拒否。既存の一般会社が読める仕様を変えない。
- **画面側の補助防御**: \`index.html\` の \`canCurrentUserViewRevenue\`、\`canCurrentUserViewProductRevenue\`、\`canCurrentUserViewUnitPrice\` とメンバー権限判定でも協力店種別を優先拒否。旧商品のCB/価格エディタを協力店パネルでは非表示（ただし画面非表示だけでは完全防御ではない）。
- **実際のCallable結合テスト**: \`tests/partner-company-functions.test.cjs\` が本物の \`functions/index.js\` を読み込み、Firestoreを全てメモリモックに入替えた上で、トークン・会社作成・再使用拒否・他社会員の所属保持・共通商材の価格ゼロ漏洩・非公開商材・共有ON/OFF・公開取り消し・協力店による孫会社招待拒否を検査。
- **ルールの独立検査**: \`tests/partner-finance-lock-emulator.test.mjs\` を実Firebaseの秘密鍵を使わない \`demo-partner-finance-lock\` エミュレータで実行。
- **商材の自動対応**: \`partner/canonical-ranking-groups.mjs\` は自社の元の商品IDを元に複数の協力店の同一商材をランキンググループへ自動対応。商材名が似ているだけで統合せず、協力店独自商品は名前・件数の共有許可がある場合のみランキングに対応付けする。
- **重要な集計制約**: 非公開商材の個別件数とその合計は他社向け合同ランキングに混ぜない。自社・協力店が共有を承認した商材の件数のみ合同集計。非公開商材を含む売上や件数を相手側へ推測させないよう、総数の表現も「共有対象の合計」とする。
- **依然未完了**: 協力店の既存の登録画面から共通商品IDを使って件数だけを安全に登録・訂正するサーバー経路、公開ビューのトランザクション同期、古いPWA/旧URLの移行、会社間合同ランキング/LINE本番配線、実本番のバックアップ独立復元。ルール候補はこれらが終わるまで絶対に公開しない。
