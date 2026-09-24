#!/usr/bin/env node
/**
 * 字鋪牌池的命令列出口：給烘焙腳本（Python）拿 prompt，也給人看牌池長什麼樣。
 *
 *   node scripts/zipu_pool.mjs            # 摘要
 *   node scripts/zipu_pool.mjs --prompts  # JSON：[{tag, file, positive}]，只含要畫插畫的牌
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ACT_PLACE,
  NEEDS_CONTEXT,
  CTX_PULLS_ACC,
  CTX_PULLS_GEAR,
  indexLexicon,
  contradictions,
} from "../web/engine.js";
import { ratingBlocked } from "../web/rules/rating.js";
import { SPORT_PRESETS, SPORT_NEUTRAL_GEAR } from "../web/sports.js";
import { buildWorld, artPrompt, artFile, SUITS } from "../zipu/pool.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadWorld() {
  const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
  const tokenCounts = JSON.parse(readFileSync(join(ROOT, "web/token_counts.json"), "utf8")).counts;
  return buildWorld(data, {
    ratingBlocked,
    tokenCounts,
    ACT_PLACE,
    NEEDS_CONTEXT,
    CTX_PULLS_ACC,
    CTX_PULLS_GEAR,
    SPORT_PRESETS,
    SPORT_NEUTRAL_GEAR,
    indexLexicon,
    contradictions,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const world = loadWorld();
  if (process.argv.includes("--prompts")) {
    const out = world.cards
      .filter((c) => c.art)
      .map((c) => ({ tag: c.tag, file: artFile(c.tag), positive: artPrompt(world, c) }));
    process.stdout.write(JSON.stringify(out));
  } else {
    const count = (f) => world.cards.filter(f).length;
    console.log("cards", world.cards.length, "with art", count((c) => c.art), "rare", count((c) => c.rare));
    for (const s of SUITS) console.log(" ", s, count((c) => c.suit === s));
    let links = 0;
    for (const s of world.pairs.values()) links += s.size;
    console.log("pairs", links / 2, "cards with a pair", world.pairs.size);
    console.log("sets", world.sets.map((s) => `${s.name}:${s.tags.size}`).join(" "));
  }
}
