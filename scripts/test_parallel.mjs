#!/usr/bin/env node
/**
 * 整套測試同時跑（test.bat 預設走這裡；test.bat serial 照舊一段一段跑）。
 *
 * 清單就是 test.bat 裡 `echo == 名稱 ==` 底下那幾行 call：這裡讀 test.bat，不另外列，加新測試只改 test.bat。
 *   - 每一段一個子程序，同時跑幾段看 CPU 核心數（-j 改）。引擎那段自己會再分 10 份，算 10 格。
 *   - 上次跑得久的先開跑（時間記在暫存資料夾），最後一段不會是剛好排到的大塊頭。
 *   - 失敗不中斷：全部跑完一次列出哪幾段失敗、各自最後幾行輸出。
 *   - server live（比對 data/、開伺服器）和 draw baselines（量速度）等別段都跑完才單獨跑。
 *
 *   node scripts/test_parallel.mjs                 全部
 *   node scripts/test_parallel.mjs --failed        只重跑上次失敗的那幾段
 *   node scripts/test_parallel.mjs --only 服裝,draw  名稱裡有這些字的段（逗號分開，不分大小寫）
 *   node scripts/test_parallel.mjs -j 8            最多同時 8 格
 *   test.bat --failed／test.bat --only 服裝         test.bat 的參數照樣傳過來
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(tmpdir(), "danbooru-test-parallel.json");
const LOGS = join(tmpdir(), "danbooru-test-logs");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] || "" : null;
};
const SLOTS = Math.max(2, Number(arg("-j")) || availableParallelism());
const ENGINE_SHARDS = Math.min(10, Math.max(2, SLOTS - 4));
// test.bat 找到的 Python（python 或 py -3）。
const PY = (process.env.TEST_PY || (process.platform === "win32" ? "python" : "python3")).trim().split(/\s+/);
// 最後單獨跑的段（名稱）：server live 比對 data/、開伺服器；draw baselines 量抽一張要幾毫秒，
// 跟別段一起跑時 CPU 被搶，中位數 24ms 變 86ms（門檻 80ms）。
const ALONE = new Set(["draw baselines", "server live (fake comfy)"]);

/** test.bat → [{ name, cmds: [[程式, ...參數]] }]。 */
function stages() {
  const out = [];
  let cur = null;
  for (const raw of readFileSync(join(ROOT, "test.bat"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^echo == (.+) ==$/.exec(line);
    if (head) {
      cur = { name: head[1], cmds: [] };
      out.push(cur);
      continue;
    }
    const m = /^(?:call )?(node|%PY%) (.+)$/.exec(line);
    if (!m || !cur) continue;
    const args = m[2].split(/\s+/).map((a) => a.replace(/\\/g, "/"));
    cur.cmds.push(m[1] === "node" ? ["node", ...args] : [...PY, ...args]);
  }
  return out.filter((s) => s.cmds.length);
}

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return { secs: {}, failed: [] };
  }
}

const cache = readCache();
let list = stages();
const only = arg("--only");
if (process.argv.includes("--failed")) {
  list = list.filter((s) => (cache.failed || []).includes(s.name));
  if (!list.length) {
    console.log("上次沒有失敗的段。");
    process.exit(0);
  }
} else if (only) {
  const keys = only.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  list = list.filter((s) => keys.some((k) => s.name.toLowerCase().includes(k)));
}
for (const s of list) {
  // 引擎那段：多分幾份，佔同樣多格。
  s.cmds = s.cmds.map((c) => (c[1].endsWith("test_engine_shards.mjs") ? [...c, "-j", String(ENGINE_SHARDS)] : c));
  s.cost = s.cmds.some((c) => c[1].endsWith("test_engine_shards.mjs")) ? ENGINE_SHARDS : 1;
  s.guess = cache.secs?.[s.name] ?? (s.cost > 1 ? 600 : 30);
}
mkdirSync(LOGS, { recursive: true });

const env = { ...process.env, PYTHONUTF8: "1", FORCE_COLOR: "0" };
const t0 = Date.now();
const results = [];

function runCmd(cmd, log) {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env, windowsHide: true });
    p.stdout.on("data", (d) => log.push(d));
    p.stderr.on("data", (d) => log.push(d));
    p.on("error", (e) => {
      log.push(Buffer.from(String(e)));
      resolve(1);
    });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

async function runStage(s) {
  const start = Date.now();
  const log = [];
  let code = 0;
  // 同一段裡的幾行照順序跑（test.bat 原本就是這樣）；前一行失敗就不跑後面的。
  for (const cmd of s.cmds) {
    log.push(Buffer.from(`\n> ${cmd.join(" ")}\n`));
    code = await runCmd(cmd, log);
    if (code) break;
  }
  const secs = (Date.now() - start) / 1000;
  const text = Buffer.concat(log).toString("utf8");
  const file = join(LOGS, s.name.replace(/[^\w.-]+/g, "_") + ".log");
  writeFileSync(file, text);
  results.push({ name: s.name, ok: !code, secs, text, file });
  const done = results.length;
  console.log(`${code ? "FAIL" : "ok  "} ${s.name}  ${secs.toFixed(0)}s  (${done}/${list.length})`);
}

async function pool(items) {
  // 久的先跑。
  const queue = [...items].sort((a, b) => b.guess - a.guess);
  let used = 0;
  const running = new Set();
  await new Promise((resolve) => {
    const pump = () => {
      while (queue.length) {
        const i = queue.findIndex((s) => used + s.cost <= SLOTS || used === 0);
        if (i < 0) break;
        const s = queue.splice(i, 1)[0];
        used += s.cost;
        const job = runStage(s).then(() => {
          used -= s.cost;
          running.delete(job);
          pump();
        });
        running.add(job);
      }
      if (!queue.length && !running.size) resolve();
    };
    pump();
  });
}

console.log(`同時跑：${list.length} 段，最多 ${SLOTS} 格（引擎分 ${ENGINE_SHARDS} 份）。輸出在 ${LOGS}`);
await pool(list.filter((s) => !ALONE.has(s.name)));
for (const s of list.filter((s) => ALONE.has(s.name))) await runStage(s);

const failed = results.filter((r) => !r.ok);
const secs = { ...(cache.secs || {}) };
for (const r of results) secs[r.name] = Math.round(r.secs);
try {
  writeFileSync(CACHE, JSON.stringify({ secs, failed: failed.map((r) => r.name) }, null, 1));
} catch {
  /* 記不了時間就算了 */
}
const total = ((Date.now() - t0) / 1000).toFixed(0);
const slowest = [...results].sort((a, b) => b.secs - a.secs).slice(0, 5).map((r) => `${r.name} ${r.secs.toFixed(0)}s`).join("、");
console.log(`\n最久的：${slowest}`);
if (failed.length) {
  for (const r of failed) {
    const lines = r.text.split(/\r?\n/);
    const marks = lines.filter((l) => /^FAIL|✖|AssertionError|Error:|Traceback|FAILED/.test(l)).slice(0, 12);
    console.log(`\n==== FAIL ${r.name}（完整輸出：${r.file}）`);
    console.log((marks.length ? marks : lines.slice(-15)).join("\n"));
  }
  console.log(`\n${failed.length} 段失敗，共 ${total} 秒。修好後：node scripts/test_parallel.mjs --failed`);
  process.exit(1);
}
console.log(`\nall ok（${results.length} 段，共 ${total} 秒）`);
