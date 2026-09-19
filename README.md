# 営業実績管理アプリ

会社ごとにデータを分離して、班・メンバー・商材・日々の営業実績を管理するWebアプリです。

## 現在の本番構成

- GitHub Pages
- Firebase Authentication（メールアドレス / パスワード）
- Cloud Firestore
- Firebase Spark プラン
- Cloud Functions は本番では使用しません

## 主な機能

- 新規登録 / ログイン
- メールアドレス確認
- パスワード再設定
- 会社作成
- 30分で失効するメールアドレス指定の招待リンク
- 会社単位のデータ分離
- オーナー / リーダー / メンバー管理
- オーナー移譲
- 退職者の利用停止
- 本人によるアカウント削除（オーナーは移譲後）
- 班・商材・メンバー管理
- 日別の実績入力
- 月間ダッシュボード、個人・班ランキング、登録履歴
- スマートフォン対応

## 権限

- **owner**: 会社の所有者。メンバー停止とオーナー移譲ができます。
- **leader**: 班・商材・メンバー・会社内実績を管理できます。
- **member**: 自分の実績を入力・編集できます。

会社間のアクセス制御は画面表示だけではなく、`firestore.rules` でも強制します。

## 主要ファイル

- `index.html` — 本番アプリ
- `firestore.rules` — Firestore Security Rules
- `COMPANY_SETUP.md` — 会社管理とセキュリティ仕様
- `firebase.json` — Firestore Rules 用Firebase設定
- `functions/` — 将来Blazeへ移行する場合の参考コード（本番未使用）

## Firestore Rules の更新

`firestore.rules` を変更した場合は、Firebase Console の **Firestore Database → ルール** に同じ内容を貼り付けて公開します。

GitHubへコードをマージしただけでは、Firebase Console側のRulesは自動では更新されません。

## 既存データ

会社機能導入前のデータには `companyId` がありません。
既存データは推測で会社に割り当てず、対象を確認してから移行します。

詳細は `COMPANY_SETUP.md` を参照してください。
