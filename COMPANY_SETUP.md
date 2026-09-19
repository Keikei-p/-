# 会社管理機能セットアップ

このリポジトリには、既存画面を大きく作り直さずに会社単位の管理へ移行するための Cloud Functions が含まれています。

## 追加済みのサーバー処理

- `createCompany`
  - メール確認済みユーザーだけ会社を作成できます。
  - Firestore が自動生成した companyId を使います。
  - 作成者を owner / leader として所属登録します。
  - users/{uid}.companyId はサーバー側で更新します。

- `createInvitation`
  - 会社の owner / admin / leader が、宛先メールアドレスを指定して招待を作成します。
  - 生の招待トークンは Firestore に保存せず、SHA-256 ハッシュだけ保存します。
  - 有効期限は7日です。

- `getInvitationPreview`
  - ログイン中のメールアドレスと招待先メールアドレスが一致する場合だけ会社情報を返します。

- `acceptInvitation`
  - 招待先メールアドレス本人だけ参加できます。
  - 所属 companyId はサーバー側で設定します。

## デプロイ

Cloud Functions をデプロイするには Firebase プロジェクトを Blaze プランにする必要があります。

Node.js 22 と Firebase CLI を使用します。

```bash
npm install -g firebase-tools
firebase login
git clone https://github.com/Keikei-p/-.git
cd -
npm --prefix functions install
firebase deploy --only functions
```

プロジェクトIDは `.firebaserc` の `sales-management-cc116` に設定済みです。

## 既存データについて

既存の users / teams / products / records には会社情報がないため、自動で会社へ割り当てません。
既存IDを保ったまま、所属対応表を確認してから移行します。

Cloud Functions のデプロイ後に、画面側へ会社作成・招待・会社別データ参照を接続します。
