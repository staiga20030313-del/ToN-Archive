# ToN Archive — .NET版との移植差分・改善台帳

更新日: 2026-10-28 (JST)  
正本: `staiga20030313-del/ToN-Round-Records` (`ToNRoundRecords/`)  
移植先: `staiga20030313-del/ToN-Archive` (`index.html`, `assets/`)  
公開先: `https://ton-archive.pages.dev/`

このファイルは次回の作業でまず読むこと。**すでに実装した内容を憶測で再実装しない**。両方の現行ソースを見てから差分を特定する。修正後は保存済みレコードとの互換性、構文チェック、機能テストを確認する。更新をGitHubに直接commitし、ZIPは不要。

## 重要な仕様（元.NET版の根拠）

- `MainForm.AddOrUpdate`: ラウンド・選択可能ラウンドのテラー・マップは必須。MidnightはClassic2＋Alternate1、BloodbathはBB3/DT2/EX1。Unboundは1組。Moon/Other 1,2,5はテラー選択不可。選択不可アイコンを保存しない。
- `Models.PlayerValues`: 空欄=null、`?`=-1、既知値0〜22、既知値に限り「新規生存≦生存≦参加」。人数矛盾時は枠を赤く。
- `MainForm.SelectItem`: テラー1枠では別テラーを直接クリックして変更可能。ラウンド選択後は一覧を開いたままにする。
- `RecordsCanvas`: 左右2列、ラウンド名途中から枠線、Highlightsは左上かつ二重線。IconHeaderHeight=25、NormalEntryHeight=48、TerrorSize=32、UnboundSize=38。ラウンド/記録のつまみを分け、同ラウンド内のドラッグとラウンド列移動、右クリックの拡大/太字/Highlights、PNG出力あり。
- `Controls.SelectorPanel`: Classic 134（11列×12＋左下2）、Alternate 36（11/9/7/5/3/1）、8 Pages限定7、Unbound 84。MAPは9列×9行（最終行は右2つのみ）。
- `VrcLogDetector`/`VrcLogImportForm`: ログのラウンド・MAP・テラー・日時・結果を証拠ベースで認識し、候補を確認・選択して取り込む。生存/参加の推定を確定値とみなさない。

## 現行ブラウザ版で実装した機能（コードで確認した範囲）

- [x] Cloudflare PagesとGitHub連携。GitHubへ直接反映。
- [x] 入力左1/6、成果まとめ右5/6、追加予定プレビュー。
- [x] 元画像アトラス: ラウンド13・Classic134・Alternate36・8 Pages7・Unbound84・マップ74。
- [x] カラールール、保護ピクセル、出現不可、置換15、低確率バリアント6、Unboundバリアント2。
- [x] 全30件の特殊/限定/バリアント名と基本テラー名。実ゲーム更新後の名称精度は定期確認。
- [x] MAP画像、左黒帯の名称、長い名前の2行描画、PixelMplus12。
- [x] Highlights、アイコン/テキスト切替、編集つまみ、ラウンドの左右移動、PNG/JSON出力。
- [x] .NET版と同じ必須入力チェック・人数?と-1の保存・0〜22制限・赤枠・1枠テラー直接切替（2026-10-28実装）。
- [x] 元の.NET版の `records.json`（PascalCase `Sessions/Records`）の取込、T/ALT/8P/UB IDの変換、保存済み装飾/列/ラウンド順の継承（2026-10-28実装）。Web JSON形式の読み込みも維持。
- [x] Chrome上でのローカル保存（localStorage）とWeb JSONバックアップ出力。

## 未対応・検証が必要な点（高い順）

1. **VRChatログ取込（未実装）** — ホストされたブラウザから `AppData\\LocalLow\\VRChat\\VRChat` を無許可で自動監視することはできない。まずユーザーがTXT/ログフォルダを指定する、確認付き手動取込を実装。最新版 `VrcLogDetector.cs` と `TerrorLogMappings` を優先し、推定値を確定値として記録しない。対応ブラウザなら File System Access API で明示許可付きの読み込みも検討。
2. **MAP一覧の視認性/フォント** — 全74件はロジック検証済みだが、実ブラウザ・ズーム100/125/150%の視覚QA未実施。PixelMplus12 CDN が利用可能か、縮小描画で潰れないか確認。必要なら文字と画像を別レイヤーにし、テキストの圧縮禁止。
3. **成果まとめの.NET描画との一致** — 25px見出し・48px行・左右2列・Highlights枠線・人数/MAP/テラーの比例位置・追加アイコン・拡大行を実ブラウザで再確認。PNGもDOMと同じ座標系へ一致させる。画面幅によって列が狭い場合のはみ出しを特に確認。
4. **集計の並べ替え仕様** — 元コード `BuildIconColumns/MoveRound/MoveRecord` に照らし、サブラウンドごとの枠線、同名見出しの扱い、ドラッグによる自動列高さ調整、編集つまみ非表示、移動後の永続化をさらにテスト。
5. **入力パネルの操作** — 元の `NumberStepper` には上下矢印と不明値がある。ブラウザ版は現在テキスト入力のため、操作感の差分あり。ユーザーの左1/6幅・上段2アイコン配置を優先し、必要に応じて小型ステッパー追加。
6. **公式ログID・テラー名の完全性** — ソースの `terror_log_mappings.json` はログIDが明示されている場合のみ採用すること。基本の名前は当初推測配列でずれていたため、元の対応表と随時比較。
7. **ブラウザデータのバックアップ** — localStorageは端末/ブラウザ依存。JSON書き出しはあるが自動同期はない。ユーザーの明示的な操作なしにクラウド保存を行わない。
8. **設定/切り抜きエディター** — 元リポジトリ内 `ToNIconCropEditor` は別の開発者向けツール。ブラウザ版に必須とは限らない。取り込む場合も既存の選択UIや配置を壊さない。

## 次回の作業手順

1. GitHub両リポジトリの `main` を取得し、この台帳と最新コードを比較する。
2. 最上位の未対応項目から1つ安全に修正する。予定済みの変更を重複適用しない。
3. 修正前後のJavaScript構文、元JSON/Web JSONの取り込み、MAP/テラーの選択、人数0/?/不正値を可能な範囲で自動テストする。
4. GitHubへcommit、`https://ton-archive.pages.dev/` の自動デプロイ設定を利用する。GitHubにcommitしたことと、実サイトに反映済みかの確認は分けて報告する。
5. **この台帳を更新**して完了/残課題を明記する。既存の成果データを破棄・上書きしない。
