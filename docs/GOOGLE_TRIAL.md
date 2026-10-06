# Google 私人隔離試行

版本 0.2.0。此流程只部署示範表單，不供正式業務填報。LINE、排程、正式簽名與照片停用。

## 1. 先決條件

- 單位持有自己的 Google 帳號與 Apps Script 使用權。
- 先跑 `npm test`、`npm run demo`、`npm run check:release`。
- 請人工核定使用全新隔離資源，不提供或匯入正式資料。
- 安裝 clasp，先確認登入的帳號。OAuth 授權由使用者在 Google 網頁完成，憑證不放本套件。

## 2. 明確建立新專案

下列命令會建立新雲端專案，必須先取得使用者同意。`-P .` 必須保留，防止 clasp 向上尋找其他 `.clasp.json`。

```bash
npm run build
cd .local/build/apps-script
clasp -P . create --type standalone --title 'Self Inspection Kit - Isolated Trial' --rootDir .
cd ../../..
npm run build
cd .local/build/apps-script
clasp -P . status
clasp -P . push -f
clasp -P . version '0.2.0 isolated trial'
clasp -P . deploy -V <上一指令產生的版本號> -d 'owner-only isolated trial'
```

`create` 會產生預設 manifest，因此第二次 build 恢復經審查的 manifest。部署前再次核對 `webapp.access=MYSELF`、`executeAs=USER_DEPLOYING`、時區及 scopes，不得包含 `external_request`。不要使用既有正式 deployment ID。

## 3. 初始化

使用專案擁有者登入新 Web App。點「建立隔離測試資源」，建立新私人 Sheet 與 Drive 示範資料夾。初始化可重入，不刪除、不匯入、不搬動既有資料。

真正帳號、資源 ID 與核定身分綁定存在 Script Properties，前端不接收這些值。初始僅將擁有者綁至 `sandbox-owner`；不能從前端送姓名、email 或 actorId 變更身分。

Session 可能取得不到 active user。此時直接拒絕，不使用 effective user 降級冒名。參考 [Google Session 官方說明](https://developers.google.com/apps-script/reference/base/session)。此模式只證明擁有者隔離試行，不能當作一般 Google 使用者登入已驗收。

## 4. 驗證與限制

測每日／每月、異常、事件、同 ID 重送、重新整理讀回、示範 PDF、未核定及空身分拒絕。處理人不能確認自己的處置，擁有者兼任也不例外；不同實際 Google 使用者的全流程另做受限測試。

核對新資源的 owner、permission 及沒有觸發器。不得啟用 anyone sharing，PDF 由授權 RPC 讀取，不回傳公開 Drive 連結。套件沒有 LINE 發送器，不需要 Token、不消耗 LINE 訊息額度。

尚未完成：一般使用者與撤權實測、本人簽名與照片、歷史分母、背景恢復、部分副作用人工修復、備份還原、真實配額與效能門檻、LINE 真實送達。任何一項未完成都不能宣稱已正式上線。
