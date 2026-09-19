#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ERAS, defaultSettings, drawOne, indexLexicon, mulberry32 } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

function tagsOf(drawn) {
  return new Set(drawn.positive.split(",").map((raw) => raw.trim().replace(/^\(/, "").replace(/:[\d.]+\)$/, "")));
}

// 左側面板所有會改 admissibility 的主要維度。每格用兩個固定 seed，不追求統計顯著，
// 而是守住「任何合法組合都抽得動、沒有 hard contradiction／support orphan」。
{
  const unique = Object.fromEntries(["subject", "feature", "pose", "clothing", "env"].map((s) => [s, new Set()]));
  const prompts = new Set();
  const bad = [];
  let draws = 0;
  let seed = 710000;
  for (const mode of ["normal", "diverse", "weird"]) {
    for (const era of ERAS) {
      for (const heats of [["activity"], ["tease"], ["flash"], ["sex"], ["tease", "flash", "sex"]]) {
        for (const cast of ["girl", "boy", "both"]) {
          for (const drawJob of [false, true]) {
            for (const countProfile of ["zero", "default", "max"]) {
              const settings = defaultSettings(data);
              settings.sceneMode = mode;
              settings.lockScene = mode !== "weird";
              settings.eras = [era];
              settings.heats = heats;
              settings.girl = cast !== "boy";
              settings.boy = cast !== "girl";
              settings.drawJob = drawJob;
              if (countProfile === "zero") settings.counts = { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 };
              if (countProfile === "max") settings.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
              for (let i = 0; i < 2; i += 1) {
                try {
                  const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
                  draws += 1;
                  seed += 1;
                  if (!drawn.positive.trim() || drawn.conflicts.length || drawn.shadowViolations.length) {
                    bad.push(`${mode}/${era}/${heats.join("+")}/${cast}/job=${drawJob}/${countProfile}: conflicts=${drawn.conflicts.length}, shadow=${drawn.shadowViolations.length}, POS=${drawn.positive}`);
                  }
                  prompts.add(drawn.positive);
                  for (const section of Object.keys(unique)) {
                    for (const tag of drawn.sections[section] || []) unique[section].add(tag);
                  }
                } catch (error) {
                  bad.push(`${mode}/${era}/${heats.join("+")}/${cast}/job=${drawJob}/${countProfile}: ${error.stack || error}`);
                }
              }
            }
          }
        }
      }
    }
  }
  ok(`左側面板矩陣 ${draws} 張全部可抽且無 hard conflict`, bad.length === 0, bad.slice(0, 5).join("\n  "));
  ok("面板矩陣不重複退化", prompts.size >= Math.floor(draws * 0.99), `${prompts.size}/${draws}`);
  const floors = { subject: 9, feature: 285, pose: 335, clothing: 305, env: 305 };
  for (const [section, floor] of Object.entries(floors)) {
    ok(`${section} 多樣性底線`, unique[section].size >= floor, `${unique[section].size} < ${floor}`);
  }
}

// 每一個非 quality 詞都用自己的合法 heat/era/cast 單獨釘選，並跨三種 sceneMode。
// forcePin 或 reconcile 只要開始靜默吃 pin，這裡會直接列出詞與模式。
{
  const misses = [];
  let draws = 0;
  for (const mode of ["normal", "diverse", "weird"]) {
    for (let index = 0; index < data.tags.length; index += 1) {
      const item = data.tags[index];
      if (item.section === "quality") continue;
      const needs = new Set(item.needs || []);
      const settings = defaultSettings(data);
      settings.rating = "explicit";
      settings.sceneMode = mode;
      settings.lockScene = mode !== "weird";
      settings.heats = item.heat?.length ? [...item.heat] : ["tease", "flash", "sex"];
      const eras = (item.era || []).filter((era) => era !== "any");
      settings.eras = eras.length ? eras : ["modern"];
      settings.girl = item.gate === "female" || needs.has("female") || !needs.has("male");
      settings.boy = item.gate === "male" || needs.has("male");
      settings.drawJob = true;
      settings.counts = { subject: 10, feature: 10, pose: 10, clothing: 10, env: 10 };
      const seed = 760000 + index;
      const drawn = drawOne(lex, settings, new Set([item.tag]), new Set(), mulberry32(seed), seed);
      draws += 1;
      if (!tagsOf(drawn).has(item.tag)) misses.push(`${mode}/${item.tag}: ${drawn.positive}`);
    }
  }
  ok(`單 pin authority（${draws} 張）`, misses.length === 0, misses.slice(0, 10).join("\n  "));
}

// 代表性的跨 section 合法組合。這些不是反射 engine 內部表格，而是使用者會在左欄
// 實際做出的 pin 組合；兩個字都必須留下。
{
  const pairs = [
    ["beach", "beach umbrella"],
    ["pool", "innertube"],
    ["nurse", "hospital"],
    ["cooking", "kitchen"],
    ["bikini", "beach"],
    // production 的消防員場地契約是 street/city/cityscape；詞庫沒有 fire station。
    ["firefighter", "street"],
    ["tennis", "tennis court"],
    ["bathing", "onsen"],
    ["detective", "office"],
    ["head out of frame", "skirt"],
  ];
  const misses = [];
  for (const mode of ["normal", "diverse", "weird"]) {
    for (let i = 0; i < pairs.length; i += 1) {
      const [a, b] = pairs[i];
      const settings = defaultSettings(data);
      settings.rating = "explicit";
      settings.sceneMode = mode;
      settings.lockScene = mode !== "weird";
      settings.eras = ["modern", "edo"];
      settings.heats = ["activity", "tease", "flash", "sex"];
      settings.girl = true;
      settings.boy = true;
      const seed = 810000 + i;
      const drawn = drawOne(lex, settings, new Set([a, b]), new Set(), mulberry32(seed), seed);
      const tags = tagsOf(drawn);
      if (!tags.has(a) || !tags.has(b)) misses.push(`${mode}/${a}+${b}: ${drawn.positive}`);
    }
  }
  ok(`合法 pairwise pins（${pairs.length * 3} 張）`, misses.length === 0, misses.join("\n  "));
}

// pin 的構圖要求高於 mustDraw。要求無臉構圖又要求臉部 group 時，不能為了湊數塞入
// 矛盾 tag；mustReport 必須誠實回報 shortfall。
{
  const settings = defaultSettings(data);
  settings.heats = ["tease"];
  settings.mustDraw = { "feature:face": 1 };
  const drawn = drawOne(lex, settings, new Set(["head out of frame"]), new Set(), mulberry32(830001), 830001);
  const report = drawn.mustReport.find((row) => row.key === "feature:face");
  ok("pin×mustDraw 衝突不硬湊", tagsOf(drawn).has("head out of frame") && report?.got === 0 && report.want === 1,
    `report=${JSON.stringify(report)} POS=${drawn.positive}`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
