/**
 * 計分動畫：照 rules.score() 回傳的 steps 一格一格播。
 * 畫面上演的就是實際算的 —— 不會有「動畫說 300、帳上是 280」這種事。
 */
import { HAND_TYPE } from "./rules.js";
import { ERA_ZH } from "./pool.js";
import { sfx, sleep, pop, bump, wiggle, shake, fmt, fmtMult, reduced } from "./fx.js";
import { el, setFlag } from "./ui.js";

const FLAG = { clash: "撞字", era: "不合時代", debuff: "不計分", void: "不計分" };

/**
 * refs:
 *   stage      放牌的那一排（flex）
 *   threads    stage 上的 <svg>，畫呼應的紅線
 *   nodes      Map(instId → 卡牌節點)
 *   jokers     道具節點陣列（照擺放順序）
 *   readout    {type, chips, mult, total, hint}：要更新的元素（左欄與手機小列可能各有一份）
 */
export async function playScoring(world, ev, res, refs, level = 1) {
  const R = refs.readout;
  const first = res.steps[0];
  R.forEach((r) => {
    r.type.textContent = HAND_TYPE[ev.type].zh;
    if (r.lv) r.lv.textContent = "Lv " + level;
    r.chips.textContent = fmt(first.chips);
    r.mult.textContent = fmtMult(first.mult);
    if (r.total) r.total.textContent = "";
    if (r.hint) r.hint.textContent = ev.era && ev.era !== "any" ? `這張圖的時代：${ERA_ZH[ev.era] || ev.era}` : "";
  });
  sfx.clack();
  await sleep(420);

  for (const it of ev.items) {
    if (it.status === "ok") continue;
    const node = refs.nodes.get(it.inst.id);
    if (!node) continue;
    node.dataset.state = "burn";
    setFlag(node, it.status === "debuff" || it.status === "void" ? "debuff" : it.status, FLAG[it.status] || "不計分");
    shake(node);
    sfx.burn();
    await sleep(320);
  }

  let n = 0;
  const setChips = (v) => R.forEach((r) => (r.chips.textContent = fmt(v)));
  const setMult = (v) => R.forEach((r) => (r.mult.textContent = fmtMult(v)));

  for (const s of res.steps.slice(1)) {
    if (s.at === "card") {
      const node = refs.nodes.get(s.id);
      bump(node, 1.1);
      pop(node, "+" + fmt(s.chips), "chips");
      setChips(s.total.chips);
      sfx.chip(n++);
      await sleep(s.again ? 260 : 300);
    } else if (s.at === "enh") {
      const node = refs.nodes.get(s.id);
      bump(node, 1.06);
      if (s.chips) {
        pop(node, "+" + s.chips, "chips");
        setChips(s.total.chips);
        sfx.chip(n++);
      } else if (s.mult) {
        pop(node, "+" + fmtMult(s.mult), "mult");
        setMult(s.total.mult);
        sfx.mult();
      } else if (s.xmult) {
        pop(node, "×" + fmtMult(s.xmult), "xmult");
        setMult(s.total.mult);
        sfx.xmult();
      }
      await sleep(280);
    } else if (s.at === "ghost") {
      const parent = refs.nodes.get(s.id);
      const slug = el("span", { class: "ghost-slug", "aria-hidden": "true" }, world.byTag.get(s.tag)?.zh || s.tag);
      if (parent && parent.parentNode) parent.after(slug);
      refs.onGrow && refs.onGrow();
      pop(slug, "+" + s.chips, "chips");
      setChips(s.total.chips);
      sfx.chip(n++);
      await sleep(240);
    } else if (s.at === "pair") {
      const a = refs.nodes.get(s.a);
      const b = refs.nodes.get(s.b);
      thread(refs, a, b);
      bump(a, 1.05);
      bump(b, 1.05);
      pop(b, "+" + fmtMult(s.mult), "mult");
      setMult(s.total.mult);
      sfx.mult();
      await sleep(340);
    } else if (s.at === "joker") {
      const jn = refs.jokers[s.idx];
      const target = s.id !== undefined ? refs.nodes.get(s.id) : null;
      wiggle(jn);
      if (s.chips) {
        pop(target || jn, "+" + fmt(s.chips), "chips");
        setChips(s.total.chips);
        sfx.chip(n++);
      }
      if (s.mult) {
        pop(target || jn, "+" + fmtMult(s.mult), "mult");
        setMult(s.total.mult);
        sfx.mult();
      }
      if (s.xmult) {
        pop(target || jn, "×" + fmtMult(s.xmult), "xmult");
        setMult(s.total.mult);
        sfx.xmult();
      }
      if (target && jn) pop(jn, "!", "note");
      await sleep(300);
    } else if (s.at === "zero") {
      for (const node of refs.nodes.values()) {
        node.dataset.state = "burn";
        shake(node);
      }
      R.forEach((r) => r.hint && (r.hint.textContent = s.reason));
      sfx.burn();
      await sleep(700);
    } else if (s.at === "final") {
      setChips(s.chips);
      setMult(s.mult);
      await sleep(160);
      R.forEach((r) => {
        if (r.total) r.total.textContent = fmt(s.total);
      });
      sfx.stamp();
      await sleep(560);
    }
  }
}

/** 呼應：兩張牌頭上牽一條朱紅線。 */
function thread(refs, a, b) {
  const svg = refs.threads;
  if (!svg || !a || !b) return;
  const box = svg.getBoundingClientRect();
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const x1 = ra.left + ra.width / 2 - box.left;
  const x2 = rb.left + rb.width / 2 - box.left;
  const y = Math.min(ra.top, rb.top) - box.top + 4;
  const lift = Math.max(18, Math.abs(x2 - x1) * 0.28);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${x1} ${y} C ${x1} ${y - lift}, ${x2} ${y - lift}, ${x2} ${y}`);
  svg.append(path);
  if (reduced) return;
  const len = path.getTotalLength ? path.getTotalLength() : 200;
  path.style.strokeDasharray = String(len);
  path.style.strokeDashoffset = String(len);
  path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 300, fill: "forwards", easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  setTimeout(() => (path.style.strokeDashoffset = "0"), 320);
}
