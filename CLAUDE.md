# danbooru_tag_random（排字匣）

## 墨池（web6）改了，要同步到開源版

`web6/` 另外開源成 **`../danbooru_tag_mochi`**（https://github.com/bosen12/danbooru_tag_mochi，public）。那邊是複製，不會自動跟上。

**以下任何一個有改，commit 前都要同步：**
- `web6/` 底下任何檔
- web6 會載入的 `web/` 共用檔（`engine.js`、`card-art.js`、`rules/*`、`lexicon.json`、`lora.js`…）
- `server.py` 與它 import 的 `card_usage.py`、`card_decks.py`、`gen_log.py`、`lora_scan.py`、`recipes.py`、`workflows.py`、`config.example.json`
- 卡面／放大模型／姿勢參考的腳本（`scripts/fetch_*.py`、`bake_card_art.py`、`card_jobs.json`、`*-check.bat`…）
- `scripts/test_web6_i18n.mjs`

```bash
python scripts/sync_mochi.py --check   # 先看會動哪些檔
python scripts/sync_mochi.py           # 寫過去
cd ../danbooru_tag_mochi
node tests/test_i18n.mjs
git diff                               # 看過再 commit、push
```

- 腳本自己爬 web6 用到哪些 `web/` 檔，不必手動列；上游刪掉的檔，那邊也會刪掉。
- 開源版有幾處字樣不一樣（啟動檔叫 `start.bat`、預設埠 8796、卡面從自己的 Release 下載、影片裡的 clone 網址），寫在腳本的 `REWRITES`。印出 **WARN** 代表這邊改到那幾行：去改 `REWRITES`，不要到那邊手改。
- 開源版自己的檔不會被蓋：`README.md`（英文在上、中文在下）、`CLAUDE.md`、`start.bat`、`start.sh`、`.gitignore`、`.gitattributes`、`LICENSE`、`.github/`（CI）。功能改了、README 要跟著改的話，到那邊改。
- **發新的卡面包**（`card-art-vN`）：兩個 repo 的 Release 都要發同一個 zip，`scripts/fetch_card_art.py` 的網址各指各的（同步時 `REWRITES` 會換）。
- 只動到其他版面（web、web1～web5、web7、zipu、game）不用同步。

## 英文版（web6）

程式照舊寫中文，`web6/i18n.js` 在畫面畫好後把中文換成 `web6/locales/en.js` 的英文。
- 新增中文文案：`en.js` 補一行。模板裡的使用者內容（牌組、作品、模型名、搜尋字）用 `{0!}` 原樣插入。
- 「先比對畫面上的字再重寫」的程式，比對要用 `t(text)`：英文版畫面上永遠是英文，直接比中文永遠不一樣（會每次重畫、重播動畫）。
- 尺度＝Content level，分級＝Rating。
- 測試：`node scripts/test_web6_i18n.mjs`（快，在 test.bat 裡）；`node scripts/test_web6_i18n_browser.mjs`（掃畫面上漏翻的中文，約 5 分鐘）。
