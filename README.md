# 事業單位自主檢查與異常通報基礎套件

版本 0.2.0｜隔離試行版｜2026-10-06

讓事業單位以自己的設備、檢查表及通知名單，建立行動自主檢查與異常追蹤工具。
協會分享程式與建置方法，事業單位自行持有帳號與資料；日常檢查不需要呼叫大語言模型。

**目前是供審查、學習與隔離試行的套件，不是可直接正式填報的完整產品。** 已提供每日／每月行動表單、設備異常與事件流程、中控查閱、持久化替換層及示範 PDF。Google 版採核定名單，目前部署格式限專案擁有者；LINE 僅預覽虛構收件名單，沒有發送器或排程。正式簽名、照片、一般 Google 使用者整合及正式復原驗收仍待完成。

## 先看哪些文件

- [START_HERE.md](START_HERE.md)：人員與模型的共同入口。
- [ARCHITECTURE.md](ARCHITECTURE.md)：架構、模組邊界與後續微調原則。
- [SETUP_FOR_AI.md](SETUP_FOR_AI.md)：AI 建置步驟與不能跳過的門檻。
- [prompts/BUILD_WITH_AI.md](prompts/BUILD_WITH_AI.md)：可貼給 ChatGPT、Gemini、Claude 的通用提示詞。
- [docs/CONTRACTS.md](docs/CONTRACTS.md)：資料、API 與替換層契約。
- [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)：已完成與尚未完成項目。
- [docs/REVIEW_HANDOFF.md](docs/REVIEW_HANDOFF.md)：審查範圍與證據要求。

## 一鍵跑隔離範例

需要 Node.js 22 或更新版本。前端使用 Lucide 圖示，esbuild 產生 Web 與 Apps Script 版本。程式的日常流程不呼叫 LLM。

```bash
npm install --ignore-scripts --package-lock=false
npm test
npm run demo
npm start
npm run configure
npm run check:release
```

`test` 先建置再測試；`demo` 為不留存的記憶體範例。`start` 開啟 [本機隔離介面](http://127.0.0.1:4317)，只能從本機存取，資料留在 `.local/sandbox`，可重啟讀回。**示範角色切換只存在於 loopback，不得代理或部署到公開主機。** 本機示範 PDF 另需 Python 3 的 ReportLab；可用 `KIT_PYTHON` 指定已安裝的 Python。未安裝時明確拒絕產製，不假裝已歸檔。

`configure` 產生 `.local/config.draft.json`，既有檔案不覆寫，不代表已套用設定。只有 `--input <JSON 路徑>`，不能輸入 Token。Google 隔離部署見 [docs/GOOGLE_TRIAL.md](docs/GOOGLE_TRIAL.md)。所有私人 ID、身分綁定及部署紀錄只放 `.local` 或後端 Script Properties。

提示詞可以一次交給常見 AI 工具協助建置，但不能替使用者完成帳號授權、核定檢查義務或正式驗收。完整生產系統的「一鍵部署」仍是後續方向。

`npm run package:review` 只打包通過候選檔案檢查的審查 ZIP，不帶 `.local` 或 Git 歷史，不公開發布。既有審查包不覆寫。

## 第一版六項功能

| 功能 | 基礎版目標 |
| --- | --- |
| 設備及表單設定 | 永久設備編號、每日／每月需求、版本化範本、QR 一般入口 |
| 行動檢查 | 逐項選正常／異常／不適用，按範本記錄備註、照片與整份簽名 |
| 設備異常追蹤 | 指定 LINE 通知，接案、處理回報、確認、結案及歷程 |
| 簡易事件通報 | 地點、類型、緊急程度、說明、指定通知及後續追蹤 |
| 電子紀錄歸檔 | 私有 PDF、依設備／期間查詢及授權下載 |
| 簡易中控台 | 每日／每月進度、未結案件、通知／工作健康及更新時間 |

範例項目只用於程式測試，不是一份完整或經法規核定的堆高機／起重機檢查表。事業單位必須由合格人員核對自己的設備、檢查項目、方法與週期。

## 安全與責任

- 所有結果預設未填；AI 不判定設備正常、不代替檢查，不自動結案。
- LINE 是輔助通知，接受 API 請求不等於送達、已讀或接案。緊急聯繫依既有程序。
- 公開程式只含虛構範例，不含密碼、Token、真實名單、私人資料庫或案件連結。
- 不開資料庫與歸檔的「知道連結者可檢視」，不把共用 Token 放 GitHub Pages。
- 模型只協助建置與設定，不承諾免維護、永久零費用或已符合所有法規。

## 發布狀態

已公開於 [ISHA-TAICHUNG/self-inspection-basic-kit](https://github.com/ISHA-TAICHUNG/self-inspection-basic-kit)，版本 0.2.0 為隔離試行／學習用來源，不是正式營運版。此目錄不包含本會正式系統的 Git 歷史。實際發布及雲端驗證結果以 [實作狀態](docs/IMPLEMENTATION_STATUS.md) 為準。

本套件採 **MIT** 授權，授權文字見 [LICENSE](LICENSE)。第三方圖示另見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。`private: true` 防止誤發布到 npm，不限制 GitHub 原始碼分享。發布僅取本目錄明確清單，禁止從上層專案執行 `git add .`。
