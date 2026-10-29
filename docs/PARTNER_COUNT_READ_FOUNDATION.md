# 協力店｜件数専用読み込み基盤（安全・本番接続OFF）

## このブランチで実装済み
- 同一会社・所属班・有効アカウントのみが取得できる件数専用HTTPハンドラー
- 元の `records` / `products` / `recordCorrections` を一切取得しない固定Firestore RunQuery
- 会員権限を毎リクエスト確認するための信頼されたサーバーアダプター接続口
- `canViewRevenue` と `canViewUnitPrice` を別々に判定するフィールド投影関数
- 月間・班別/商材別実績を50件ずつ、Firestoreの同一readTimeに固定したカーソル方式
- 合成2,501件での全件読み込みと重複・欠落・スナップショットずれ検出テスト
- 実績→会社共通の公開用件数ドキュメントへの完全一致チェック（オフライン）
- 金額やCBがID・名称・明細中に混入した場合の公開拒否

## このコードはまだ本番アプリに接続されていません
- `createCountOnlyReadHandler()` は初期状態 `enabled=false`。公開APIとして起動しません。
- Firebase IDトークン署名を実際に検証するWorker/サーバーアダプターと、Firestoreから最新の権限を読み出すアダプターの接続が必要です。
- 書き込み・訂正時に金額付き元データと公開用データを整合させる安全な仕組みが必要です。
- 旧URL・新URLの `index.html` / キャッシュ済みPWAの直接 `records` 読取を先に切り替える必要があります。
- 実本番Firestoreのバックアップ完全性、復元と正本照合、無料枠・請求確認が必要です。

**上記を完了する前にFirestore Rulesだけを先に厳格化すると現場入力が止まる恐れがあります。**
このPRは本番のURL・Firestore Rules・Auth・Functions・実績・単価・バックアップ・請求設定を変更しません。

## 安全な動作試験（Node 22以上）

```bash
node --test tests/public-projection.test.mjs tests/reconcile-projections.test.mjs tests/trusted-finance-view.test.mjs tests/public-count-api.test.mjs tests/public-count-firestore-reader.test.mjs
```

すべて架空データで動作し、Firebaseへ接続しません。

## 次の本番化に向けた一つの作業単位

既存Finance Gateway（現在デフォルトで無効）に署名検証・最新会員権限取得・固定Firestoreクエリを接続し、件数取得を旧新URL双方で合成データにより確認。その後、実際のバックアップ検証と管理者レビューを経て段階的に切り替えます。
