# NICO FACTORY — オーナー／協力店リーダーのアカウント削除（本番未公開）

## 既存システムとの切り分け
- **利用停止**：既存 `deleteCompanyMemberAccount` は Auth `disabled=true` と Firestore `active=false`。社員名、ユーザー・会社Member、履歴は物理削除しない。従来の動作は変更しない。
- **アカウント情報の完全削除**（新規）: Firebase Authentication ユーザーを物理削除し、`users/{targetUid}`、`companies/{companyId}/members/{targetUid}` を削除する。協力店の `partnerWorkStaff/{targetUid}` は履歴照合のため、メールと個人名を除去した「退会済み・無効」状態へ置き換える。**ビジネスの実績原票は一切消さない**。
- 会社の件数、売上金額、当時単価、商品マスター、訂正記録、CB、班・チーム、LINE自動報告、協力店日別ledger・合同ランキングデータは不変。
- 過去の原票に既に保存された氏名/UID/過去の招待・通知ログ/クラウドバックアップは別の記録として残る可能性がある。**Firestore全域の個人情報が消滅することを保証する機能ではない**。会社の法令・事業記録保持と本人のプライバシーを両立させる別の要件整理が必要。

## 削除を許可する人
1. 自社の **現在の会社オーナー**：同じ自社に属する、本人以外のメンバーだけ。会社オーナー、自分自身、別会社、矛盾する Auth/Firestore 所属は禁止。
2. 協力店の **リーダー**：本人と同じ班に属する一般メンバーだけ。別班、別会社、協力店リーダー同士、協力店オーナーを削除しない。
3. 協力店の会社Ownerは自社協力店内のリーダー/メンバーを削除可能。ただし自分自身は不可。
4. **二重所属Contextや過去の正式移籍アーカイブが1件でも存在する対象**は、現在の単一所属モデルによる削除から除外。複数所属と元自社の保存データを誤って消さないため、別途個別調査が必要。現在の1件の二重所属に対してこのAPIを使ってはならない。

## サーバー側の安全手順
- 新しい独立コードベース `functions-account-erasure`。新規 `previewManagedAccountErasure` と `confirmManagedAccountErasure` のみ。Feature flag `NICO_ACCOUNT_ERASURE_ENABLED=enabled` を**明示しない限り無効**。既存 `functions/index.js` や `functions-partner-workspace` は変更しない。
- サーバーが Firebase Auth の署名済トークンとメール認証、`users`・`members`・`companies`・`partnerRelations`・`partnerWorkStaff` の整合性を確認。UID/email 不一致、権限違反、Owner自己削除、旧所属/複数所属は拒否。
- 画面では対象者氏名の再入力、操作中の管理者パスワード再認証、再度最新 ID Token 取得を必須にする。サーバーでも **直近5分以内に本人再認証したJWT** であることを要求。
- `preview` は読み取り専用。サーバー側 `confirm` の最初のTransactionで、対象者のアクティブ所属のみ無効化し、非PIIの班履歴を `accountErasureJobs/{sha256(companyId+UID)}` に記録する。実績の文書は触らない。
- FirestoreとFirebase Authenticationを単一Transactionに含めることはできないため、Auth停止/削除が失敗したら `pending` の状態を残して同じ権限者が再実行できる。Auth削除後にFireStore側の個人プロフィール消去が失敗しても、同様に安全な再試行ができる。
- 最後に `users` と `members` を物理削除し、協力店スタッフの現在プロフィールは個人識別情報を含まない無効な履歴参照として保存する。**営業原票、売上、当時単価、原票の件数、商品/CB/班履歴を操作しない**。

## 未確認・本番公開のゲート
1. 実本番の Auth/Firestore/メール招待/個人情報保存場所をさらに調査。特に `invitations`、`partnerWorkInvites`、通知・連携ログ、保存済み実績内の氏名を扱う方針の明文化。**アカウント情報以外を完全消去と案内してはならない**。
2. READY バックアップと隔離Emulator復元の照合、実ユーザーの認証と利用範囲確認。
3. Firebase Auth 削除とFirestoreプロフィール削除の途中失敗・回復の**統合テスト**。現時点ではモック試験のみ。実アカウント削除テスト未実施。
4. 退会後の売上・商材別/個人ランキング、履歴、班別詳細で過去の数字と当時の班が正しく見える実機テスト。
5. 既存PR #355（協力店の二重所属から金額原票遮断）とは**別のPR**。PR #355を未統合のまま混ぜたり、既存 Functions/Hosting/Rules を上書きしない。
6. 本番公開はレビュー・バックアップ・本人確認・影響説明・明示的な実アカウント削除の承認が整うまで禁止。**このブランチにはFirebaseの認証情報・デプロイワークフローを持たせず、GitHub Actionsはlocalhost/Mockのみ**。

## ロールバック
削除済みAuthアカウントは元のパスワード・UIDで単純復元できない。FirebaseのバックアップがあってもAuthは一括復元できないため、利用者に不可逆操作であることを事前表示する。失敗時は業務原票の復元や再作成を勝手に実行せず、`pending` を調べる。
