#!/usr/bin/env node
/**
 * verify_danbooru_tags.mjs 的獨立測試。**完全不連網**，全部用假資料。
 *
 *   node scripts/test_verify_danbooru_tags.mjs
 *
 * 這支測試自己會把 globalThis.fetch 換成會爆炸的版本，所以只要有人不小心讓驗證器
 * 在 import 時連網，這裡會直接紅燈。真正打 Danbooru 的實測由 CLI 另外跑。
 */
import { existsSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, ".cache_danbooru_sport_tags.json");

let failed = 0;
function ok(name, cond, detail = "") {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}` + (detail ? `\n  ${detail}` : ""));
  } else console.log(`ok   ${name}`);
}
function eq(name, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    failed += 1;
    console.error(`FAIL ${name}\n  got  ${a}\n  want ${b}`);
  } else console.log(`ok   ${name}`);
}
/** 跑 fn，回傳它丟出來的 Error；沒丟就回 null。 */
function threw(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

// --- 14) import 不得連網、不得寫 cache、不得動 exitCode、不得印東西 ----------
// 這一段一定要在 import 驗證器「之前」佈好間諜，所以用動態 import。

const cacheBefore = existsSync(CACHE) ? statSync(CACHE).mtimeMs : null;
const exitBefore = process.exitCode;
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  fetchCalls += 1;
  throw new Error("測試不可以連網：verify_danbooru_tags.mjs 在 import 時呼叫了 fetch");
};
const printed = [];
const realLog = console.log;
const realErr = console.error;
console.log = (...a) => printed.push(a.join(" "));
console.error = (...a) => printed.push(a.join(" "));

let V;
let importErr = null;
try {
  V = await import("./verify_danbooru_tags.mjs");
} catch (err) {
  importErr = err;
} finally {
  console.log = realLog;
  console.error = realErr;
  globalThis.fetch = realFetch;
}

const cacheAfter = existsSync(CACHE) ? statSync(CACHE).mtimeMs : null;

ok("import 驗證器不會丟例外", !importErr, importErr ? String(importErr.message) : "");
if (importErr) {
  console.error(`\n${failed + 1} failed`);
  process.exit(1);
}
eq("import 不連網", fetchCalls, 0);
eq("import 不印 CLI 報告", printed, []);
eq("import 不寫 cache", cacheAfter, cacheBefore);
eq("import 不動 process.exitCode", process.exitCode, exitBefore);

const { parseArgs, verdict, createdYear, buildReport, FORBIDDEN, CliError } = V;
ok("匯出純函式 parseArgs / verdict / buildReport",
  typeof parseArgs === "function" && typeof verdict === "function" && typeof buildReport === "function");

// --- 1~4) parseArgs ---------------------------------------------------------

eq("1) --retry 維持既有行為", parseArgs(["--retry", "40"]).retries, 40);
eq("1) --retry 沒給數字時是 0", parseArgs(["--retry", "abc"]).retries, 0);
eq("1) --retry 不影響 maxCreatedYear", parseArgs(["--retry", "5"]).maxCreatedYear, null);

eq("2) --max-created 2025 解析成 2025", parseArgs(["--max-created", "2025"]).maxCreatedYear, 2025);
eq("2) --max-created 可以跟 --retry 併用",
  (() => { const o = parseArgs(["--retry", "3", "--max-created", "2024"]); return [o.retries, o.maxCreatedYear]; })(),
  [3, 2024]);

eq("3) 沒給 --max-created 時是 null", parseArgs([]).maxCreatedYear, null);
eq("3) 只給位置參數時也是 null", parseArgs(["tennis", "golf"]).maxCreatedYear, null);
eq("3) 位置參數原樣收集", parseArgs(["tennis", "golf"]).tags, ["tennis", "golf"]);

// 2026-09-18：post_count 0 那批裁決完之後，整個詞庫都驗變成**預設**。
// 這三條守住那個翻轉 —— 不小心翻回去的話，一千多個字又會回到沒人查證的狀態。
eq("3b) 預設就驗整個詞庫", parseArgs([]).all, true);
eq("3b) --sports-only 退回只驗運動清單", parseArgs(["--sports-only"]).all, false);
eq("3b) --all 保留相容（現在等於預設）", parseArgs(["--all"]).all, true);

{
  const bad = [
    ["缺值", ["--max-created"]],
    ["非數字", ["--max-created", "abc"]],
    ["小數", ["--max-created", "20.5"]],
    ["位數不足", ["--max-created", "202"]],
    ["位數過多", ["--max-created", "20250"]],
    ["空字串", ["--max-created", ""]],
    ["不合理年份", ["--max-created", "0000"]],
  ];
  for (const [label, argv] of bad) {
    const err = threw(() => parseArgs(argv));
    ok(`4) --max-created ${label} 會丟明確錯誤`,
      err instanceof CliError && /max-created/.test(err.message),
      err ? err.message : "沒有丟錯");
  }
  const unknown = threw(() => parseArgs(["--nope"]));
  ok("4) 不認得的參數會丟明確錯誤",
    unknown instanceof CliError && /--nope/.test(unknown.message),
    unknown ? unknown.message : "沒有丟錯");
}

// --- verdict 與 createdYear -------------------------------------------------

const row = (over = {}) => ({ name: "x", category: 0, is_deprecated: false, post_count: 10, created_at: "2013-02-28T00:00:00.000+09:00", ...over });

eq("verdict 有效 tag", verdict(row()), "ok");
eq("verdict 不存在", verdict(undefined), "不存在");
eq("verdict deprecated", verdict(row({ is_deprecated: true })), "deprecated");
ok("verdict category 非 0", verdict(row({ category: 4 })).startsWith("category 4"));
ok("verdict post_count 0", verdict(row({ post_count: 0 })).startsWith("post_count 0"));

eq("createdYear 正常", createdYear("2026-01-27T10:00:00.000+09:00"), 2026);
eq("createdYear null", createdYear(null), null);
eq("createdYear 空字串", createdYear(""), null);
eq("createdYear 壞格式", createdYear("not-a-date"), null);

// --- 5~12) buildReport ------------------------------------------------------

{
  // 5) 有效舊 tag 進 ok，created_at 完整保留
  const found = new Map([["school gym", row({ name: "school_gym", post_count: 1091, created_at: "2017-12-11T03:00:00.000+09:00" })]]);
  const r = buildReport(["school gym"], [], found, {});
  eq("5) 有效舊 tag 進 ok", r.ok.map((x) => x.tag), ["school gym"]);
  eq("5) bad 是空的", r.bad, []);
  eq("5) created_at 原樣保留", r.ok[0].created_at, "2017-12-11T03:00:00.000+09:00");
  eq("5) post_count 保留", r.ok[0].post_count, 1091);
  eq("5) category 保留", r.ok[0].category, 0);
  eq("5) 沒啟用門檻時 maxCreatedYear 是 null", r.maxCreatedYear, null);
  eq("5) 沒啟用門檻時 newerThanCutoff 是空的", r.newerThanCutoff, []);
}

{
  // 6) 有效但晚於門檻：仍在 ok、同時列進 newerThanCutoff、不進 bad
  const found = new Map([
    ["sports court", row({ name: "sports_court", post_count: 149, created_at: "2026-01-27T10:00:00.000+09:00" })],
    ["school gym", row({ name: "school_gym", post_count: 1091, created_at: "2017-12-11T03:00:00.000+09:00" })],
  ]);
  const r = buildReport(["sports court", "school gym"], [], found, { maxCreatedYear: 2025 });
  eq("6) 較新的 tag 仍在 ok", r.ok.map((x) => x.tag).sort(), ["school gym", "sports court"]);
  eq("6) 較新的 tag 列進 newerThanCutoff", r.newerThanCutoff.map((x) => x.tag), ["sports court"]);
  eq("6) 較新的 tag 不進 bad", r.bad, []);
  eq("6) 舊 tag 不列進 newerThanCutoff", r.newerThanCutoff.some((x) => x.tag === "school gym"), false);
  eq("6) maxCreatedYear 記在報告裡", r.maxCreatedYear, 2025);
  eq("6) newerThanCutoff 的紀錄也有 created_at", r.newerThanCutoff[0].created_at, "2026-01-27T10:00:00.000+09:00");
}

{
  // 7) 等於門檻年份不算較新
  const found = new Map([["edge", row({ created_at: "2025-06-01T00:00:00.000+09:00" })]]);
  const r = buildReport(["edge"], [], found, { maxCreatedYear: 2025 });
  eq("7) 等於門檻年份不算較新", r.newerThanCutoff, []);
  eq("7) 等於門檻年份仍在 ok", r.ok.map((x) => x.tag), ["edge"]);
  const r2 = buildReport(["edge"], [], found, { maxCreatedYear: 2024 });
  eq("7) 晚一年就算較新", r2.newerThanCutoff.map((x) => x.tag), ["edge"]);
}

{
  // 8) created_at 是 null 時不加入年份警告
  const found = new Map([["no date", row({ created_at: null })]]);
  const r = buildReport(["no date"], [], found, { maxCreatedYear: 2000 });
  eq("8) created_at null 不列進 newerThanCutoff", r.newerThanCutoff, []);
  eq("8) created_at null 仍在 ok", r.ok.map((x) => x.tag), ["no date"]);
  eq("8) created_at null 記成 null", r.ok[0].created_at, null);
}

{
  // 9~12) 各種無效情形仍然進 bad，且不因門檻而改變
  const found = new Map([
    ["dep", row({ is_deprecated: true, created_at: "2026-05-05T00:00:00.000+09:00" })],
    ["cat", row({ category: 4, created_at: "2026-05-05T00:00:00.000+09:00" })],
    ["zero", row({ post_count: 0, created_at: "2026-05-05T00:00:00.000+09:00" })],
  ]);
  const wanted = ["missing", "dep", "cat", "zero"];
  const r = buildReport(wanted, [], found, { maxCreatedYear: 2025 });
  eq("9) 不存在的 tag 進 bad", r.bad.find((x) => x.tag === "missing")?.verdict, "不存在");
  eq("9) 不存在時 created_at 是 null", r.bad.find((x) => x.tag === "missing")?.created_at, null);
  eq("9) 不存在時 post_count 記 0", r.bad.find((x) => x.tag === "missing")?.post_count, 0);
  eq("9) 不存在時 category 記 null", r.bad.find((x) => x.tag === "missing")?.category, null);
  eq("10) deprecated 進 bad", r.bad.find((x) => x.tag === "dep")?.verdict, "deprecated");
  ok("11) category 非 0 進 bad", (r.bad.find((x) => x.tag === "cat")?.verdict || "").startsWith("category 4"));
  ok("12) post_count 0 進 bad", (r.bad.find((x) => x.tag === "zero")?.verdict || "").startsWith("post_count 0"));
  eq("9~12) 四個全部在 bad", r.bad.map((x) => x.tag).sort(), ["cat", "dep", "missing", "zero"]);
  eq("9~12) ok 是空的", r.ok, []);
  eq("9~12) 無效 tag 不會因為較新而跑進 newerThanCutoff", r.newerThanCutoff, []);
}

{
  // 13) forbidden 的既有語意不變
  const found = new Map([
    ["arrow", row({ is_deprecated: true, created_at: "2013-02-28T00:00:00.000+09:00" })],
    ["cycling", row({ post_count: 0, created_at: "2013-02-28T00:00:00.000+09:00" })],
    ["basketball", row({ post_count: 500, created_at: "2013-02-28T00:00:00.000+09:00" })],
  ]);
  const r = buildReport([], ["arrow", "cycling", "basketball", "yumi"], found, {});
  eq("13) 仍然不可用的進 forbiddenStillBad",
    r.forbiddenStillBad.map((x) => x.tag).sort(), ["arrow", "cycling", "yumi"]);
  eq("13) 現在有效的進 forbiddenNowFine", r.forbiddenNowFine.map((x) => x.tag), ["basketball"]);
  eq("13) forbidden 紀錄也帶 created_at",
    r.forbiddenStillBad.find((x) => x.tag === "arrow")?.created_at, "2013-02-28T00:00:00.000+09:00");
  eq("13) forbidden 查無 tag 時 created_at 是 null",
    r.forbiddenStillBad.find((x) => x.tag === "yumi")?.created_at, null);
  eq("13) forbidden 不會影響 ok / bad", [r.ok, r.bad], [[], []]);
  ok("13) FORBIDDEN 匯出仍是原本那 12 個", Array.isArray(FORBIDDEN) && FORBIDDEN.length === 12,
    `length=${Array.isArray(FORBIDDEN) ? FORBIDDEN.length : "not array"}`);
}

// --- 15) 報告可以序列化 ------------------------------------------------------

{
  const found = new Map([["a", row({ created_at: "2026-03-03T00:00:00.000+09:00" })]]);
  const r = buildReport(["a", "b"], ["arrow"], found, { maxCreatedYear: 2025 });
  const err = threw(() => JSON.stringify(r));
  ok("15) report 可以 JSON.stringify", !err, err ? err.message : "");
  const round = JSON.parse(JSON.stringify(r));
  eq("15) 序列化後鍵完整", Object.keys(round).sort(),
    ["bad", "checkedAt", "forbiddenNowFine", "forbiddenStillBad", "maxCreatedYear", "newerThanCutoff", "ok"]);
  ok("15) checkedAt 是 ISO 字串", typeof round.checkedAt === "string" && !Number.isNaN(Date.parse(round.checkedAt)));
  eq("15) 每筆 wanted 紀錄都有五個欄位",
    [...round.ok, ...round.bad].every((x) => ["tag", "verdict", "post_count", "category", "created_at"].every((k) => k in x)),
    true);
}

// --- buildReport 的純度 ------------------------------------------------------

{
  const exitNow = process.exitCode;
  const cacheNow = existsSync(CACHE) ? statSync(CACHE).mtimeMs : null;
  buildReport(["x"], ["arrow"], new Map(), { maxCreatedYear: 2025 });
  eq("buildReport 不動 process.exitCode", process.exitCode, exitNow);
  eq("buildReport 不寫 cache", existsSync(CACHE) ? statSync(CACHE).mtimeMs : null, cacheNow);
  const r = buildReport(undefined, undefined, undefined, undefined);
  eq("buildReport 容忍空輸入", [r.ok, r.bad, r.newerThanCutoff, r.maxCreatedYear], [[], [], [], null]);
}


// --- 模型字彙白名單 ---------------------------------------------------------
// Danbooru 查無但 Illustrious／WAI 訓練時學過的 token，不能因為查不到就判無效。

{
  const { MODEL_VOCAB } = V;
  ok("匯出 MODEL_VOCAB", MODEL_VOCAB instanceof Set && MODEL_VOCAB.size > 0);

  // WAI 官方負向的五個都要在白名單裡（censored 是真 tag，不在這裡）
  for (const t of ["bad quality", "worst quality", "worst detail", "censor"]) {
    ok(`白名單含 WAI 官方負向 ${t}`, MODEL_VOCAB.has(t));
  }
  // WAI 官方正向
  for (const t of ["masterpiece", "best quality", "amazing quality"]) {
    ok(`白名單含 WAI 官方正向 ${t}`, MODEL_VOCAB.has(t));
  }
  // 品質階梯兩端
  ok("白名單含品質階梯 good quality", MODEL_VOCAB.has("good quality"));
  ok("白名單含品質階梯 low quality", MODEL_VOCAB.has("low quality"));
  // 美學階梯
  for (const t of ["very aesthetic", "displeasing", "very displeasing"]) {
    ok(`白名單含美學階梯 ${t}`, MODEL_VOCAB.has(t));
  }
  // 年代分桶
  for (const t of ["newest", "recent", "mid", "early", "oldest"]) {
    ok(`白名單含年代分桶 ${t}`, MODEL_VOCAB.has(t));
  }
  // 分級
  for (const t of ["nsfw", "general", "sensitive", "questionable", "explicit"]) {
    ok(`白名單含分級 ${t}`, MODEL_VOCAB.has(t));
  }

  // 這兩個從未是 Danbooru tag，也不是 WAI 官方品質／分級 token。
  // 若放回例外白名單，完整詞庫驗證就無法阻止它們重新混入 prompt。
  for (const t of ["soft breasts", "natural breasts"]) {
    ok(`非 Danbooru 胸型詞不在模型白名單 ${t}`, !MODEL_VOCAB.has(t));
  }

  // 真的 Danbooru tag 不可以混進白名單 —— 它們要照常驗
  for (const t of ["censored", "lowres", "jpeg artifacts", "blurry", "bad anatomy", "artist name"]) {
    ok(`白名單不收真 Danbooru tag ${t}`, !MODEL_VOCAB.has(t));
  }

  // 白名單的 token 即使 Danbooru 查無 / deprecated / count 0，都要進 ok 不進 bad
  const found = new Map([
    ["bad quality", { name: "bad_quality", category: 0, is_deprecated: false, post_count: 0, created_at: "2013-01-01T00:00:00.000+09:00" }],
    ["nsfw", { name: "nsfw", category: 0, is_deprecated: true, post_count: 0, created_at: "2013-01-01T00:00:00.000+09:00" }],
  ]);
  const r = buildReport(["bad quality", "worst quality", "nsfw", "missing thing"], [], found, {});
  eq("白名單 token 全部進 ok", r.ok.map((x) => x.tag).sort(), ["bad quality", "nsfw", "worst quality"]);
  eq("非白名單的查無仍進 bad", r.bad.map((x) => x.tag), ["missing thing"]);
  ok("白名單 token 標記 modelVocab", r.ok.every((x) => x.modelVocab === true));
  ok("Danbooru 查無的白名單 token 有說明", r.ok.find((x) => x.tag === "worst quality").verdict.includes("模型字彙"));
  ok("Danbooru 有資料但 count 0 的白名單 token 也說明", r.ok.find((x) => x.tag === "bad quality").verdict.includes("模型字彙"));
  ok("deprecated 的白名單 token 也放行", r.ok.find((x) => x.tag === "nsfw").verdict.includes("模型字彙"));

  // 白名單不參與年份警告（它們沒有真正的 created_at 意義）
  const r2 = buildReport(["worst quality"], [], new Map(), { maxCreatedYear: 2000 });
  eq("白名單不列入年份警告", r2.newerThanCutoff, []);

  // 白名單 token 若剛好也是有效 Danbooru tag，verdict 保持 ok 不被改寫
  const r3 = buildReport(["explicit"], [], new Map([
    ["explicit", { name: "explicit", category: 0, is_deprecated: false, post_count: 123, created_at: "2013-01-01T00:00:00.000+09:00" }],
  ]), {});
  eq("同時是有效 tag 時 verdict 維持 ok", r3.ok[0].verdict, "ok");
  ok("同時是有效 tag 時仍標記 modelVocab", r3.ok[0].modelVocab === true);
}


// --- meta category ----------------------------------------------------------
// 運動 tag 要 category 0；負向與正向尾巴可以是 category 5（lowres、jpeg artifacts
// 本來就是 meta）。metaOk 沒給的話一律照舊只收 category 0。
{
  const meta = (name) => ({ name, category: 5, is_deprecated: false, post_count: 1000, created_at: "2013-02-24T00:00:00.000+09:00" });
  const found = new Map([["lowres", meta("lowres")], ["jpeg artifacts", meta("jpeg_artifacts")]]);

  const strict = buildReport(["lowres", "jpeg artifacts"], [], found, {});
  eq("沒給 metaOk 時 meta 仍算不通過", strict.bad.map((x) => x.tag).sort(), ["jpeg artifacts", "lowres"]);

  const loose = buildReport(["lowres", "jpeg artifacts"], [], found, {
    metaOk: new Set(["lowres", "jpeg artifacts"]),
  });
  eq("metaOk 涵蓋時 meta 算通過", loose.ok.map((x) => x.tag).sort(), ["jpeg artifacts", "lowres"]);
  eq("metaOk 涵蓋時 bad 是空的", loose.bad, []);
  eq("metaOk 通過的 verdict 是 ok", loose.ok[0].verdict, "ok");

  // metaOk 只放行「健康的 meta」，deprecated 或 count 0 照樣擋
  const rot = new Map([
    ["dep meta", { name: "dep_meta", category: 5, is_deprecated: true, post_count: 900, created_at: null }],
    ["zero meta", { name: "zero_meta", category: 5, is_deprecated: false, post_count: 0, created_at: null }],
  ]);
  const r = buildReport(["dep meta", "zero meta"], [], rot, { metaOk: new Set(["dep meta", "zero meta"]) });
  eq("metaOk 不放行 deprecated 的 meta", r.bad.map((x) => x.tag).sort(), ["dep meta", "zero meta"]);

  // metaOk 不影響非 meta 的判斷
  const g = new Map([["ugly", { name: "ugly", category: 0, is_deprecated: true, post_count: 0, created_at: null }]]);
  eq("metaOk 不會順便放行 deprecated 的 general",
    buildReport(["ugly"], [], g, { metaOk: new Set(["ugly"]) }).bad.map((x) => x.tag), ["ugly"]);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
