# 開始使用

## 給事業單位

1. 先讀 [README 的 Low-Code 導入指南](README.md)，複製第 2 節安裝提示詞，交給自己的 AI 工具。現在可操作隔離表單與案件流程，尚不能正式填報或發 LINE。
2. 指定一位業務負責人及一位維護者，整理自己的設備、原始紙本表、每日／每月規則、場域與接收角色。
3. 需要完整步驟時使用 [BUILD_WITH_AI.md](prompts/BUILD_WITH_AI.md)；來源為已公開的 [ISHA-TAICHUNG/self-inspection-basic-kit](https://github.com/ISHA-TAICHUNG/self-inspection-basic-kit)，也可提供本套件檔案。
4. 模型先用虛構資料跑本機測試，再協助產生私有設定草稿；人工核對摘要後，使用 `install:sandbox --apply --approve` 套用本機示範，詳細流程見 [INSTALLATION.md](docs/INSTALLATION.md)。本機通過不代表雲端與 LINE 完成。
5. 授權、資料存取、真實 LINE 測試與正式上線各自確認，不把一個「開始」當成全部同意。

不要把真實人員名單或任何密碼／Token 貼到公開模型對話。用「檢查人 A」「處理人 B」等角色代號先討論，真實身分綁定只在單位自己的私有後端完成。

## 給可以操作檔案的 AI

依序讀 `AGENTS.md`、`ARCHITECTURE.md`、`docs/CONTRACTS.md`、`docs/IMPLEMENTATION_STATUS.md`、`SETUP_FOR_AI.md`。先安裝固定版本開發依賴，再跑 `npm test`、`npm run demo`。不要把假驗證器變成正式 API，不讀取上層專案、既有雲端帳號或任何憑證。部署須使用 `clasp -P <隔離建置目錄>` 明確選專案，不能讓 clasp 尋找上層設定。

## 給只能對話的 AI

模型未必能讀 GitHub 全部檔案，也未必能操作本機、Google 或 LINE。請使用者提供必要的去識別檔案，輸出配置草稿與步驟；明確列出「未執行」。不能宣稱已部署、已驗收或有收件人收到通知。

## 現在可以驗證的結果

本機命令能驗證角色／通知規則、表單欄位、跨週期區分、案件流轉、重送與部分寫入恢復。看到 `api_accepted` 的假測試結果也只代表分類函式，不是 LINE 實際送達。
