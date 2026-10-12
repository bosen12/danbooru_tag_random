#!/usr/bin/env node
/**
 * 重建 docs/superpowers/specs/2026-09-22-m-conflict-graph.json（M 互斥索引的資料）。
 *
 * 詞庫的 mutex／mutexExtra 改了之後跑一次；test_m_mutex_index.mjs 會比對這份圖跟
 * engine 的 extraMutex（item._mx）、lex.siblings 是否一致。輸出存成單行 JSON。
 *
 *   node scripts/build_m_conflict_graph.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { indexLexicon } from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/superpowers/specs/2026-09-22-m-conflict-graph.json");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);

const tagToGroups = {};
const groupToTags = {};
for (const item of data.tags) {
  const groups = [...(item._mx || [])].sort();
  if (!groups.length) continue;
  tagToGroups[item.tag] = groups;
  for (const g of groups) (groupToTags[g] ||= []).push(item.tag);
}
for (const g of Object.keys(groupToTags)) groupToTags[g].sort();

const tagToSiblings = {};
let edges = 0;
for (const item of data.tags) {
  const sib = [...(lex.siblings.get(item.tag) || [])].sort();
  if (!sib.length) continue;
  tagToSiblings[item.tag] = sib;
  edges += sib.length;
}

const graph = {
  kind: "M",
  generated: new Date().toISOString().slice(0, 10),
  stats: {
    tagCount: data.tags.length,
    tagsWithGroups: Object.keys(tagToGroups).length,
    groupCount: Object.keys(groupToTags).length,
    groupsWithMultipleTags: Object.values(groupToTags).filter((t) => t.length > 1).length,
    siblingEdgeEndpoints: Object.keys(tagToSiblings).length,
    siblingEdgesApprox: Math.round(edges / 2),
  },
  tagToGroups,
  groupToTags,
  tagToSiblings,
};
writeFileSync(OUT, JSON.stringify(graph));
console.log(`wrote ${OUT}`, JSON.stringify(graph.stats));
