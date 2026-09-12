#!/usr/bin/env node
/**
 * 向 Danbooru 官方 API 核實 tag。只接受 category=0、post_count>0、is_deprecated=false。
 *
 *   node scripts/verify_danbooru_tags.mjs              # 驗 SPORT_PRESETS 用到的全部 tag
 *   node scripts/verify_danbooru_tags.mjs --retry 40   # API 掛掉時重試幾輪（每輪間隔 30 秒）
 *   node scripts/verify_danbooru_tags.mjs a b c        # 只驗指定 tag（空格格式）
 *
 * 專案內是空格格式，API 是底線格式，這裡自動轉換。
 * 結果寫到 scripts/.cache_danbooru_sport_tags.json（已在 .gitignore 的 .cache_* 規則裡）。
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const API = "https://danbooru.donmai.us/tags.json";
const UA = "paizi-case-tag-check/1.0 (local tooling)";
const OUT = join(here, ".cache_danbooru_sport_tags.json");

// 使用者點名必須擋掉的：deprecated、post_count 0、或 alias 舊名。
export const FORBIDDEN = [
  "basketball",
  "baseball",
  "volleyball",
  "volleyball court",
  "baseball glove",
  "cycling",
  "golf uniform",
  "tennis shoes",
  "archery range",
  "ice rink",
  "arrow",
  "yumi",
];

const toApi = (t) => t.replace(/ /g, "_");
const toPos = (t) => t.replace(/_/g, " ");

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

async function fetchBatch(names) {
  const url = `${API}?search%5Bname_comma%5D=${encodeURIComponent(names.map(toApi).join(","))}&limit=1000`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const body = await res.json();
  if (!Array.isArray(body)) {
    const why = body && (body.message || body.error) ? `${body.error || ""} ${body.message || ""}`.trim() : `HTTP ${res.status}`;
    throw new Error(why);
  }
  return body;
}

async function lookup(names, retries, waitMs) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const found = new Map();
      for (const part of chunk(names, 90)) {
        for (const row of await fetchBatch(part)) found.set(toPos(row.name), row);
        await new Promise((r) => setTimeout(r, 600)); // 對 Danbooru 客氣一點
      }
      return found;
    } catch (err) {
      if (attempt === retries) throw err;
      process.stderr.write(`Danbooru 沒回（${err.message}），${waitMs / 1000} 秒後重試 ${attempt + 1}/${retries}\n`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return new Map();
}

function verdict(row) {
  if (!row) return "不存在";
  if (row.category !== 0) return `category ${row.category}（不是一般 tag）`;
  if (row.is_deprecated) return "deprecated";
  if (!(row.post_count > 0)) return `post_count ${row.post_count}`;
  return "ok";
}

async function main() {
  const argv = process.argv.slice(2);
  let retries = 0;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--retry") retries = Number(argv[++i]) || 0;
    else rest.push(argv[i]);
  }

  let wanted = rest;
  if (!wanted.length) {
    const { SPORT_PRESETS, sportPresetTags } = await import("../web/sports.js");
    const set = new Set();
    for (const p of SPORT_PRESETS) {
      for (const t of sportPresetTags(p)) set.add(t);
      for (const t of p.optionalEquipment || []) set.add(t);
    }
    wanted = [...set].sort();
  }

  const all = [...new Set([...wanted, ...FORBIDDEN])];
  const found = await lookup(all, retries, 30000);

  const report = { checkedAt: new Date().toISOString(), ok: [], bad: [], forbiddenStillBad: [], forbiddenNowFine: [] };
  for (const t of wanted) {
    const v = verdict(found.get(t));
    const row = found.get(t);
    const rec = { tag: t, verdict: v, post_count: row ? row.post_count : 0, category: row ? row.category : null };
    if (v === "ok") report.ok.push(rec);
    else report.bad.push(rec);
  }
  for (const t of FORBIDDEN) {
    const v = verdict(found.get(t));
    (v === "ok" ? report.forbiddenNowFine : report.forbiddenStillBad).push({ tag: t, verdict: v });
  }

  writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");

  console.log(`核實 ${wanted.length} 個 tag，${report.ok.length} 通過、${report.bad.length} 不通過`);
  for (const r of report.bad) console.log(`  BAD  ${r.tag} — ${r.verdict}`);
  console.log(`禁用清單 ${FORBIDDEN.length} 個，${report.forbiddenStillBad.length} 確認仍不可用`);
  for (const r of report.forbiddenNowFine) console.log(`  NOTE ${r.tag} — 現在是有效 tag（仍照使用者指示不採用）`);
  console.log(`報告寫到 ${OUT}`);
  if (report.bad.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("核實失敗：" + err.message);
  process.exitCode = 2;
});
