# 協力店向け金額非公開 — 段階的移行計画

## 重要
現行アプリは `records` / `products` に件数と金額を同居させている。このまま「画面表示を隠す」だけでは完全な情報分離はできない。Firestore Security Rules はドキュメント単位で読取可否を判定し、一部フィールドだけを隠すものではない。

**このブランチは計画と移行準備のみ。Firestore 本番ルール、実績、料金、ユーザー情報は一切変更していない。**

## 作成したもの
- `security/public-projection.mjs`: 保存実績・商材・訂正履歴から、売上・単価・CB情報を一切含まない別ドキュメントを生成（許可したキーだけを構築）。加えて金額スコアで並べ替えても公開結果は**順位・名前だけ**となるランキング投影を追加
- `security/prepare-projection.mjs`: オーナーの保存JSONをSHA-256検証し、会社ID・件数をチェック。ローカルに会社内共有用投影データだけを書き出す（Firestoreへ書き込まない）
- `security/firestore.phase1.rules`: 新しい分離コレクションのための**未適用**ルール。既存ルールへ直接反映せず保管
- `tests/public-projection.test.mjs`: ネストした結果の金額混入防止など7項目

## 段階移行の必須手順
1. **既存データの確定バックアップ**：月別・年別のJSONをオーナーが書き出し、2か所で保管・検証
2. **検証環境**：実本番データを直接使用せず、匿名化したテスト会社・メンバー・売上をエミュレータに用意
3. **新しい安全なコレクション作成**：`publicRecords`, `publicProducts`, `publicRecordCorrections`, `publicRankings`。完全な過去件数を確認し、比較表を保存
4. **アプリの参照先を分離**：協力店・一般メンバーは public 側のみ参照。売上承認権限は finance 側のみ参照。非権限者は原本参照APIを呼ばない
5. **書込み先を分離**：全メンバーの通常登録は件数/報告を public に書く。売上金額は別の管理用データとしてサーバーまたは権限があるオーナーだけが承認・確定。過去単価履歴を別保存し、一般メンバーに配布しない
6. **安全性試験**：別会社ユーザー、一般メンバー、協力店リーダー、売上許可ありリーダー、オーナーで、読み込み・作成・更新・削除を全パターン実行
7. **最終Rules切替**：旧財務コレクションの一般読取を拒否。原票 `records`、商材 `products`、訂正 `recordCorrections`、売上目標など関連するすべての金額経路を検証
8. **切替後監視**：旧アプリ・新アプリで履歴が消えないこと、報告画面・ランキング・LINE文面に金額が漏れないことを確認して公開

## 注意
- `security/firestore.phase1.rules` をそのまま本番に適用しない。これは分離先コレクション作成のための第1段階であり、既存の財務原票の読取ルールをまだ変えていない。
- 永続的な同期機能がないと、投影データは原票訂正後に古くなる。原票の更新と一緒に投影も原子的に更新する設計が必要。
- 使用中のFirebase SparkではCloud Functions本番動作がない。必要なサーバー処理は別の無料クラウド（Cloudflare Workerなど）を検討するが、認証・監査と費用検証なしに採用しない。
- 原データの削除は移行とは別機能。アーカイブ保管、検証、実復元テストが完了するまで絶対に削除しない。

## ローカル検証
```bash
node --test tests/public-projection.test.mjs
node security/prepare-projection.mjs ./sales-archive.json ./projection-preview
```
出力先フォルダは個人情報を含むのでGitHubへコミットしない。

## 順位だけの公開設計
`projectRankOnly` はオーナー/サーバー上で金額に基づく順位を計算するが、公開データは `id`, `name`, `rank` のみ。件数・売上金額・単価・計算元のscoreは出力しない。全社/班/商材別のフィルタリングは安全なスコープを定めてから実装し、旧ランキング画面を改修して初めて公開できる。

## 2026-10-28 安全性強化（第2段階）
- `publicRecords` は実績ヘッダーと合計件数のみ。金額が潜みやすいネストした `results` は配信しない。
- `publicRecordLines` に商材IDと商材別件数を1行1ドキュメントとして分割する。
- `publicRecordCorrections` は変更前後の班ID・件数だけの**平坦なドキュメント**にする。
- `publicRankEntries` は名前・順位の1人1ドキュメントとし、売上・件数・スコアを配信しない。
- `assertPublicSchema` でサーバー公開前にキー完全一致・ネスト禁止・財務キー混入の検査を行う。
- 未適用のセキュリティルールは読み取り対象を安全なキーと型に限定し、クライアントの作成・更新・削除と一覧取得を全拒否する。**正式な一覧API/ページングを作るまでは協力店側アプリはこのコレクションを一覧表示できない。**
- Firestoreエミュレータで会社内外のget、金額フィールド混入、利用者からの不正更新、一覧の拒否を試験するGitHub Actionsを追加。

**依然として未完了**：原本の `records` / `products` などには金額が入ったままで、現行Security Rulesは社内メンバーによる読取を許している。安全な新しい読み書きAPI・財務専用ストア・歴史データ移行を同時に完成するまで、協力店への完全な金額非公開を宣言できない。本番のルールは変更していない。

## 2026-10-28 原票と件数専用ビューの一括照合（オフライン限定）
- `security/reconcile-projections.mjs` を追加。会社ID、実績レコードID、商材別件数の行ID、金額非公開の製品名、訂正前後の班/件数まで、**元の保存原票と公開用ビューが1件ずつ完全一致するか**を検証する。
- `security/prepare-projection.mjs` は、この照合に通らない限り**ローカルの公開準備ファイルさえ出力しない**。件数が欠けた旧実績や訂正ログは0件と推測せず作業停止し、オーナーが元データを確認する。
- 欠損・重複・別会社の混入・改ざん・余分な財務フィールド・商材別行の欠落を拒否する合成テストを追加。検証結果は文書数と保存契約件数だけで、氏名、ID、売上や価格をログに出さない。
- **重要**: これは同一時点の完全な原票が既に手元にあることを前提にしたオフライン照合。実際のFirestore全件読み出し、公開用コレクションへの書込み、リアルタイム同期、ユーザー権限の移行、バックアップの完全復元の代わりにはならない。旧PWA/旧SDKの切替前に財務原票の本番Rulesを先に閉じることは禁止。

## 2026-10-28 売上と単価の閲覧許可を別々に保護（安全APIへの移行準備）
- `security/trusted-finance-view.mjs` を開発版へ追加。**認証済みトークン・最新の `users/{uid}` と `companies/{companyId}/members/{uid}`・管理者確認・班履歴**をサーバーが独立に確認した場合にだけ使える純粋なフィールド投影関数。
- `canViewRevenue` は保存済み総売上のみを許可し、単価やCB、財務原票全体は返さない。`canViewUnitPrice` は商材別単価だけを許可し、総売上を返さない。両方明示許可ならそれぞれ表示。オーナーは別途会社のオーナーをサーバーで検証する必要あり。
- 未許可、他社所属、現在または過去の班割当が無い、アカウント利用停止、未確認メール、価格/売上不正値の場合は**金額ゼロを捏造せず処理拒否**。例外に実UID・個別売上額を出さない。
- `tests/trusted-finance-view.test.mjs` は架空データだけで閲覧権限を検証。
- **注意：この関数はまだ本番のAPIに接続していない。** `principal` をユーザーから受け取ることは絶対禁止。Cloudflare Workers等の信頼されたゲートウェイがID tokenの署名と最新Firestoreの権限・履歴を照合する必要がある。
- フィールド別の読み出しはFirestore Security Rulesでは実現できないため、**単に `canViewRevenue` を追加するだけで原票を読ませない**。https://firebase.google.com/docs/firestore/security/rules-fields
- 本番旧URL/PWAが元の `records/products` を読んでいる間は、原票遮断ルールを適用しない。

## 2026-10-28 協力店用件数API（開発版、まだ本番接続なし）

- `security/public-count-api.mjs`: **GET `/v1/public-counts`** の件数専用HTTPハンドラーを追加。初期状態は `enabled=false` のため、呼び出しても停止（503）。Cloudflareへの本番配備はしない。
- 公開対象は `publicRecords`、`publicRecordLines`、`publicProducts`、`publicRankEntries` **のみ**。`records` / `products` / `recordCorrections` の金額付き原票は、このAPIから取得できない。
- 許可した2ドメイン（nico-factory.web.app・旧GitHub Pages）以外のブラウザOriginを拒否。署名検証済みFirebase IDトークン、会社所属、在籍/停止状態、本人の班所属を毎リクエスト確認。クライアントが指定する会社IDや役職を信用しない。
- 記録と商材別件数は **認可された班IDが必須**。非オーナーの他班指定を禁止する。商品名と順位だけは会社内の専用公開コレクションから取得。返却は必要な件数・商材ID・日付・順位だけ。氏名等の余分な値やraw原票のフィールドは一括で出力禁止。
- ページサイズの上限は **50件**。読み取り時刻 `snapshot` を初回応答から引き継ぎ、次ページも同じFirestoreスナップショットでの取得を**バックエンド側に必須**とする。異なる読取時刻や重複・他社/他班混入は**部分件数すら返さず失敗**とする。大量件数・2,000件超でも固定の読み切り上限をつけずページ単位で取得する方式。
- `tests/public-count-api.test.mjs` で無効状態、別会社、停止中、無認証、Origin/パラメータ攻撃、50件ページ送り、タイムスタンプ不一致、金額混入、商品/ランキングの非公開値排除を架空データで確認。

### 本番へ接続する前に必ず必要なアダプター

`createCountOnlyReadHandler` に渡す次の3機能は、**信頼されたサーバー側**で実装するまで利用開始できません。

1. `authenticateBearer(token)`: Firebase署名/Issuer/Audience/期限/確認済みメールを検証。**ブラウザのJWT payloadを自己申告として受け付けない**。
2. `loadMembership(uid)`: Firestoreから**毎回**最新 `users/{uid}` と `companies/{companyId}/members/{uid}`、会社Owner/班履歴を読取り、ユーザーの入力ではない権限情報を構築する。
3. `queryPublicDocuments({collection,companyId,teamId,startAfter,snapshotTime,limit})`: Firestore RESTの公開コレクションだけを、会社と班でサーバー側絞込・文書名でソートし、**同一readTime固定**でページ返却する。Firestoreの原票コレクションは使用しない。

**本番Rulesを原票遮断に変更する前に**、旧新URLのWebアプリが件数取得・登録・訂正をこの新しい信頼済み経路で成功し、退職者・班移動・金額許可ありの人にも互換性があることを確認してください。このAPIが開発版で動いてもそれだけで公開可能にはならない。

### 件数専用Firestoreクエリアダプター（追加実装）

- `security/public-count-firestore-reader.mjs`：Firebase REST `documents:runQuery` へ渡す **公開用コレクションだけの固定クエリ** を構築。すべてのクエリで `companyId` をサーバー側条件に加え、記録と明細は `teamId` も必須。元データの `records/products/recordCorrections` を問い合わせることはできない。
- `__name__` 昇順・カーソル・読込時刻 `readTime` 固定で最大50件ずつ読み込む。レスポンスの会社/班/元ID/並び/時刻/値の型を照合してから、`public-count-api.mjs` 側で最終的に金額のない許可フィールドだけを返す。
- `tests/public-count-firestore-reader.test.mjs`：API+RESTクエリアダプターの連結テストで合成 **2,501件を51ページ** で重複/欠落なし、会社/班を強制、時刻変更・金額混入・不正なREST型を拒否。
- **現在も未接続**：本番のサービスアカウント認証済みFirestore REST通信、Firebase IDトークン署名検証と権限更新、既存画面の実績登録処理、既存コレクションから公開用コレクションへのバックフィル/継続同期は別の実装が必要。バックアップ完全照合・隔離復元が終わるまで本番Firestoreに書き込まない。
- 現行の `index.html` は `recordsCollectionQuery()` から `collection(db,"records")` を呼び出している。この参照と旧PWAキャッシュを安全に切り替える前に財務原票の本番読取を遮断すると**既存アプリが壊れる**。強制切替は禁止。

