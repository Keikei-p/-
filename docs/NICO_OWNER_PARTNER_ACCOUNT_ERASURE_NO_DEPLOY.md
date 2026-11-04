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
- 新しい独立コードベース `functions-account-erasure`。新規 `previewManagedAccountErasure`・`listManagedAccountErasurePending`（読取専用）・`confirmManagedAccountErasure` の3本のみ。Feature flag `NICO_ACCOUNT_ERASURE_ENABLED=enabled` を**明示しない限り無効**。既存 `functions/index.js` や `functions-partner-workspace` は変更しない。
- サーバーが Firebase Auth の署名済トークンとメール認証、`users`・`members`・`companies`・`partnerRelations`・`partnerWorkStaff` の整合性を確認。UID/email 不一致、権限違反、Owner自己削除、旧所属/複数所属は拒否。
- 画面では対象者氏名の再入力、操作中の管理者パスワード再認証、再度最新 ID Token 取得を必須にする。サーバーでも **直近5分以内に本人再認証したJWT** であることを要求。
- `preview` は読み取り専用。サーバー側 `confirm` の最初のTransactionで、対象者のアクティブ所属のみ無効化し、非PIIの班履歴を `accountErasureJobs/{sha256(companyId+UID)}` に記録する。実績の文書は触らない。
- FirestoreとFirebase Authenticationを単一Transactionに含めることはできないため、Auth停止/削除が失敗したら `pending` の状態を残す。対象者が通常メンバー一覧から消えても、**同じ操作管理者**が画面の「削除が未完了のアカウントを確認」から、対象者名・管理者パスワード再認証によって再開できる。表示や一覧取得は読取専用。Auth削除後にFirestoreプロフィール削除が失敗しても、Authを再作成せずプロフィールだけ処理する。
- **誤削除防止**: 初回にはFirebase AuthのUID・メール・作成日時のSHA256照合値に加え、ランダムな削除専用識別子をAuthの管理者専用custom claims（既存claimsを維持して追加）に付与する。元UIDがすぐ再作成されて作成日時まで一致しても、**元の識別子がないAuthを無効化・削除しない**。処理の最初と削除直前に照合する。再開時に別会社へ所属変更・再有効化されていればプロフィールも削除しない。完了したらreceiptに一時記録した対象UID・氏名・Authハッシュ・識別子を削除する。Firebase Adminに「識別子が一致する場合だけ削除」の原子APIはないため、本人再登録の競合を防ぐ運用制限が別途必要。
- 最後に `users` と `members` を物理削除し、協力店スタッフの現在プロフィールは個人識別情報を含まない無効な履歴参照として保存する。**営業原票、売上、当時単価、原票の件数、商品/CB/班履歴を操作しない**。

## 未確認・本番公開のゲート
1. 実本番の Auth/Firestore/メール招待/個人情報保存場所をさらに調査。特に `invitations`、`partnerWorkInvites`、通知・連携ログ、保存済み実績内の氏名を扱う方針の明文化。**アカウント情報以外を完全消去と案内してはならない**。
2. READY バックアップと隔離Emulator復元の照合、実ユーザーの認証と利用範囲確認。
3. Firebase Auth 削除とFirestoreプロフィール削除の途中失敗・回復の**統合テスト**。モックでは「Auth削除が失敗」「Authだけ先に削除済み」「同じUIDで別アカウントを再作成」「スマホ再読み込み後のpending一覧」まで回帰済み。**本番と別の `demo-sales-account-erasure` のFirebase Auth+Firestoreエミュレーターで、本物のFirebase Admin SDKを使った4シナリオが合格**：自社Ownerの実削除・売上履歴保持、途中失敗からの再開、即時同UID再作成の拒否、協力店リーダーによる自班メンバー削除とNURO・CBの履歴保持。**本番Firebase実UIDの削除テストは未実施**。
4. 退会後の売上・商材別/個人ランキング、履歴、班別詳細で過去の数字と当時の班が正しく見える実機テスト。自社班別詳細の**現行表示関数**をモックで実行し、退会者の旧班・7件・当時単価9,000円による売上63,000円が残ることは確認済み。実機・本番相当の全画面確認は未実施。
5. 既存PR #355（協力店の二重所属から金額原票遮断）とは**別のPR**。PR #355を未統合のまま混ぜたり、既存 Functions/Hosting/Rules を上書きしない。
6. 本番公開はレビュー・バックアップ・本人確認・影響説明・明示的な実アカウント削除の承認が整うまで禁止。**このブランチにはFirebaseの認証情報・デプロイワークフローを持たせず、GitHub Actionsはlocalhost/Mockのみ**。

7. 「既存アカウントへの削除専用custom claimの付与」からAuth削除までをFirebase Authで原子的に実施することはできない。pending作業中の再招待/UID再生成は停止し、レビュー対象の既存招待Functionsと競合しないことを公開前に確かめる。custom claim書込に失敗した場合、自動で同UIDを付与し直さず作業を停止し、管理者による個別の復旧確認を要する。

## ロールバック
削除済みAuthアカウントは元のパスワード・UIDで単純復元できない。FirebaseのバックアップがあってもAuthは一括復元できないため、利用者に不可逆操作であることを事前表示する。失敗時は業務原票の復元や再作成を勝手に実行せず、`pending` を調べる。
