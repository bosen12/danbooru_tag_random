#!/usr/bin/env node
/**
 * 兩件 test_engine 沒在守的契約：
 *
 * 1. **reconcile() 之後的孤兒。** allow() 裡有一整批「道具要有前提」的規則
 *    （麥克風要有人唱歌、沙灘傘要有沙灘、聽診器要有護士）。那些擋在候選階段，
 *    但最終 POS 是 reconcile() 之後才定案的 —— 前提若被事後刪掉，道具就變孤兒，
 *    候選 gate 完全不知情。
 *
 * 2. **設定的邊界值。** drawOne() 拿到全零／NaN／負數／Infinity 的權重時不該爆，
 *    也不該吐出空的或含 NaN 的 POS。真正的護欄是 sanitizeSettings()，這裡守的是
 *    「它確實擋住了」。
 *
 * 前提清單是**人工維護**的，刻意不從 engine.js 反射 —— 從實作反射出來的規格只能
 * 驗實作自不自洽。寫這份清單時第一版就自己錯了三條（幫 pool ladder 和 beach towel
 * 發明了 production 從未宣告的契約、水源清單漏掉 lotus pond），那正是人工規格的用處。
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ERAS,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  sanitizeSettings,
  weightsForHeats,
} from "../web/engine.js";

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

// --- 1. 孤兒檢查 -----------------------------------------------------------
// 每條：這個字出現在最終 POS 時，至少要有一個前提也在。
// 只列 engine.js 真的有宣告 gate 的（可引用的既有契約），不自己發明。
const NEEDS = [
  ["microphone", ["singing", "karaoke", "idol", "concert", "stage", "bar (place)", "karaoke box"]],
  ["beach umbrella", ["beach", "poolside", "ocean"]],
  ["innertube", ["pool", "ocean", "beach", "poolside", "underwater", "swimming", "bathtub",
    "bath", "onsen", "open-air bath", "bubble bath", "waterfall", "river", "lake"]],
  ["stethoscope", ["nurse", "doctor", "clinic", "hospital"]],
  ["hard hat", ["construction worker", "construction site"]],
  ["lab coat", ["scientist", "laboratory", "doctor", "clinic", "hospital"]],
  ["bunk bed", ["bedroom", "dormitory", "hotel room", "kids room"]],
  ["frying pan", ["cooking", "kitchen"]],
  ["golf club", ["golf", "golf course"]],
  ["tennis racket", ["tennis", "tennis court", "sports court", "school gym"]],
  ["bowling ball", ["bowling alley"]],
];
const WATER_ACTS = ["partially submerged", "splashing", "washing body", "washing another's back"];
const WATER_SRC = [
  "onsen", "bath", "bathroom", "bathtub", "shower (place)", "sauna", "beach", "ocean",
  "poolside", "pool", "pool ladder", "underwater", "open-air bath", "bubble bath", "waterfall",
  "beach towel", "river", "lake", "hot spring", "lotus pond", "fountain", "puddle",
  "rain", "steam", "water", "shower head", "fishing", "fishing rod",
  "bathing", "showering", "swimming", "shared bathing", "diving", "partially submerged",
  "after bathing", "wet", "wet hair", "wet clothes", "steaming body",
];

{
  // 只在場景鎖開著的模式驗。奇葩模式刻意放生錯場，那是設計不是 bug。
  const orphans = new Map();
  const sample = new Map();
  let drawn = 0;
  for (const era of ERAS) {
    for (const mode of ["normal", "diverse"]) {
      const s = Object.assign(JSON.parse(JSON.stringify(base)), {
        girl: true, boy: true, drawJob: true,
        heats: ["activity", "tease", "flash", "sex"],
        sceneMode: mode, eras: [era],
        counts: { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 },
      });
      for (let i = 1; i <= 120; i++) {
        const out = drawOne(lex, s, new Set(), new Set(), mulberry32(i), i);
        const names = new Set(
          out.positive.split(",").map((x) => x.trim().replace(/^\(/, "").replace(/:[\d.]+\)$/, ""))
        );
        drawn += 1;
        const flag = (key, why) => {
          orphans.set(key, (orphans.get(key) || 0) + 1);
          if (!sample.has(key)) sample.set(key, `era=${era} mode=${mode} seed=${i} — ${why}\n  POS：${out.positive}`);
        };
        for (const [prop, ctx] of NEEDS) {
          if (names.has(prop) && !ctx.some((c) => names.has(c))) flag(prop, `${prop} 沒有任何前提`);
        }
        const wa = WATER_ACTS.filter((t) => names.has(t));
        if (wa.length && !WATER_SRC.some((t) => names.has(t))) flag("水上動作", `${wa.join("+")} 但畫面沒有水`);
      }
    }
  }
  if (!orphans.size) {
    ok(`reconcile 之後沒有孤兒（${drawn} 張 × ${NEEDS.length + 1} 條前提）`, true);
  } else {
    for (const [k, n] of orphans) ok(`reconcile 孤兒：${k}`, false, `${n} 次\n  ${sample.get(k)}`);
  }
}

// --- 2. 設定邊界 -----------------------------------------------------------
{
  const sane = (out) =>
    out && typeof out.positive === "string" && out.positive.trim() &&
    !/NaN|undefined|null/.test(out.positive) && out.positive.split(",").length >= 5 && !!out.era;
  const draw = (over) => {
    const s = Object.assign(JSON.parse(JSON.stringify(base)), over);
    return drawOne(lex, s, new Set(), new Set(), mulberry32(4242), 4242);
  };
  const survives = (label, over) => {
    let out;
    try {
      out = draw(over);
    } catch (e) {
      ok(`邊界：${label}`, false, `丟例外 ${e.message}`);
      return;
    }
    ok(`邊界：${label}`, sane(out), out ? `POS=${String(out.positive).slice(0, 90)}` : "沒有輸出");
  };

  survives("權重全零", { weights: { activity: 0, tease: 0, flash: 0, sex: 0 } });
  survives("權重全 NaN", { weights: { activity: NaN, tease: NaN, flash: NaN, sex: NaN } });
  survives("權重全負數", { weights: { activity: -1, tease: -5, flash: -2, sex: -9 } });
  survives("權重有 Infinity", { weights: { activity: Infinity, tease: 1, flash: 1, sex: 1 } });
  survives("權重是字串", { weights: { activity: "abc", tease: "1", flash: null } });
  survives("權重是 null", { weights: null });
  survives("權重缺鍵", { weights: {} });
  survives("heats 空陣列", { heats: [] });
  survives("heats 含未知值", { heats: ["nonsense", "tease"] });
  survives("counts 全零", { counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 } });
  survives("counts 負數", { counts: { subject: -5, feature: -5, pose: -5, clothing: -5, env: -5 } });
  survives("counts NaN", { counts: { subject: NaN, feature: NaN, pose: NaN, clothing: NaN, env: NaN } });
  survives("counts 超大", { counts: { subject: 1e9, feature: 1e9, pose: 1e9, clothing: 1e9, env: 1e9 } });
  survives("eras 空", { eras: [] });
  survives("eras 含未知值", { eras: ["atlantis"] });
  survives("男女都關", { girl: false, boy: false });

  // sanitizeSettings 是真正的護欄：垃圾進去，可用的設定出來。
  for (const [label, raw] of [
    ["null", null], ["undefined", undefined], ["字串", "x"], ["陣列", [1, 2]],
    ["全垃圾物件", { counts: "x", heats: 7, weights: "y", eras: {}, sceneMode: 99 }],
    ["heats/counts 是 null", { heats: null, counts: null }],
  ]) {
    let good = false;
    try {
      const out = drawOne(lex, sanitizeSettings(raw, data), new Set(), new Set(), mulberry32(7), 7);
      good = sane(out);
    } catch (e) {
      ok(`sanitizeSettings(${label}) 之後抽得動`, false, `丟例外 ${e.message}`);
      continue;
    }
    ok(`sanitizeSettings(${label}) 之後抽得動`, good);
  }

  for (const [label, h, hw] of [
    ["空 heats", [], null],
    ["null heats", null, null],
    ["未知 heat", ["zzz"], null],
    ["mixed 帶 NaN", ["tease", "flash", "sex"], { mixed: { tease: NaN, flash: NaN, sex: NaN } }],
  ]) {
    let good = false;
    try {
      const w = weightsForHeats(h, hw);
      good = w && typeof w === "object";
    } catch (e) {
      ok(`weightsForHeats(${label})`, false, `丟例外 ${e.message}`);
      continue;
    }
    ok(`weightsForHeats(${label})`, good);
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
