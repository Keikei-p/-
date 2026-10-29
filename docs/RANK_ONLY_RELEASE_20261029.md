# 合同ランキング：順位だけの公開契約と画面（2026-10-29）

## 新規実装（本番はOFF）
- `ranking/rank-only-publication.mjs`: 自社＋協力店の相互承認済み `publicRecords/publicRecordLines/publicProducts` 完全スナップショットから、**順位・氏名/班/商材名だけ**の公開契約へ変換。人数・獲得件数・目標数・進捗率・売上・単価・CBの数値は返さない。社内源の原票は読まない。
- `ranking/combined-rank-only-handler.mjs`: GET `/v1/combined-ranks?month=YYYY-MM` を受けるサーバー合成処理。初期 `enabled=false`。Firebase IDトークン署名検証、ログイン・最新の2社Owner承認、会社/会員有効、完全スナップショットの読み込みを**信頼済みサーバーの注入アダプター**へ委任。ブラウザから `companyId`・承認フラグ・順位・金額・件数は送信できない。CORSはNICO公式URLのみ。失敗時は一律エラー、キャッシュ禁止。
- `ranking/rank-only-view.mjs` + CSS: モバイル対応の班・目標達成・個人・商材ランキング表示部品。**全項目をrank+表示名だけ**で描画。1位は王冠/淡いゴールド表示。同率1位を保持。HTMLを文字列で差し込まずtextContentを使用。再読込みエラー時は古いランキングを破棄。低負荷、動きを減らす設定に対応。
- `tests/combined-rank-only-publication.test.mjs`: 架空の自社＋協力店だけで、氏名・順位・金額禁止、同意解除/欠落/スナップショット不一致の拒否、HTTP CORS・偽装・期限失効・画面上のXSS耐性を検証。

## 絶対条件と残課題
- これらは**ライブラリと画面部品**。現行 `index.html` / Firebase Rules / LINE / Hosting / Cloudflare Workers / 本番Firestore・履歴を一切変更しない。
- 実画面へのメニュー追加と `nicofactory.web.app` 配備はしていない。接続先の認証付きサーバー実装、会社双方の公開同意取得、公共件数スナップショットの完全生成・同期、リクエスト/読取コスト上限、実機権限試験が必要。
- **生の金額付き原票のRules遮断と2媒体バックアップ・隔離復元が未完了のため本番NO-GO。** 画面の未接続を「稼働」と言わない。
- 表示件数を個人のみ非公開とする運用案よりさらに慎重な**全順位項目の件数・金額非公開**で作成した。件数表示を許す運用への変更は別の公開契約と承認が必要。
