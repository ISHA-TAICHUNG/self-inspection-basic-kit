/** ISHA 基礎套件隔離試行。僅本人 Google 登入，不發 LINE、不安裝排程。 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('自主檢查管理｜隔離試行');
}

function kitRpc(payload) {
  return KitCore.rpc(payload);
}

function kitSetupSandbox() {
  return KitCore.setup();
}
