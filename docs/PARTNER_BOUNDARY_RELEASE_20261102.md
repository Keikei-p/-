# 協力店の限定Rules修正 — 手動公開計画

ユーザーは2026-11-02、本番Rules限定変更に「本番まで」、既存4 Functions更新と全件照合の従量利用に「承認する」と回答。プラン変更・有料復元先・新規サービス契約は範囲外。

対象は sales-management-cc116 の cloud.firestore のみ。Firestore文書、Auth、Functions、Hosting、LINEを変更しない。本PRは公開の準備であり、merge/pushでは実行しない。

既存の全社owner-only金融移行ゲートは変更せず、その公開workflowも使わない。今回は既存社員の許可済み閲覧を保つ協力店境界修正である。前検証run 41321444470のexact candidateと一致する場合だけ使える。

- 元Rules SHA256: `9d186b9ff763e010373e5c239ec80f53bac168b61ddb2877b38338c73ba43a91`
- 候補 SHA256: `d1d9998d874a1a31c81ddf6996e08cd9de3a3d13bd684e245140bf03cab32179`
- 協力店分類のusers/members/companyを社内金融原票のgrantから外す。自社Owner/Master/明示許可者のアクセスを維持。既存提案に含まれる5履歴collectionのhard-delete禁止とexpression予算修正も含む。
- 元Rulesはtests/fixtures/partner-boundary-before.rulesに保管（文書データ・認証情報は含まない）。未知の本番Rulesは停止。

## 検証と適用

1. PRのoffline試験とRules 47件を成功させる。
2. mainへ準備のみmergeし、exact main SHA、従量利用承認を入力して `verify` を手動実行する。
3. 48時間内のREADYバックアップを確認。既存全collection・subcollectionを最大10000文書まで列挙。全ての型付きフィールドとIDを一時localhostエミュレータへ復元・再読取りする。もう一度本番を列挙し、全件ID/fields/createTime/updateTimeのdigestが一致しなければ停止。
4. 自社Ownerの実ログイン・単価・売上・実績表示は本番NICOで確認済み。入力/訂正の本番書込みと協力店実ログイン検査は未実施。合成テストと区別する。
5. 検証結果を確認後、same reviewed main SHAで `apply` を手動実行。検証を再実行した後にexact Rulesだけ適用し、読み戻し、全件照合する。
6. 失敗時は、この実行のRulesが現行である場合だけ元Rulesetへ戻す。他の公開が割り込んだ場合は自動上書きしない。文書を戻したり再計算しない。

全件読取りは逐次走査であり同一時刻のtransaction snapshotではない。営業入力による正当な変更でも不一致で止める。稼働の少ない時間に行う。エミュレータ復元は元フィールドとIDの検証であり、マネージドバックアップそのものからの有料クラウド復元やAuth/Functions復元を実施したとは扱わない。元metadata時刻は復元できないが本番前後比較には含む。

実データ・個別ID・単価・売上はログ/artifactへ出さない。artifactは全体件数・全体digest・Rules参照・検証booleanのみ。既存サービス資格情報は保護されたrunner内でだけ使用し、終了時に消す。

公開実績: **未実行**。承認や準備を公開成功と混同しない。
