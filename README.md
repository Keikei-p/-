# 営業実績管理アプリ

チームの営業実績を、日付・担当者・商材ごとに記録・集計するWebアプリです。

## 主な機能

- メールアドレスによるログイン・新規登録
- リーダー／メンバー権限
- 班・メンバー・商材の管理
- 日別・担当者別の実績入力
- 商材ごとの件数と収益の自動集計
- 月間ダッシュボード、個人ランキング、班ランキング、登録履歴
- Firebase Firestoreによるリアルタイム同期
- ユーザー名・班名変更のリアルタイム反映
- 同じ担当者・同じ日付の重複登録防止
- スマートフォン対応

## ファイル

- `index.html` — アプリ本体
- `firestore.rules` — Firestore Security Rules
- `README.md` — この説明書

## GitHub Pagesで公開する方法

1. この3ファイルをGitHubリポジトリの一番上の階層へアップロードします。
2. GitHubの **Settings → Pages** を開きます。
3. **Branch: main**、**Folder: /(root)** を選び、保存します。
4. 数分後に `https://ユーザー名.github.io/リポジトリ名/` へアクセスします。

> `index.html` は必ずリポジトリ直下に置いてください。`outputs` フォルダ内ではGitHub Pagesのトップ画面として表示されません。

## Firestore Rulesの公開

Firebase Consoleで **Firestore Database → ルール** を開き、`firestore.rules` の内容を貼り付けて公開してください。

最初のリーダーがまだいない場合は、Firestore上の対象ユーザーの `users/{uid}` にある `role` を `leader` に設定してください。

## 注意事項

- 実績データはFirestoreに保存されます。
- メンバーは自分の実績だけを編集・削除できます。
- リーダーは班・商材・メンバー・全実績を管理できます。
