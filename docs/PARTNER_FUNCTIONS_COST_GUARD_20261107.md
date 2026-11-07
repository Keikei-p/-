# 協力店件数Functionsの継続料金対策 — 2026-11-07

## 本番で実測した状態
- `getPartnerWorkspace` / `submitPartnerWorkspaceCounts` / `managePartnerWorkspace` / `acceptPartnerWorkspaceInvite` の**4本全て未配備**（2026-11-07 本番Cloud Functions v2 GET-only実測）。
- 前回のフルREADY監査ではFirebase Billing連携は存在するが、トライアル残額・無料枠の残りと今後の継続料金0円は証明されていない。
- **本番Firestore Rules/売上/単価/CB/件数原票/本人所属を切り替えてはならない**。代替の新規保存Functionが存在せず、件数入力が止まる。

## 費用の管理の真実

- Firebase BlazeプランにはCloud Functionsの無料利用枠がある。ただしCloud Build・Artifact Registry・実際のリクエスト数と処理時間などは別途課金されることがある。無料枠だけで**将来ずっと0円は保証されない**。
- Firebase Cloud FunctionsのCloud Run Functionsサービスに**Spend cap budget**という月額上限が公式に存在するが、これはPreviewで、課金データ反映の遅れにより設定額を超える可能性があるため「完全なハードキャップ」ではない。
- Spend capがENFORCEDになると、**同一Firebaseプロジェクトの既存Cloud Run Functionsも一時停止**し得る。既存のLINE送信・招待・Quick件数を止めるリスクがあるため、本人了承なしに勝手なSpend cap作成・変更・解除をしない。
- ユーザーが許可した試用予算は**継続的な課金契約の無条件承認ではない**。

公式情報:
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/projects/billing/spend-caps
- https://docs.cloud.google.com/billing/docs/how-to/budget-api-spend-cap

## 今回追加した安全な実査

`tools/production/inspect-functions-spendcap-readonly.mjs` は既存のService Accountから**GETのみ**で次を確認する。

1. `sales-management-cc116` がどのCloud Billingアカウントに紐づくか（アカウント名は内部メモリのみ）。
2. Cloud Billing Budget APIの最大3ページをGETして、対象**単一プロジェクト、Cloud Runサービス、月次、クレジット除外**のSpend capのみ判定。
3. CONFIGURED / ENFORCED / LIFTED を区別する。Alerts-only・全プロジェクト・別サービスのBudgetは誤認しない。
4. ログに残すのは真偽値・抽象的な理由コードのみ。BillingアカウントID、Budget名、上限金額、OAuth token、ユーザーID、取引データは一切出さない。
5. API IAMがない・返答が不正・リストが上限超過の場合、**勝手に存在を推測しない**。不明と記録し、費用/Functions配備ゲートは解除しない。

## 本番を止めずに公開する順序

1. Cloud Functions v2 4本の不存在が実証済み。**費用対策を選んで、既存LINE/Quick件数が止まらない運用案を確認**。
2. 既存manual-release workflowの4本限定・既存Functionsの変更なし・maxInstances制御・正しいmain SHA・本人による費用の明示承認で、初めて新4本だけ配備。
3. 実UIDで件数保存・日次訂正が動いたことを確認し、旧自社4金融原票GET/LIST拒否も本人検証。
4. 管理READYバックアップ本体の復元確認と元の売上/件数/CB維持、本人の明示同意と独立レビューが揃うまでは旧自社所属の一括変更と金融Rules切替は禁止。

**今回のPRは読み取り専用の費用・Budgetメタデータ監査のみ**。料金設定、関数、金額、件数、Auth、Rules、Hosting、既存履歴は更新しない。