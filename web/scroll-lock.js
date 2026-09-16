// 開彈窗時鎖住背景捲動。
//
// 原本這件事在三個檔案裡各寫一次 `document.body.style.overflow = "hidden"`，
// 而且各自維護一份「還有沒有別的彈窗開著」的選擇器清單 —— telegram 那份漏了
// shortcuts 與 discord，discord 那份漏了 shortcuts，lora.js 則完全沒鎖，
// 但它的彈窗又出現在別人的清單裡。
//
// 更根本的是那樣鎖不到東西。boot.css 給 html 設了 overflow-x: clip，所以 html 的
// overflow 不是 visible，body 的 overflow 就不會再往視窗傳遞（那條傳遞規則只在
// html 是 visible 時成立）。結果 body 只是自己變成一個捲動容器 —— 背景照捲，
// 而且 .rail 的 position: sticky 參考對象被換成 body（scrollTop 恆為 0），
// 黏性當場失效：捲到 900 再開彈窗，左欄會往上跳 900px，關掉又跳回來。
//
// 鎖在真正的捲動元素（html）上，兩件事同時解決。實測 .rail 的 y：
//   未鎖 82 / body:hidden -817.6 / html:hidden 82
//
// 用集合而不是計數器：開兩次、關兩次、關到一半又被別的路徑關掉，都不會把
// 深度算錯而永遠解不開鎖。
const openKeys = new Set();
let saved = null;

export function lockScroll(key) {
  if (!key) return;
  if (!openKeys.size) saved = document.documentElement.style.overflow;
  openKeys.add(key);
  document.documentElement.style.overflow = "hidden";
}

export function unlockScroll(key) {
  if (!key || !openKeys.has(key)) return;
  openKeys.delete(key);
  if (openKeys.size) return;
  document.documentElement.style.overflow = saved || "";
  saved = null;
}

// 測試用：目前有幾個東西押著這把鎖。
export function scrollLockCount() {
  return openKeys.size;
}
