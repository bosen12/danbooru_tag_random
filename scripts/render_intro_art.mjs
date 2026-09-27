#!/usr/bin/env node
/**
 * 介紹影片（web6/intro.html）裡的成品圖：用影片上寫的那組釘選、那個種子，真的送進 ComfyUI 畫。
 *
 *   node scripts/render_intro_art.mjs                  # 伺服器預設 http://127.0.0.1:8796
 *   node scripts/render_intro_art.mjs http://127.0.0.1:8897
 *
 * 走的是排字匣自己的 /api/gen（跟按「抽並生圖」同一條路：同一個 workflow、底模、全年齡分級），
 * 畫好拿 webp 存到 web6/intro-art/，旁邊寫 manifest.json（每張的種子、提示詞、底模）。影片讀 manifest。
 * 換了底模、詞庫想重畫就再跑一次。
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as engine from "../web/engine.js";
import { emptyBed, placeCard } from "../web6/fuse-bed.js";
import { filmPrints } from "../web6/intro-data.js";

const { indexLexicon, defaultSettings, sanitizeSettings, escapeForComfy } = engine;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "http://127.0.0.1:8796";
const OUT = join(ROOT, "web6", "intro-art");
const W = 832;
const H = 1216;

const data = JSON.parse(readFileSync(join(ROOT, "web", "lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const settings = sanitizeSettings({ ...defaultSettings(data), rating: "general" }, data);
const prints = filmPrints({ ...engine, emptyBed, placeCard }, lex, settings);

async function renderTo(pathNoExt, p) {
  const r = await render("cand", p, pathNoExt + ".webp");
  return r;
}

async function render(name, p, target = null) {
  const res = await fetch(`${BASE}/api/gen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ positive: escapeForComfy(p.positive), seed: p.seed, width: W, height: H, rating: "general" }),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
  const dec = new TextDecoder();
  let buf = "";
  let image = null;
  let ckpt = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      const d = raw ? JSON.parse(raw) : {};
      if (ev === "progress") process.stdout.write(`\r  ${name} ${d.value}/${d.max}   `);
      if (ev === "error") throw new Error(`${name}: ${d.error}`);
      if (ev === "done") {
        image = d.image;
        ckpt = d.ckpt || "";
      }
    }
  }
  if (!image) throw new Error(`${name}: no image`);
  const webp = await fetch(`${BASE}${image}${image.includes("?") ? "&" : "?"}fmt=webp`);
  if (!webp.ok) throw new Error(`${name}: webp HTTP ${webp.status}`);
  const bytes = Buffer.from(await webp.arrayBuffer());
  writeFileSync(target || join(OUT, `${name}.webp`), bytes);
  console.log(`\r  ${name}  seed ${p.seed}  ${(bytes.length / 1024).toFixed(0)} KB`);
  return { file: `${name}.webp`, seed: p.seed, pins: p.pins, positive: p.positive, width: W, height: H, ckpt };
}

// --candidates N DIR：不寫進影片，把墨池、疊印台各 N 個候選種子畫到 DIR，挑好之後把種子寫進 intro-data.js 的 PICKED。
const ci = process.argv.indexOf("--candidates");
if (ci > 0) {
  const n = +process.argv[ci + 1] || 6;
  const dir = process.argv[ci + 2];
  const { cleanDraws, MOCHI_POOL, fuseBed } = await import("../web6/intro-data.js");
  const eng = { ...engine, emptyBed, placeCard };
  const { bed } = fuseBed(eng, lex);
  const sets = { m: cleanDraws(eng, lex, settings, MOCHI_POOL, n), f: cleanDraws(eng, lex, settings, bed.pins, n + 2) };
  mkdirSync(dir, { recursive: true });
  const saved = OUT;
  for (const [k, list] of Object.entries(sets)) {
    for (const d of list) {
      const out = join(dir, `${k}-${d.seed}`);
      await renderTo(out, { ...d, pins: [] });
    }
  }
  void saved;
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const name of ["mochi", "fuseA", "fuseB", "fuseC"]) manifest[name] = await render(name, prints[name]);
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log("web6/intro-art/manifest.json written");
