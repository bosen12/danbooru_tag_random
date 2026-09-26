/**
 * 詞庫只抓一次、只解析一次。排字匣的 boot.js 和卡牌模式（tag-cards.js）以前各抓一份：
 * 開頁時同一個 340 KB 的 JSON 走兩趟網路（遠端時各一趟來回）、解析兩次。
 */
let pending = null;

export function loadLexicon() {
  if (!pending) {
    pending = fetch("lexicon.json").then((r) => {
      if (!r.ok) throw new Error("lexicon.json HTTP " + r.status);
      return r.json();
    });
    // 失敗了下一個人要能重試（boot.js 有「重新載入」按鈕），不要把壞掉的 promise 留著。
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
