#!/usr/bin/env node
/**
 * 衣服可達、面板單釘、抽樣契約這三段，時間幾乎都在同一個迴圈裡。
 * 把迴圈拆開、各份先不算門檻；次數加總之後才套原來的門檻。種子和張數不變。
 * 其餘檢查另開一份同時跑。原檔不設 DRAW_PART 時仍是整支單跑。
 *
 *   node scripts/test_loop_shards.mjs clothing
 *   node scripts/test_loop_shards.mjs panel -j 4
 *   node scripts/test_loop_shards.mjs contracts -j 4
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const positionals = [];
let jobs = 0;
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === "-j") {
    jobs = Number(process.argv[i + 1]) || jobs;
    i += 1;
    continue;
  }
  positionals.push(a);
}
const mode = positionals[0];
const FILES = {
  clothing: "test_clothing_reachability.mjs",
  panel: "test_panel_pin_matrix.mjs",
  contracts: "test_draw_contracts.mjs",
};
if (!FILES[mode]) {
  console.error("用法：node scripts/test_loop_shards.mjs clothing|panel|contracts [-j 份數]");
  process.exit(1);
}
const N = Math.max(1, jobs || Math.min(4, availableParallelism()));
const file = join(HERE, FILES[mode]);

function covers(n, shards, fromZero) {
  const got = new Set();
  for (let k = 0; k < shards; k += 1) {
    for (let i = (fromZero ? 0 : 1) + k; fromZero ? i < n : i <= n; i += shards) got.add(i);
  }
  return got.size === n;
}
for (const n of [1, 2, 80, 400, 2000, 4000, 16000]) {
  if (!covers(n, N, true) || !covers(n, N, false)) {
    console.error(`分片沒把 1..${n} 各走一次`);
    process.exit(1);
  }
}

function spawnNode(env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => {
      log += d;
    });
    child.stderr.on("data", (d) => {
      log += d;
    });
    child.on("close", (code) => resolve({ code: code ?? 1, log, secs: (Date.now() - started) / 1000 }));
  });
}

function payloadOf(log) {
  const lines = log.split(/\r?\n/).filter((l) => l.startsWith("__SHARD__"));
  if (lines.length !== 1) return null;
  return JSON.parse(lines[0].slice("__SHARD__".length));
}

function mergeCounts(rows) {
  const counts = {};
  let total = 0;
  let seen = 0;
  for (const row of rows) {
    total += row.total || 0;
    seen += row.seen || 0;
    for (const [k, v] of Object.entries(row.counts || {})) counts[k] = (counts[k] || 0) + v;
  }
  return { total, counts, seen };
}

function mergeParts(parts) {
  if (mode === "panel") {
    return {
      misses: parts.flatMap((p) => p.misses),
      draws: parts.reduce((a, p) => a + p.draws, 0),
    };
  }
  if (mode === "clothing") {
    return {
      modern: {
        feet: mergeCounts(parts.map((p) => p.modern.feet)),
        fabric: mergeCounts(parts.map((p) => p.modern.fabric)),
      },
      edo: mergeCounts(parts.map((p) => p.edo)),
    };
  }
  const orphans = {};
  const fired = {};
  const sample = {};
  let drawn = 0;
  for (const p of parts) {
    drawn += p.drawn || 0;
    for (const [k, v] of Object.entries(p.orphans || {})) orphans[k] = (orphans[k] || 0) + v;
    for (const [k, v] of Object.entries(p.fired || {})) fired[k] = (fired[k] || 0) + v;
    for (const [k, v] of Object.entries(p.sample || {})) if (!(k in sample)) sample[k] = v;
  }
  return { orphans, fired, sample, drawn };
}

function failLog(log) {
  const lines = log.split(/\r?\n/);
  const marks = lines.filter((l, i) => l.startsWith("FAIL") || l.startsWith("ok   ") || (l.startsWith("  ") && (lines[i - 1] || "").startsWith("FAIL")));
  return marks.length ? marks.join("\n") : lines.slice(-20).join("\n");
}

console.log(`${mode}：重的迴圈分成 ${N} 份，其餘檢查同時跑。種子、張數、門檻都沒改。`);
const t0 = Date.now();
const heavy = Array.from({ length: N }, (_, k) => spawnNode({
  DRAW_PART: "heavy",
  DRAW_SHARD: String(k),
  DRAW_SHARDS: String(N),
}));
const restPromise = spawnNode({ DRAW_PART: "rest" });
const [rest, ...parts] = await Promise.all([restPromise, ...heavy]);
console.log(`其餘檢查：${rest.code === 0 ? "通過" : "失敗"}，${rest.secs.toFixed(0)} 秒`);
if (rest.code !== 0) console.error(failLog(rest.log));
else console.log(rest.log.split(/\r?\n/).filter((l) => l.startsWith("ok   ")).join("\n"));

let failed = rest.code !== 0;
const parsed = [];
parts.forEach((r, k) => {
  console.log(`第 ${k + 1} 份：${r.code === 0 ? "跑完" : "失敗"}，${r.secs.toFixed(0)} 秒`);
  const payload = r.code === 0 ? payloadOf(r.log) : null;
  if (!payload) {
    failed = true;
    console.error(failLog(r.log));
    return;
  }
  parsed.push(payload);
});

if (parsed.length === N) {
  const merged = mergeParts(parsed);
  if (mode === "clothing") {
    const modernSeen = merged.modern.feet.seen;
    const fabricSeen = merged.modern.fabric.seen;
    if (modernSeen !== 16000 || fabricSeen !== 16000 || merged.edo.seen !== 4000) {
      failed = true;
      console.error(`FAIL 衣服分片張數對不上（現代鞋子 ${modernSeen}、布料 ${fabricSeen}、江戶 ${merged.edo.seen}）`);
    }
  }
  if (mode === "contracts") console.log(`孤兒檢查合併 ${merged.drawn} 張`);
  if (mode === "panel") console.log(`單釘合併 ${merged.draws} 張（還沒加每份都不跑的那 3 張 children）`);
  const dir = mkdtempSync(join(tmpdir(), "loop-shards-"));
  const resultFile = join(dir, "merged.json");
  writeFileSync(resultFile, JSON.stringify(merged));
  const asserted = await spawnNode({ DRAW_PART: "assert", DRAW_RESULT: resultFile });
  rmSync(dir, { recursive: true, force: true });
  console.log(`合併後的門檻：${asserted.code === 0 ? "通過" : "失敗"}，${asserted.secs.toFixed(0)} 秒`);
  console.log(failLog(asserted.log));
  if (asserted.code !== 0) failed = true;
  parts.push({ log: asserted.log });
}

const passed = [rest.log, ...parts.map((r) => r.log)].join("\n").match(/^ok {3}/gm);
console.log(`\n${passed ? passed.length : 0} 項通過，共 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
if (failed) process.exit(1);
console.log("ok");
