#!/usr/bin/env node
/**
 * 把「頂層 { … } 區塊各自獨立」的測試分成幾份同時跑。作法與 test_engine_shards.mjs 相同：
 * 不改原檔，讀進來把第 0 欄的 `{` 改成 `if (第幾份)`，寫成暫存檔再分進程。
 * 原檔照舊可以單獨跑。寫在區塊外面的程式（讀詞庫、最後的 exit）每一份都會跑。
 *
 * 負載用區塊裡的 N、時代迴圈、熱度迴圈估，先排重的、每次放進目前最輕的那一份。
 * 門檻、種子、張數都在原檔裡，這裡不動。
 *
 *   node scripts/test_block_shards.mjs scripts/audit_draw_invariants.mjs
 *   node scripts/test_block_shards.mjs scripts/audit_draw_invariants.mjs -j 4
 *   node scripts/test_block_shards.mjs scripts/audit_draw_invariants.mjs --plan
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir, availableParallelism } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const positionals = [];
let jobs = 0;
let planOnly = false;
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === "-j") {
    jobs = Number(process.argv[i + 1]) || jobs;
    i += 1;
    continue;
  }
  if (a === "--plan") {
    planOnly = true;
    continue;
  }
  positionals.push(a);
}
const sourceArg = positionals[0];
const forward = positionals.slice(1);
if (!sourceArg) {
  console.error("用法：node scripts/test_block_shards.mjs <測試檔> [-j 份數] [傳給原檔的參數]");
  process.exit(1);
}
const SOURCE = resolve(sourceArg);
if (!existsSync(SOURCE)) {
  console.error(`找不到 ${SOURCE}`);
  process.exit(1);
}
const N = Math.max(1, jobs || Math.min(4, availableParallelism()));

const lines = readFileSync(SOURCE, "utf8").split(/\r?\n/);
const blocks = [];
for (let i = 0, open = -1; i < lines.length; i += 1) {
  const s = lines[i].trimEnd();
  if (open < 0 && s === "{") open = i;
  else if (open >= 0 && s === "}") {
    blocks.push([open, i]);
    open = -1;
  }
}
if (!blocks.length) {
  console.error(`${SOURCE} 沒有第 0 欄的 { } 區塊，分了也不會變快`);
  process.exit(1);
}

// 估這個區塊大概抽幾張。時代 6 個；熱度看 for (const heats of [...]) 裡有幾個陣列。
function costOf([a, b]) {
  const text = lines.slice(a, b + 1).join("\n");
  const ns = [...text.matchAll(/(?:const|let)\s+N\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
  if (text.includes("for (const [act, gear")) {
    const n = ns[0] || 1;
    const cases = (text.match(/^\s+\["/gm) || []).length;
    return n * Math.max(1, cases);
  }
  if (!ns.length) return 1;
  const era = text.includes("for (const era of ERAS)") ? 6 : 1;
  const heatMatch = text.match(/for \(const heats of (\[[\s\S]*?\])\)/);
  const heat = heatMatch ? Math.max(1, (heatMatch[1].match(/\[/g) || []).length - 1) : 1;
  return ns.reduce((sum, n) => sum + n * era * heat, 0);
}

const order = blocks
  .map((b, i) => ({ i, cost: costOf(b) }))
  .sort((x, y) => y.cost - x.cost || x.i - y.i);
const load = Array(N).fill(0);
const shardOf = [];
for (const { i, cost } of order) {
  const k = load.indexOf(Math.min(...load));
  shardOf[i] = k;
  load[k] += cost;
}

const srcUrl = pathToFileURL(SOURCE).href;
const webUrl = new URL("../web/", srcUrl).href;
const out = lines.slice();
blocks.forEach(([a], i) => {
  out[a] = `if (__SHARD === ${shardOf[i]}) {`;
});
let text = out
  .join("\n")
  .replace(/^#!.*\n/, "")
  .replace(/(from\s+["'])\.\.\/web\//g, `$1${webUrl}`)
  .replaceAll("import.meta.url", JSON.stringify(srcUrl));
text = `const __SHARD = Number(process.env.BLOCK_SHARD);\n` + text;

const label = SOURCE.split(/[\\/]/).pop();
console.log(`${label}：${blocks.length} 個區塊分成 ${N} 份（估計抽樣 ${load.map((n) => String(n)).join(" / ")}）`);
console.log("區塊外面的開頭（預設那 2000 張那類）每一份都會跑。種子、張數、門檻都沒改。");
if (planOnly) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), "block-shards-"));
const file = join(dir, "shard.mjs");
writeFileSync(file, text);

const t0 = Date.now();
const runs = Array.from({ length: N }, (_, k) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [file, ...forward], {
    env: { ...process.env, BLOCK_SHARD: String(k) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => {
    log += d;
  });
  child.stderr.on("data", (d) => {
    log += d;
  });
  child.on("close", (code) => resolve({ k, code: code ?? 1, log, secs: (Date.now() - started) / 1000 }));
}));
const results = await Promise.all(runs);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
let passed = 0;
for (const r of results) {
  passed += (r.log.match(/^ok {3}/gm) || []).length;
  const fails = r.log.split(/\n/).filter((l, i, all) => l.startsWith("FAIL") || (l.startsWith("  ") && all[i - 1]?.startsWith("FAIL")));
  console.log(`第 ${r.k + 1} 份：${r.code === 0 ? "通過" : "失敗"}，${r.secs.toFixed(0)} 秒`);
  if (r.code !== 0) {
    failed += 1;
    console.error(fails.length ? fails.join("\n") : r.log.split(/\n/).slice(-30).join("\n"));
  }
}
console.log(`\n${passed} 項通過，共 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
if (failed) process.exit(1);
console.log("ok");
