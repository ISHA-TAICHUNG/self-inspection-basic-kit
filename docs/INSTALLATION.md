# 本機隔離安裝與核定

版本 0.2.1｜2026-10-06。這是本機 Low-Code 配置接線，不是正式一鍵雲端部署。日常不呼叫 LLM、不發 LINE、不安裝觸發器、不建立 Google 資源。

## 安裝流程

1. 在獨立套件目錄準備 Node.js 22 或更新版本。依 README 安裝固定版本依賴；安裝命令不可在正式專案執行。
2. 使用 `npm run install:sandbox -- --input config/example.json` 預覽摘要。可加 `--prepare-environment` 執行套件自己的 npm 安裝；不自動安裝 Python、clasp 或雲端工具。
3. 人員核對設備、原始檢查文字、日／月週期、角色／場域與通知範圍後，核定摘要。不要只核對 hash 而不看配置內容，也不要把真人身分或憑證交給聊天模型。
4. 執行同一 input，加上 `--apply --approve "已核定的configDigest"`。測試、示範與候選檔檢查成功才套用；configDigest 在讀取設定後重新計算，配置被更動會拒絕。
5. 安裝回報 `applied: true`、`readback: true` 後啟動 `npm start`，核對表單與中控台。安裝命令不常駐啟動服務。

自訂隔離配置可用 `--home .local/customer-demo`。啟動服務必須使用同一 home，例如 macOS／Linux 的 `KIT_HOME=.local/customer-demo npm start`；PowerShell 可先設定 `$env:KIT_HOME='.local/customer-demo'` 再執行 `npm start`。Windows 尚需實機驗證，不以 macOS 測試宣稱跨平台驗收。

## 安裝事實與重跑

- `.local/active-installation.json` 是啟用指標；`.local/installations/摘要/config.json` 是核定設定，`receipt.json` 是安裝摘要，`data/state.json` 保存隔離紀錄。
- 設定與摘要檔只建立、不覆寫。相同配置可重跑，回報 `reused: true`，已有紀錄保留；不同配置回報 `INSTALL_CONFIG_MIGRATION_REQUIRED`，請使用新隔離 home，不能刪舊紀錄繞過。
- 安裝與資料 writer 使用分開的排他 lease。安裝程序只釋放自己取得的 lease，不能釋放其他程序的鎖。程序異常退出的殘留鎖不自動刪除，先停止並請維護者核對。
- 已有安裝檔但缺啟用指標時，服務回報 `INSTALL_ACTIVATION_REQUIRED`，不改用範例；同設定的核定安裝可在沒有其他 writer 時續作。損壞資料須人工核對，不回退舊資料假裝成功。
- 本機未配置時仍可開啟原隔離範例，舊 `.local/sandbox` 不搬移、不刪除；這不是配置驗收。
- 本機 PDF 依賴 Python 3／ReportLab，須另測 PDF 產製。安裝成功不代表 PDF、Google 或 LINE 驗收成功。

## 正式使用仍待完成

Google 真人多人及撤權、Google 配置接線、本人簽名、私有雲端 PDF、備份還原、故障復原、效能與限定 LINE 收件。照片可另核定第一版範圍；目前配置中要求照片會直接拒絕，不接受未實作功能。

## 清理界線

GitHub 原始碼發布、停止本機程序、撤除 Web App、回收雲端資料與刪除本機檔案是不同動作。只清理精確識別且由此次隔離測試建立的資源；先列清單取得同意。不得刪本會正式專案、其他帳號既有檔案、授權憑證或其他專案服務。原始碼與測試證據預設保留，沒有另外同意不能擴大刪除。
