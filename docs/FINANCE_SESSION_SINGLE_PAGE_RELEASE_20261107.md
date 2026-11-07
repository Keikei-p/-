# 金額遮断診断ページだけの安全な本番修正（2026-11-07）

## 公開対象
- 本番 `https://nico-factory.web.app/finance-boundary-four.html` の**1ファイルだけ**。
- 現行HostingリリースID `sites/nico-factory/versions/4ef44dd80f632692` に完全一致した場合にのみ処理し、他の誰かが更新済みなら何も公開せず停止。
- 現行13ファイルのうち12ファイルは既存のハッシュを**完全再利用**。新たにアップロードするのは診断ページ1ファイル分のみ。
- 新HTMLは `staging/finance-diagnostic-v4/build-session-safe.mjs` から生成し、審査対象以外のバイトを受け付けない。
- 現行Strict四原票診断と比較し、Firebase Auth/Firestore/APIの元のプローブ・本人照合・マスクGET・件数参照・4原票判定は変更しない。UID変更・ログアウト時に前ユーザーの全判定を消し、非同期旧UIDレスポンスの復活だけを防止する。

## 実施ゲートと公開の仕組み
- PRで新HTML合成テストと旧版静的検証、起動中アカウントの切替・旧結果リセット、元の金融値を出さないことをテスト。
- 新規GitHub Actionsは `main` に反映後、**正確に `release: finance session proof single Hosting page` で始まる統合コミット**に限り、既存の秘密鍵を一時ファイルへ読み込む。
- 事前 `--dry-run` はHostingの最新バージョン・13全ファイルハッシュを検査。本人の承認がない新しいリリースや違うマニフェストを拒否。
- `--release` はFirebase Hosting RESTに限り1ページのバージョンを作成し、13ファイル全てのハッシュを再検査してから本番releaseへ切替。
- 公開後に **診断ページの生成バイトと本番URLの内容を完全比較**し、元の主要5ルートのHTTP 200を検証する。
- 成功しても本番金額4原票のGET/LIST拒否・3UID本人確認、件数入力の保存確認を実施したことにはならない。

## 変更しないもの
- **本番のFirestore Rules、Functions、Auth、会社所属、記録、単価、CB、売上、件数、件数代理修正、合同ランキング、LINE、端末PWAは一切変更しない。**
- 公開する内容は新しい診断ラベルのリセット処理だけ。移行済みと誤報告しない。
- 13ファイルや現行Hostingのリリース状態が合わなければ安全停止する。停止しても既存サービスは稼働継続。

## 本番公開後の確認
- Actions: `PASS_SESSION_FINANCE_FOUR_LIVE_ONLY_OLD_12_ASSETS_PRESERVED`
- 3つの協力店メールと自社Ownerでログインした実アカウントの結果・件数入力は別途個別確認。
- 旧自社金額が少しでも協力店へ表示・取得可能ならRules/Functions公開は禁止、ユーザー入力は継続可能なまま現状確認。

**診断表示の修正は、本番の権限遮断そのものではありません。**
