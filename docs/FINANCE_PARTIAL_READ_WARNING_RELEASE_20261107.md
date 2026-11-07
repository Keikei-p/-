# 本番の金額遮断診断：兼務候補の一部Finance許可を警告（2026-11-07）

## 修正対象を絞る理由
現行の診断ページ `https://nico-factory.web.app/finance-boundary-four.html` の総合警告は、協力店所属をFunctionsで証明できた `partner-verified` の場合にしかFinance部分許可を強調しない。今まさに問題となっている **旧社内(primary)＋協力店(secondary)の兼務ユーザー**は、旧社内 `not-owner` のままFinance原票GET/LISTが成功しても、全体が単なる「判定保留」になる可能性がある。

## 改善内容
- `staging/finance-diagnostic-v5/build-finance-alert.mjs` で、既に本番公開したV4診断を**厳密なバイト元**として固定し、3か所の表示分岐だけを修正。
- **Owner以外で1種類でもLIST/GETが許可されたら**、独立した協力店資格が未証明でも総合判定に「金額原票を読取可能（兼務協力店なら危険・所属確認して本番切替停止）」という警告を出す。
- 全4原票のGET/LISTが拒否された協力店だけがPASS。Ownerの全4原票読取PASSは引き続き維持。1つのGET未検証を遮断成功と誤認しない。
- 表示するのは許可／拒否／未確認だけ。金額・メール・UID・元原票のID・Tokenは出力も保存もしない。Auth・Rules・Functions・Firestoreへの書き込みなし。
- `tools/hosting/surgical-finance-four-alert.mjs` で前バージョン `sites/nico-factory/versions/3802c1bbf38dd8a5` と**現行13ファイルの全文書ハッシュ**が一致した場合のみ、診断ページ1ファイルを置換。既存の他12ファイルの全ハッシュを再利用。
- GitHub Actionsは `main` への `release: finance warning single Hosting page` で始まるレビュー済みコミット時に限り、直前dry-run→1ファイル更新→取得バイト完全一致→主要5ページの200を確認。異なるリリースまたはファイル差があれば**何も公開せず停止**。

## これだけでは解消しない問題
- 兼務アカウントの旧自社金額へのアクセスが**実際に拒否された**わけではない。現在のLIVE Rulesを変えていない。
- PR #477のfinance-read拒否候補はEmulator合成検証成功、PR #478の本所属への移行と同じUIDの件数保存・訂正成功も確認済み。ただし本番は本人の実UIDによる4原票GET/LISTと件数保存の確認、本人の明示同意、READYバックアップ本体の隔離復元、費用と独立承認が必要。
- 旧社内社員が正当な権限で金額を読める場合にも警告を表示する。これは「漏えい確定」ではなく「協力店兼務の有無を独立確認」という安全側の判定。
- `firebase.json`、`firestore.rules`、本番Functions、index/PWA、既存の件数・売上・単価・CB・履歴・LINEには一切触れない。

## 判定
**このPRが更新するのは診断表示だけ**。公開後に実アカウントごとの診断と件数入力結果を別途検証し、親アカウントの原票・金額が少しでも外部から読めるなら金融切替を停止する。
