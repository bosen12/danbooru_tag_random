#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const engineSource = readFileSync(join(ROOT, "web", "engine.js"), "utf8");

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

function tagsOf(drawn) {
  return new Set(drawn.positive.split(",").map((raw) => raw.trim()));
}

function propHits(tag, place, seed0, n = 600) {
  let hits = 0;
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    const settings = defaultSettings(data);
    settings.girl = true;
    settings.boy = false;
    settings.eras = ["modern"];
    settings.heats = ["tease"];
    settings.sceneMode = "normal";
    settings.lockScene = true;
    settings.counts = { ...settings.counts, env: 10 };
    settings.mustDraw = { "env:other": 10 };
    const seed = seed0 + i;
    const drawn = drawOne(
      lex,
      settings,
      new Set([place]),
      new Set(),
      mulberry32(seed),
      seed
    );
    const tags = tagsOf(drawn);
    if (!tags.has(tag)) continue;
    hits += 1;
    if (samples.length < 2) samples.push(drawn.positive);
  }
  return { hits, samples };
}

// allow() is invoked for nearly every candidate in every pool. Its common global guards used to
// materialise `used` repeatedly before `.some()`. Keep those first-line checks allocation-free.
// This is a source-level performance contract on purpose: output-only tests cannot detect an
// allocation regression because the selected tags remain identical.
{
  const start = engineSource.indexOf("export function drawOne(");
  const end = engineSource.indexOf("export const QUOTA_SECTIONS", start);
  const body = start >= 0 && end > start ? engineSource.slice(start, end) : "";
  const common = ["FACELESS_CAM", "DAY_MARK", "NIGHT_MARK", "DARK_LIGHT", "EYE_EXTRA", "MOUTH_EXTRA"];
  const stale = common.filter((name) => body.includes(`[...used].some((t) => ${name}.has(t))`));
  ok(
    "drawOne 常用互斥守門不為集合掃描建立暫存陣列",
    body.includes("const hasUsed =") && stale.length === 0,
    stale.join(", ")
  );
}

// 這兩個字描述畫面裡的物件，不是穿在人物身上的配件。舊分類是
// clothing/accessory/mutex:null；normal/diverse 的 clothing whitelist 不會讓它們進池，
// 即使場景已經明確釘成 beach/pool，仍是 0/200。分類與行為都要守，否則只改 gate
// 會留下另一條死路。
for (const tag of ["beach umbrella", "innertube"]) {
  const item = lex.byTag.get(tag);
  ok(`${tag} 是環境道具`, item?.section === "env" && item?.group === "other" && item?.mutex == null,
    JSON.stringify(item));
}

const beach = propHits("beach umbrella", "beach", 121000);
ok("beach umbrella 在海灘情境可自然抽到", beach.hits > 0, `0/600；samples=${beach.samples.join(" | ")}`);

const tube = propHits("innertube", "pool", 122000);
ok("innertube 在泳池情境可自然抽到", tube.hits > 0, `0/600；samples=${tube.samples.join(" | ")}`);

const wrongBeach = propHits("beach umbrella", "office", 123000, 300);
ok("beach umbrella 不會出現在辦公室", wrongBeach.hits === 0, `${wrongBeach.hits}/300`);

const wrongTube = propHits("innertube", "office", 124000, 300);
ok("innertube 不會出現在辦公室", wrongTube.hits === 0, `${wrongTube.hits}/300`);

// 不能只把 camera fill 往前搬：舊實驗會破壞 flash 與 solo-sex 的核心動作。
// 先用最安全的 tease 尺度驗證 composition reservation：少量畫面先選無臉構圖，
// 後續 feature/pose 必須尊重它，而不是抽完眼睛表情後才發現 camera 永遠進不來。
{
  const hits = new Map([["head out of frame", 0], ["lower body", 0]]);
  const clashes = [];
  for (let i = 0; i < 2400; i += 1) {
    const settings = defaultSettings(data);
    settings.girl = true;
    settings.boy = false;
    settings.eras = ["modern"];
    settings.heats = ["tease"];
    settings.sceneMode = "normal";
    settings.lockScene = true;
    const seed = 125000 + i;
    const drawn = drawOne(lex, settings, new Set(), new Set(), mulberry32(seed), seed);
    const tags = tagsOf(drawn);
    const camera = [...hits.keys()].find((tag) => tags.has(tag));
    if (!camera) continue;
    hits.set(camera, hits.get(camera) + 1);
    const bad = [...tags].filter((tag) => {
      const item = lex.byTag.get(tag);
      return item && (
        item.mutex === "gaze" ||
        item.mutex === "expression" ||
        item.mutex === "eye_color" ||
        item.group === "face" ||
        item.group === "eyes" ||
        tag === "glasses" ||
        tag === "tears" ||
        tag === "one eye closed" ||
        tag === "lipstick" ||
        /^looking /.test(tag)
      );
    });
    if (bad.length && clashes.length < 3) clashes.push(`${camera}: ${bad.join("+")} — ${drawn.positive}`);
  }
  for (const [tag, count] of hits) {
    ok(`${tag} 在 tease composition 可自然抽到`, count >= 20, `${count}/2400`);
  }
  ok("無臉構圖不帶需要臉部的 tag", clashes.length === 0, clashes.join("\n  "));
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
