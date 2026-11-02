# 協力店の本番Rules検証 — PC/Work不要の単発実行

目的: 本番Firebase `sales-management-cc116` のデータ・自社売上を変更せず、
PR #316で監査済みの `tools/production/release-partner-boundary.mjs verify` を
GitHub Actionsの保護済みサービスアカウントで**一回だけ自動起動**する。
ユーザーは「修正して本番へ」および既存Functions・全件照合の従量利用承認済み。
新規の課金プラン、IAM変更、Auth/DB操作、データ消去、Rules適用、Functions/Hosting公開は対象外。

- 新ワークフロー: `.github/workflows/nico-partner-boundary-verify-once.yml`。
- PR上では `offline` だけを実行し、本番サービスアカウントには一切触れない。
- mainへ**このワークフローの初回追加**がmerge/pushされた時だけ、正確なmain SHA
  を `gh api` で検証。ほかのmain更新・再実行には反応しない。
- main上の `offline` 成功後、`RELEASE_MODE=verify`、`NICO_RULES_APPROVAL=VERIFY_ONLY`
  を固定して、PR #316と同じ`controlled` 処理を実行する。
- 全コレクションのID・フィールドを対象にハッシュ全件照合、既存48時間内
  バックアップ確認、localhost Emulator隔離復元・照合、本番Rules候補と
  本番Rulesのexact digest照合。検査対象の既知上限等を超えた場合は停止。
- セキュリティ情報・実データはログ/公開アーティファクトに出さず
  `partner-boundary-summary.json` のみ、Private runner temporaryに保存。
- **このrunは絶対にRulesをapplyしない。** Rules適用前にはこのrunの結果
  （原票アクセス拒否と自社売上保護の公開準備）が正しいことを確認する。
- 検証不能の場合: いっさいの本番変更をせず、Rules本番適用およびPR #315の
  Functions/Hosting公開を停止する。
- 既存の手動 `nico-partner-boundary-manual.yml` および承認/ロールバック処理
  は変更・弱体化しない。自社売上・単価・LINE・履歴は未変更。
