# 實作契約

契約版本 1.0，對應資料 schemaVersion 1。下列契約是後續各模型共同遵守的邊界。

## 1. 資料契約

`config/example.json` 是虛構、隔離設定，不含秘密。

| 集合 | 必填關聯與規則 |
| --- | --- |
| sites | 永久 id 與名稱 |
| equipment | 永久 id、siteId、名稱及啟用狀態 |
| templates | id、version、整份簽名要求、items；項目含 id、label、method、photoPolicy |
| requirements | id、equipmentId、templateId、daily／monthly、schedule、啟用狀態 |
| people | 永久 id、虛構 label、roles、sites、active、可選 expiresAt、假 lineBinding |
| notificationRules | id、事件、明確 scope、接收角色、urgency、active |
| calendar | workingWeekdays、closedDates |

結果只允許 normal／abnormal／not_applicable；未填無預設。異常、不適用都要備註。日檢與月檢是不同 requirement，完成率以 requirement＋period 去重，不按紀錄筆數累加。

範本僅示範格式，不是完整法定表。設定核定及期間需求凍結尚未實作，現在只在檢查意圖內保存當次設定／需求／範本快照。後續不得以此取代完整設定版本庫。

## 2. 核心命令契約

本機介面為 `KitService.execute(context, command)`，沒有 HTTP。`context` 交由驗證替換層處理；command 不接收 actorId、姓名或角色。

共同輸入：`requestId`、`type`。原型 requestId 為 8–100 位英數／連字號／底線。一次真實操作一個 ID，重送同 ID 內容必須一致。正式端點另驗 body 型別、欄位上限與內容規格。

| type | 額外欄位 |
| --- | --- |
| inspect | requirementId、templateVersion、period、actualAt、answers、signatureRef |
| event | siteId、category、urgency、description、actualAt |
| claim | caseId、expectedVersion、expectedStatus |
| takeover | 同 claim 加 reason |
| report | 同 claim 加 description、completedDate |
| confirm | 同 claim 加 comment |
| return／reopen | 同 claim 加 reason |

成功回 requestId、actionId、status 與紀錄／案件識別。`complete` 只指本次業務列讀回完成，不代表 PDF、LINE 或實際業務已完成。錯誤 KitError.code 例如 FORBIDDEN、VERSION_CONFLICT、REQUEST_CONTENT_CONFLICT、SYNC_PENDING、RECOVERY_REQUIRED、BUSY、PRODUCTION_NOT_IMPLEMENTED。

## 3. 業務狀態

設備異常：pending（待處理）、in_progress（處理中）、awaiting_confirmation（待確認）、closed（已結案）。

事件初始為 reported（已通報），之後共用接案、回報與確認邏輯。處理完成與主管／指定確認人確認分開。退回與重開留歷程；處理人失格可接手，但未讀 LINE 不算失格。管理角色不隱含處理／確認權。

同設備同項目未結案，新的異常發現併原案、增加版本及歷程，不重推。結案後新發現另開新案並連結前案。新的檢查不能把尚未結案項目直接填正常。

查詢如遇未完成互斥意圖，status 為 syncing，projectedStatus 只供解釋技術現況，不能當成已結案。UI、PDF、進度都須用同一完成界線。

## 4. 替換層契約

| 層 | 核心需要 | 真實實作的必要證據 |
| --- | --- | --- |
| Identity | authenticate(context) 回穩定 subject | 驗證簽章／受眾／簽發者／時效，映射人員，撤權及跨場域負向測試 |
| Repository | withLock、get、list、put、ensure | 持久化快照、同專案鎖、穩定列核對、分段／租約／fencing、部分配額失敗及還原 |
| Files | 私有內容驗證、穩定檔案識別、授權下載 | 照片／簽名摘要由伺服器核對，無公開權限，PDF 與紀錄一致，補產不改內容 |
| Notify | 固定通知工作、每人 Push、接受證據 | 首輪保存 UUID Retry Key、固定內容、有限期限／嘗試、目前資格交集、遲到結果及撤權 |
| Web | 未填表單、requestId 維持、逐階段顯示 | 手機／平板、登入頁、過期版本、重整恢復、操作人與下載權限；無前端共用秘密 |

目前只有 Node MemoryRepository、sandboxIdentity 和歸檔描述。productionAdapters 全部 throw，禁止繞過。

## 5. 通知與讀取

通知事件只有 opened、awaiting_confirmation、returned、reopened。確認結案、再次發現、接手及跨日不自動催辦。

預覽按明確規則、事件、場域／設備、角色、啟用、查看及綁定篩選。原名單固定，後續每次發送只取目前合格者交集，不自動新增或轉送。returned／reopened 只取現任合格處理人。

原型 notificationPreview 只有 admin 能查看全名單。一般中控查詢不能取得他人通知綁定或完整操作表。

## 6. 恢復與移植

accepted 意圖包含固定命令、摘要、操作者、目標保留與完整步驟。每步查實際列，已有內容不符即凍結。原型一般恢復最多三次，這是測試值，不是正式配額與效能核定。

原型 recoveryReport、voidUnusedIntent 僅示範管理者核對零副作用意圖及同 ID 續作。無外部網路、無在途外部請求，才能在此測零副作用。真實層須先證明舊工作靜止、凍結與修復世代、報告時效、裁定及審計全部完成。存在任何業務副作用不能作廢意圖。

未知 schemaVersion 必須在任何寫入前拒絕。前端、核心、儲存 schema 及部署版本分別記錄。遷移須先在備份複本測試，不自動降版、不清空資料表。
# 0.2.0 隔離替換層補充

共用 Web RPC 僅接受 `action`／`command`／`id`，Google 不提供 actor 切換。`bootstrap` 回傳有範圍的畫面資料，不回傳 email、資源 ID、身分綁定或部署 ID。`pdf` 回傳授權的示範 bytes，不能用於正式簽名報告。

Google Store schema 1 使用 table、id、revision、part、parts、checksum、body 七欄；part=-1 代表封存。內容分段帶 J: 文字前綴，摘要帶 h:。完整分段及摘要核對後才寫 seal；未封存版本不公開，已封存版本損壞則拒絕。單次表最多 10,000 列、單 payload 2M 字元、最多128段，超限拒絕。此為試行停止條件，不是已證明生產容量。

本機 HTTP 只綁 127.0.0.1、檢查 Host／Origin／CSRF。其角色 fixture 不能用於公開主機。Google 身分核定表只存後端 Script Properties；拒絕空 active user，不以 effective user 取代。
