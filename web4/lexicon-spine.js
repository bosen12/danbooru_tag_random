/**
 * 詞庫左邊的分類脊：捲到哪一類就亮哪一類。
 *
 * 置中的詞庫只有字庫區自己捲，分類脊一直在原位 —— 但只是一排連結的話，
 * 看不出現在捲到哪裡。這裡只做一件事：把「標題已經捲過門檻的最後一類」標成 aria-current。
 * 樣式在 web4/styles.css 的 .lex-panel .jump a[aria-current="true"]。
 */

/** sections 依畫面順序排好，top 是各類標題相對視窗的位置；回傳目前在看的那一類。 */
export function sectionAt(sections, threshold) {
  if (!sections.length) return null;
  let current = sections[0].id;
  for (const s of sections) {
    if (s.top <= threshold) current = s.id;
    else break;
  }
  return current;
}

export function paintSpine(links, id) {
  for (const a of links) {
    if (id && a.hash === "#" + id) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
}

function watch() {
  const cats = document.getElementById("cats");
  const sheet = document.getElementById("lex-sheet");
  if (!cats || !sheet) return;
  const update = () => {
    if (sheet.hidden) return;
    // 手機上 boot.js 會把 .jump 搬到頁面層（pinJumpNav），所以每次重新找。
    const nav = document.querySelector(".jump");
    if (!nav) return;
    const threshold = cats.getBoundingClientRect().top + 24;
    const sections = [...cats.querySelectorAll(":scope > .cat")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }));
    paintSpine(nav.querySelectorAll("a[href^='#sec-']"), sectionAt(sections, threshold));
  };
  cats.addEventListener("scroll", update, { passive: true });
  // 打開詞庫、切篩選（分類會出現或消失）時也重算一次。
  new MutationObserver(update).observe(sheet, { attributes: true, attributeFilter: ["class", "hidden"] });
  new MutationObserver(update).observe(cats, { childList: true });
}

if (typeof document !== "undefined" && typeof document.getElementById === "function") watch();
