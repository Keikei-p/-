# 本番金融診断：アカウント切替時の誤合格表示防止（2026-11-07）

## 実際に確認した問題

現在の本番 `https://nico-factory.web.app/finance-boundary-four.html` に公開されたStrict 4原票判定は、1 UIDの実際のGET/LISTに対してのみ「確認済み」を表示する設計だが、元になる診断画面の `onAuthStateChanged` はログアウト時や次のUIDへ変更したときに**既存の画面上の「PASS」行をクリアしない**。これでは前アカウントの緑色表示が別アカウントの新しい結果のように見え、本番切替判定で誤認する。

## 修正候補（STAGING ONLY）

- 検証済みStrict HTMLの変更箇所を一意の文字列マッチで固定し、`staging/finance-diagnostic-v4/build-session-safe.mjs` に**画面リセットと処理世代の照合だけ**を追加。
- Firebase Auth UIDが変わったら、`identity`、4原票 `products` / `records` / `recordCorrections` / `revenueGoals`、件数照合、総合判定をすべて「未確認」に戻し、過去のPASSを消す。前UIDの協力店ワークスペースIDもクリア。
- Owner本人が明示的にGET/LISTした**文書IDのみ**は同じタブ内に一時保持。別協力店UIDでその同じ既存原票のGETを試せるようにする。元のトークン・金額・実績内容・メールは保持しない。ブラウザの永続保存もしない。
- 診断実行中に別UIDへ切替・ログアウトした場合、非同期の旧UID処理が完了してもその結果を新UIDのPASSへ戻さない。Auth変更時に処理世代を増やして判定を無効にする。
- 現行のFirebase Auth / Firestore Rules / Functions / Hosting / 原票 / 実績・件数入力のコードは変更しない。正式な本番配備は別レビューと本番13ファイル完全一致・1ページだけの置換が必要。

## 検証内容

- Owner → 別協力店ログイン → 再診断、およびログアウト後の各原票・総合判定のリセット。
- 4原票全てのGET/LIST拒否が成立したUIDだけ「合格」。Ownerに欠落原票がありGET未検証なら保留。
- 切替中の古い通信が終わっても、以前のアカウントの結果を表示しない。
- 試験用の匿名Firebase Auth/Firestore REST模擬レスポンスのみ。**本番ユーザーの実UID金融遮断を証明したとは主張しない。**

**本番全売上・単価・CB・件数・旧履歴は変更なし、元のログイン・入力・LINEにも影響させない。**
