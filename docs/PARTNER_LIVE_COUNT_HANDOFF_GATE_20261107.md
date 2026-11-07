# 営業実績アプリ・兼務協力店を本番移行する前の実環境監査（2026-11-07）

## 安全な実行

`.github/workflows/nico-unified-release-readiness-readonly.yml` は既存の独立監査4本を、既存のGitHub Actionsサービス資格情報で呼び出す**読み取り専用**の検証。今回 `workflow_dispatch` を追加し、mainに本変更を統合すると、既存の`push main`トリガーで一度走る。あとで必要なら手動で再監査できるが、ユーザーのPC操作は不要。

- `audit-live-firestore-rules-readonly.mjs`：配備中Rulesの実ソースをGETで照合する。
- `inspect-live-partner-callables-readonly.mjs`：`getPartnerWorkspace` / `submitPartnerWorkspaceCounts` / `managePartnerWorkspace` / `acceptPartnerWorkspaceInvite` の4つについて実際のCloud Functions v2状態・enabledフラグをGETで確認。**未配備なら所属切替を止める**。
- `audit-secondary-contexts-readonly.mjs`：実際の兼務アカウント関係、元会社Owner関係、READYバックアップメタデータを上限付きでGET。個人識別子・メール・請求金額・生売上はログに出さず、存在有無の真偽のみ。
- `inspect-project-billing-readonly.mjs`：Billing連携の有無だけGET。**試用残高・今後の料金0円を保証できない**場合は安全側で公開保留とする。

## 「本番移行」条件

1. 4件数Functionsが実際に本番でActive＋Enabledであり、本人のログイン・件数保存・訂正が実UIDで確認できること。**Functions APIメタデータの存在だけで保存成功とは言えない**。
2. 影響する自社の兼務ユーザーは本人の明示同意後、`partnerHistoricalTransfers`に元の所属・権限をアーカイブし、旧自社memberとsecondary contextを同一Transactionで終了させる。PR #480で安全ゲート（件数APIが使えない場合の移行拒否、当日の保存元帳不整合の移行拒否）をSTAGING実装済み。
3. 同一UIDの元社内4金融原票GET/LIST拒否・社内OwnerのGET/LIST継続、同一UIDでの件数新規保存と日次訂正の確認。Firestore Emualtorでの試験成功を**本番実UIDの証拠として使わない**。
4. **READY管理バックアップ本体**の独立復元、元自社の売上・単価・CB・履歴と件数の完全照合、本人とレビュー担当の承認。
5. 4新Functionsが継続料金を発生させる可能性と停止・予算対策を独立確認。既存の試用クレジットが残っていても継続無償を保証できない。

## 実際に変更するもの

本PRは**既存Read-only workflow一つと本書だけ**。Functionsをデプロイせず、Rules・Firestore原票・Auth・Hosting・LINE・自社売上・既存件数入力・メンバー履歴・単価/CBを一切更新しない。

監査出力は`NICO_RELEASE_READINESS`の真偽値ゲートであり、成功したジョブでも`safeForPartnerFullRelease:false`が正常な停止判定になり得る。異常なAPI応答はジョブ失敗で安全停止する。失敗時に勝手なアカウント移行や管理者承認の代替をしない。

## 個別Functions停止・配備状態の追加監査

これまで本番監査では `fourCountFunctionsDeployedActiveEnabled=false` というまとめ値しか公開しておらず、四つのどれが未配備か/デプロイ済みなのに停止したのかを安全に判定できなかった。新しい `countFunctionHealth` は**公開されている4つの関数名ごとに真偽のみ**を表示し、`deployed`・`active`・`callableGen2`・`countEnabled` を検証する。元のCloud Functions v2 GETのURI、環境変数、請求情報、ユーザー・売上情報は絶対に出さない。

- 全4関数の存在、形式、真偽値、集計値との一致を確認し、1つでも不正なメタデータや余計な関数名を含んだ結果はfail closed。
- 4本すべてがACTIVE / Enabledでも本人の件数保存・金融GET/LISTを自動的に成功扱いしない。
- Billingで試用クレジット残高の確認ができないため、配備のたびに継続費用が0円と仮定しない。必要なものだけ計画して、旧Functionsを消さずに費用審査する。
- この変更は**読み取り専用の監査集計**だけであり、本番のFunctions/Roles/Rules/Hosting/既存データを操作しない。
