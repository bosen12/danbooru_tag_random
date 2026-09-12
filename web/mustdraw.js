// 必抽：小分類標題旁的步進器。0 的時候只是一顆安靜的「必抽」小字，
// 按下去才展開成 − 1 ＋，整個小分類左緣亮一條硃砂色的界尺。
//
// 這支只管介面。實際怎麼抽在 engine.js 的 drawOne()：必抽跑在骨架與通用補牌之前，
// 名額算進左欄的「每段抽幾個」，權限大於時代，但互斥絕不破。

import { MUST_MAX } from "./engine.js";

const nodes = new Map(); // key -> { host, sub, label }
let read = () => 0;
let write = () => {};

export function initMustDraw({ get, set }) {
  read = get;
  write = set;
  nodes.clear();
}

function clamp(n) {
  return Math.max(0, Math.min(MUST_MAX, Math.floor(Number(n) || 0)));
}

function paintOne(key) {
  const rec = nodes.get(key);
  if (!rec || !rec.host.isConnected) return;
  const n = clamp(read(key));
  const { host, sub, label } = rec;
  host.dataset.on = n ? "1" : "0";
  if (sub) sub.classList.toggle("is-must", n > 0);
  host.replaceChildren();

  if (!n) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "must-add";
    add.textContent = "必抽";
    add.title = `每張都要抽到「${label}」`;
    add.setAttribute("aria-label", `設定「${label}」必抽`);
    add.addEventListener("click", () => bump(key, 1));
    host.append(add);
    return;
  }

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "must-step";
  minus.textContent = "−";
  minus.setAttribute("aria-label", `「${label}」必抽減一，目前 ${n}`);
  minus.addEventListener("click", () => bump(key, -1));

  const out = document.createElement("b");
  out.className = "must-n";
  out.textContent = `必抽 ${n}`;
  out.setAttribute("aria-live", "polite");

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "must-step";
  plus.textContent = "＋";
  plus.disabled = n >= MUST_MAX;
  plus.setAttribute("aria-label", `「${label}」必抽加一，目前 ${n}`);
  plus.addEventListener("click", () => bump(key, 1));

  host.append(minus, out, plus);
}

function bump(key, d) {
  const next = clamp(read(key) + d);
  write(key, next);
  paintOne(key);
  const rec = nodes.get(key);
  const focus = rec && rec.host.querySelector(next ? ".must-step:last-child" : ".must-add");
  focus?.focus();
}

// 給 buildCats() 用：回一個掛在 .sub-head 上的控制項。
export function mustStepper(sub, sectionId, group, label) {
  const key = `${sectionId}:${group}`;
  const host = document.createElement("div");
  host.className = "must";
  host.dataset.key = key;
  nodes.set(key, { host, sub, label });
  paintOne(key);
  return host;
}

export function syncMustDraw() {
  for (const key of [...nodes.keys()]) {
    const rec = nodes.get(key);
    if (!rec || !rec.host.isConnected) nodes.delete(key);
    else paintOne(key);
  }
}

// 卡片上的「必抽 誘惑 1/3」交代：只在真的沒抽滿時出現。
export function mustShortfall(report, zhOf) {
  const miss = (report || []).filter((r) => r && r.got < r.want);
  if (!miss.length) return "";
  return (
    "必抽沒抽滿：" +
    miss.map((r) => `${zhOf(r.group)} ${r.got}/${r.want}`).join("、")
  );
}
