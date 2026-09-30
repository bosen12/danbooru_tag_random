/**
 * 字盒的「920 / 1572 張」：少掉的牌去哪了。
 *
 * 以前原因只寫在 title 裡，滑鼠停上去才看得到 —— 手機沒有滑鼠，看到的只是一個沒滿的數字。
 * 現在張數本身是一顆鈕：有牌被收起來時點一下，底下展開一行，一條條說是誰收的，
 * 能一鍵放回來的（開男生、全部時代、清掉篩選）附一顆小鈕。全部都看得到時它就只是數字。
 *
 *   const why = mountWhy(countButton, panel);
 *   why.update(shown, total, [{ n, text, action?: { label, run } }]);
 */
import { el } from "./ui.js";
import { reducedMotion, DUR, CURVE, css } from "./motion.js";

export function mountWhy(button, panel) {
  let open = false;
  let last = "";

  const setOpen = (v) => {
    open = v;
    button.setAttribute("aria-expanded", v ? "true" : "false");
    panel.dataset.open = v ? "true" : "false";
    panel.inert = !v;
  };
  setOpen(false);

  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    setOpen(!open);
  });

  return {
    update(shown, total, reasons) {
      const list = reasons.filter((r) => r.n > 0);
      const missing = total - shown;
      const num = button.querySelector(".why-num");
      const text = `${shown} / ${total} 張`;
      if (num.textContent !== text) {
        const first = !num.textContent;
        num.textContent = text;
        // 數字換了輕輕落定一下（跟頁面上其他會變的數字一樣）；第一次畫不動。
        if (!first && !reducedMotion()) {
          num.animate([{ opacity: 0.45, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: DUR.short, easing: css(CURVE.out) });
        }
      }
      const quiet = missing <= 0 || !list.length;
      button.setAttribute("aria-disabled", quiet ? "true" : "false");
      button.title = quiet ? `字盒共 ${total} 張，全部都看得到` : `少了 ${missing} 張，點一下看為什麼`;
      if (quiet && open) setOpen(false);
      const key = list.map((r) => r.n + r.text + (r.action?.label || "")).join("|");
      if (key === last) return;
      last = key;
      panel.firstElementChild.replaceChildren(
        el("p", { class: "why-lead" }, `少掉的 ${missing} 張：`),
        el(
          "ul",
          { class: "why-list" },
          list.map((r) =>
            el(
              "li",
              {},
              el("b", {}, r.n),
              el("span", {}, r.text),
              r.action
                ? el(
                    "button",
                    {
                      class: "link-btn pressable why-fix",
                      type: "button",
                      onclick: () => {
                        r.action.run();
                        button.focus({ preventScroll: true });
                      },
                    },
                    r.action.label
                  )
                : null
            )
          )
        )
      );
    },
  };
}
