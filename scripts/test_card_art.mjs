#!/usr/bin/env node
/**
 * 共用卡面（web/card-art.js）的回歸測試：墨池、字鋪、排字匣的卡牌模式都吃這份。
 * 守三件事：底線封鎖的字永遠不是牌、畫人一定畫成年人、分級尾巴跟分級一致。
 * 秒跑完，不需要 ComfyUI。
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { cardArtJobs, jobsFileText, JOBS_FILE } from "./card_art.mjs";
import { HARD_BANNED, isCard, artPrompt, artFile, cardSuit, CARD_SUITS } from "../web/card-art.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}

const { data, cards, jobs } = cardArtJobs();
const byTag = new Map(data.tags.map((t) => [t.tag, t]));
const tagsOf = (positive) => positive.split(",").map((s) => s.trim());

/* ---------- 底線封鎖 ---------- */
{
  ok("底線封鎖清單有 loli、shota", HARD_BANNED.includes("loli") && HARD_BANNED.includes("shota"));
  for (const t of HARD_BANNED) {
    const item = byTag.get(t) || { tag: t, section: "subject", group: "other" };
    ok(`「${t}」不是牌`, !isCard(item));
    ok(`「${t}」沒有插畫 prompt`, artPrompt(item) === null);
  }
  const leaked = jobs.filter((j) => tagsOf(j.positive).some((t) => HARD_BANNED.includes(t)));
  ok("沒有任何插畫 prompt 帶到底線封鎖的字", !leaked.length, leaked.slice(0, 3).map((j) => j.tag).join(", "));
}

/* ---------- 畫人一定畫成年人 ---------- */
{
  const PEOPLE = /^(\d(girls?|boys?)|multiple (girls|boys)|solo)$/;
  const bad = jobs.filter((j) => {
    const t = tagsOf(j.positive);
    const person = t.some((x) => PEOPLE.test(x));
    if (!person) return !t.includes("no humans");
    return !t.some((x) => x === "adult" || x === "adult male");
  });
  ok("有人的插畫都標了 adult；沒人的都標了 no humans", !bad.length, bad.slice(0, 3).map((j) => `${j.tag}: ${j.positive}`).join("\n  "));
  // 同性別兩人以上：底模會把其中一個畫成小孩（2girls、3girls、2boys 實際烤出來過），
  // 所以一定要帶 mature female／mature male。
  const MULTI = /^(?:[2-9]\+?(?:girls|boys)|multiple (?:girls|boys)|yuri)$/;
  const young = jobs.filter((j) => {
    const t = tagsOf(j.positive);
    if (!t.some((x) => MULTI.test(x))) return false;
    const girls = t.some((x) => /girl|yuri/.test(x));
    const boys = t.some((x) => /boy/.test(x));
    return (girls && !t.includes("mature female")) || (boys && !t.includes("mature male"));
  });
  ok("多人（同性別兩個以上）的插畫都帶 mature female／male", !young.length, young.slice(0, 4).map((j) => `${j.tag}: ${j.positive}`).join("\n  "));
  // 一男一女也一樣：kabedon、carrying 實際烤出過穿得像學生的女生。
  const GIRLS = /^(?:\d\+?girls?|multiple girls|yuri)$/;
  const BOYS = /^(?:\d\+?boys?|multiple boys)$/;
  const pairs = jobs.filter((j) => {
    const t = tagsOf(j.positive);
    return t.some((x) => GIRLS.test(x)) && t.some((x) => BOYS.test(x));
  });
  const soft = pairs.filter((j) => !["mature female", "mature male"].every((x) => tagsOf(j.positive).includes(x)));
  ok("男女同框的插畫都帶 mature female 和 mature male", pairs.length > 0 && !soft.length, soft.slice(0, 4).map((j) => j.tag).join(", "));
  // 負面：有人的牌一定擋未成年；多人的牌再擋全家福構圖。沒有人的牌不加。
  const guard = ["loli", "shota", "child", "aged down"];
  const unguarded = jobs.filter((j) => !tagsOf(j.positive).includes("no humans") && !guard.every((g) => tagsOf(j.negative || "").includes(g)));
  ok("有人的插畫負面詞都擋 loli、shota、child、aged down", !unguarded.length, unguarded.slice(0, 4).map((j) => j.tag).join(", "));
  const groupNoFamily = [...pairs, ...jobs.filter((j) => tagsOf(j.positive).some((x) => MULTI.test(x)))].filter((j) => !tagsOf(j.negative || "").includes("family"));
  ok("多人的插畫負面詞都擋 family（全家福構圖）", !groupNoFamily.length, groupNoFamily.slice(0, 4).map((j) => j.tag).join(", "));
  const selfFight = jobs.filter((j) => tagsOf(j.negative || "").some((n) => n && tagsOf(j.positive).includes(n)));
  ok("負面詞不會跟正面詞打架", !selfFight.length, selfFight.slice(0, 4).map((j) => j.tag).join(", "));
  ok("沒有人的插畫不加負面詞", jobs.filter((j) => tagsOf(j.positive).includes("no humans")).every((j) => !j.negative));
  for (const t of ["school uniform", "serafuku", "gym uniform"]) {
    const j = jobs.find((x) => x.tag === t);
    if (j) ok(`學校味的「${t}」畫成熟女性`, tagsOf(j.positive).includes("mature female"), j.positive);
  }
}

/* ---------- 分級尾巴 ---------- */
{
  const TAIL = { general: ["sfw", "general"], sensitive: ["sensitive"], explicit: ["nsfw", "explicit"] };
  const wrong = jobs.filter((j) => {
    const t = tagsOf(j.positive);
    const want = TAIL[j.rating];
    if (!want || !want.every((x) => t.includes(x))) return true;
    if (j.rating !== "explicit" && t.includes("nsfw")) return true;
    if (j.rating === "explicit" && t.includes("sfw")) return true;
    return false;
  });
  ok("每張插畫的分級尾巴跟它的分級一致", !wrong.length, wrong.slice(0, 3).map((j) => `${j.tag} [${j.rating}]: ${j.positive}`).join("\n  "));
  ok("三級都有牌", ["general", "sensitive", "explicit"].every((r) => jobs.some((j) => j.rating === r)));
}

/* ---------- 檔名與花色 ---------- */
{
  const files = new Map();
  const clash = [];
  for (const c of cards) {
    const f = artFile(c.tag);
    if (files.has(f)) clash.push(`${files.get(f)} / ${c.tag} → ${f}`);
    files.set(f, c.tag);
  }
  ok("每張牌的插畫檔名都不撞", !clash.length, clash.slice(0, 3).join("\n  "));
  ok("檔名只有小寫英數和底線", jobs.every((j) => /^[a-z0-9_]+\.webp$/.test(j.file)), jobs.find((j) => !/^[a-z0-9_]+\.webp$/.test(j.file))?.file);
  ok("每張牌都落在六種花色之一", cards.every((c) => CARD_SUITS.includes(cardSuit(c))));
  ok("畫質固定詞（masterpiece 那類）不是牌", !cards.some((c) => c.section === "quality" && c.group !== "style" && c.group !== "boost"));
}

/* ---------- 沒裝 node 的人烤圖用的清單 ---------- */
{
  // 一般使用者只有 python：bake_card_art.py 讀 scripts/card_jobs.json。改了詞庫或 card-art.js 沒重寫這份，
  // 他們烤出來的圖就跟規則對不上（例如少了 mature female 那條）。
  const onDisk = existsSync(JOBS_FILE) ? readFileSync(JOBS_FILE, "utf8").split("\r\n").join("\n") : "";
  ok("scripts/card_jobs.json 跟現在的規則一致（不一致就跑 node scripts/card_art.mjs --write）", onDisk === jobsFileText(jobs));
}

/* ---------- 已烘焙的 manifest（有烤過才檢查） ---------- */
{
  const path = join(ROOT, "web", "cards", "manifest.json");
  if (existsSync(path)) {
    const man = JSON.parse(readFileSync(path, "utf8"));
    const hard = Object.keys(man).filter((t) => HARD_BANNED.includes(t));
    ok("manifest 裡沒有底線封鎖的字", !hard.length, hard.join(", "));
    const stale = Object.entries(man).filter(([t, m]) => {
      const j = jobs.find((x) => x.tag === t);
      return j && m.rating && m.rating !== j.rating;
    });
    ok("manifest 記的分級跟現在算出來的一致（不一致就要 --force 重烤）", !stale.length, stale.slice(0, 5).map(([t, m]) => `${t}: ${m.rating}`).join(", "));
  } else {
    console.log("skip manifest（web/cards 還沒烤）");
  }
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nok");
