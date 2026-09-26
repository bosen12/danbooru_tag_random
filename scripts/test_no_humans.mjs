#!/usr/bin/env node
/**
 * 沒有人物（no humans）與人群（crowd／people）的規則。
 *
 * no humans 是一個模式，不是一般的字：釘了它那一張只抽場景（engine drawNoHumans），
 * 釘選時把在說人的牌拿掉（applyPin），跟人物的牌同時出現算相剋（contradictions）。
 * crowd／people 是主角以外的人：有它們又只有一個主角時寫 solo focus，不寫 solo；
 * 不會出現在臥室、浴室這種自己家裡的地方。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { applyPin, contradictions, defaultSettings, drawOne, indexLexicon, isPersonTag, mulberry32, sanitizeSettings } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const base = defaultSettings(data);

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}` + (detail ? `\n  ${detail}` : ""));
  }
}
const split = (p) => p.split(",").map((x) => x.trim()).filter(Boolean);

ok("詞庫有 no humans、scenery、solo focus、people，crowd／people 歸背景", ["no humans", "scenery", "solo focus", "people"].every((t) => lex.byTag.has(t)) && lex.byTag.get("crowd").group === "background" && lex.byTag.get("people").group === "background");

for (const [label, over] of [
  ["預設", {}],
  ["全年齡", { rating: "general" }],
  ["古中國", { eras: ["ancient_china"] }],
  ["只有性愛", { heats: ["sex"] }],
  ["男女都有", { girl: true, boy: true }],
]) {
  const s = sanitizeSettings({ ...base, ...over }, data);
  const bad = [];
  let scenery = 0;
  for (let i = 1; i <= 120; i++) {
    const d = drawOne(lex, s, new Set(["no humans"]), new Set(), mulberry32(3100 + i), 3100 + i, { trace: true });
    const tags = split(d.positive);
    if (tags[0] !== "no humans") bad.push("開頭不是 no humans");
    if (tags.includes("scenery")) scenery++;
    for (const t of tags) if (isPersonTag(lex, t)) bad.push(t);
    if (d.people !== 0 || d.female || d.male) bad.push("還有人");
    for (const k of d.trace?.kept || []) if (!tags.includes(k.tag)) bad.push("trace 多了 " + k.tag);
  }
  ok(`釘 no humans（${label}）：120 張沒有任何在說人的字`, !bad.length, [...new Set(bad)].slice(0, 6).join("、"));
  ok(`釘 no humans（${label}）：大多數帶 scenery`, scenery > 60, `${scenery}/120`);
}

{
  const d = drawOne(lex, base, new Set(["no humans", "white background"]), new Set(), mulberry32(1), 1);
  ok("素色背景上沒有人：不帶 scenery（比較像靜物）", !split(d.positive).includes("scenery") && split(d.positive).includes("white background"), d.positive);
  const d2 = drawOne(lex, base, new Set(["no humans", "bedroom", "red hair"]), new Set(), mulberry32(2), 2);
  const t2 = split(d2.positive);
  ok("no humans 模式：場景的釘選留著、人物的釘選丟掉", t2.includes("bedroom") && !t2.includes("red hair"), d2.positive);
}

{
  let r = applyPin(lex, new Set(["1girl", "red hair", "school uniform", "standing", "bedroom", "crowd", "wide shot"]), new Set(), "no humans");
  ok("釘 no humans：卡司、長相、衣服、姿勢、人群都拿下來，場地和拍景的鏡頭留著", [...r.pinned].sort().join(",") === ["bedroom", "no humans", "wide shot"].sort().join(","), [...r.pinned].join(","));
  r = applyPin(lex, new Set(["no humans", "bedroom"]), new Set(), "red hair");
  ok("有 no humans 再釘人物的牌：no humans 讓出來", !r.pinned.has("no humans") && r.pinned.has("red hair"));
  r = applyPin(lex, new Set(["no humans"]), new Set(), "sunset");
  ok("有 no humans 再釘場景的牌：no humans 留著", r.pinned.has("no humans") && r.pinned.has("sunset"));
  const c = contradictions(lex, ["no humans", "red hair", "solo", "crowd", "bedroom"]);
  ok("相剋：no humans 配人物的牌、solo 配人群、人群配臥室", c.some((x) => x[0] === "no_humans" && x[2] === "red hair") && c.some((x) => x[0] === "solo_crowd") && c.some((x) => x[0] === "crowd_place" && x[2] === "bedroom"), JSON.stringify(c));
}

for (const crowdTag of ["crowd", "people"]) {
  let focus = 0;
  let solo = 0;
  let privatePlace = 0;
  for (let i = 1; i <= 150; i++) {
    const d = drawOne(lex, base, new Set([crowdTag, "1girl"]), new Set(), mulberry32(3500 + i), 3500 + i);
    const t = split(d.positive);
    if (t.includes("solo focus")) focus++;
    if (t.includes("solo")) solo++;
    if (["bedroom", "living room", "bathroom", "kitchen", "hotel room", "love hotel", "futon"].some((p) => t.includes(p))) privatePlace++;
  }
  ok(`釘 ${crowdTag}＋1girl：寫 solo focus 不寫 solo`, focus === 150 && solo === 0, `solo focus ${focus}、solo ${solo}`);
  ok(`釘 ${crowdTag}：不在自己家裡（臥室、浴室、客廳…）`, privatePlace === 0, `${privatePlace}/150`);
}
{
  let focus = 0;
  for (let i = 1; i <= 100; i++) {
    const d = drawOne(lex, base, new Set(["crowd", "2girls"]), new Set(), mulberry32(3700 + i), 3700 + i);
    if (split(d.positive).includes("solo focus")) focus++;
  }
  ok("兩個主角加人群：不寫 solo focus", focus === 0, `${focus}/100`);
}
{
  let hits = 0;
  for (let i = 1; i <= 400; i++) {
    const t = split(drawOne(lex, base, new Set(), new Set(), mulberry32(3900 + i), 3900 + i).positive);
    if (t.includes("no humans") || t.includes("scenery") || t.includes("people")) hits++;
  }
  ok("no humans／scenery／people 只能釘，隨機不會抽到", hits === 0, `${hits}/400`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall no-humans tests passed");
