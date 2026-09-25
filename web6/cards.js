/**
 * 墨池的卡牌：整本詞庫 → 卡牌資料，以及卡面 DOM。
 * 花色、分級、插畫檔名都來自 web/card-art.js（字鋪、烘焙腳本共用同一份）。
 */
import { isCard, cardSuit, ratingTier, artFile, artSources, artUrl, applyArtSources, groupSeal, CARD_SUIT_INFO, CARD_SUITS } from "./card-art.js";
import { el } from "./ui.js";

export { CARD_SUIT_INFO, CARD_SUITS };

export const ERA_ZH = {
  any: "不限時代",
  modern: "現代",
  ancient_china: "古中國",
  ancient_greece: "古希臘",
  medieval: "中世紀",
  edo: "江戶",
  victorian: "維多利亞",
};

export const RATING_ZH = { general: "全年齡", sensitive: "敏感", explicit: "色情" };

/** 詞庫 → 卡牌。順序照詞庫，所以同一類的字會排在一起。 */
export function buildLibrary(data, { ratingBlocked }) {
  const cards = [];
  const byTag = new Map();
  for (const item of data.tags) {
    if (!isCard(item)) continue;
    const card = {
      tag: item.tag,
      zh: item.zh || item.tag,
      suit: cardSuit(item),
      group: item.group,
      groupZh: (data.groupZh && data.groupZh[item.group]) || item.group,
      seal: groupSeal(item),
      rating: ratingTier(item, ratingBlocked),
      gate: item.gate,
      eras: item.era || ["any"],
      item,
    };
    cards.push(card);
    byTag.set(card.tag, card);
  }
  return { cards, byTag };
}

export function createAssets(manifest) {
  const have = new Set(Object.keys(manifest || {}));
  return {
    /** 原圖：放大牌、校樣、詳情用。 */
    art(tag) {
      return have.has(tag) ? artUrl({ ...manifest[tag], file: artFile(tag) }) : null;
    },
    /** 格子用：有縮圖就給 srcset，讓瀏覽器照畫出來的大小挑。 */
    sources(tag) {
      return have.has(tag) ? artSources({ ...manifest[tag], file: artFile(tag) }) : null;
    },
    count() {
      return have.size;
    },
  };
}

/** 一張牌。左邊是直排書脊（花色、字名、分級），疊起來也讀得到。 */
export function cardNode(card, assets, { tagName = "button", flag, src } = {}) {
  const len = [...card.zh].length;
  const art = assets.art(card.tag);
  const suit = CARD_SUIT_INFO[card.suit];
  const node = el(
    tagName,
    {
      class: "card",
      type: tagName === "button" ? "button" : undefined,
      dataset: { suit: card.suit, tag: card.tag },
      "aria-label": `${card.zh}（${card.tag}）・${suit.zh}${card.seal ? "・" + card.groupZh : ""}${card.rating !== "general" ? "・" + RATING_ZH[card.rating] : ""}`,
      role: tagName === "button" ? undefined : "img",
    },
    el(
      "span",
      { class: "card-spine", "aria-hidden": "true" },
      el("span", { class: "card-suit" }, suit.glyph),
      el("span", { class: "card-name", dataset: { len: String(Math.min(len, 8)) } }, card.zh),
      card.rating !== "general" ? el("span", { class: "card-rate", dataset: { r: card.rating } }, card.rating === "explicit" ? "色" : "敏") : null,
      card.seal ? el("span", { class: "card-seal", title: card.groupZh }, card.seal) : null
    ),
    el(
      "span",
      { class: "card-art", "aria-hidden": "true" },
      art ? artImg(assets.sources ? assets.sources(card.tag) : { src: art }) : el("span", { class: "card-glyph" }, [...card.zh][0]),
      flag ? el("span", { class: "card-flag", dataset: { kind: flag.kind } }, flag.text) : null,
      src ? el("span", { class: "card-flag", dataset: { kind: "src" } }, src) : null
    )
  );
  return node;
}

function artImg(sources) {
  const i = applyArtSources(el("img", { alt: "", decoding: "async", draggable: "false" }), sources);
  i.addEventListener("error", () => i.remove(), { once: true });
  return i;
}

export function setCardFlag(node, flag) {
  node.querySelector(".card-flag:not([data-kind='src'])")?.remove();
  if (!flag) return;
  node.querySelector(".card-art").append(el("span", { class: "card-flag", dataset: { kind: flag.kind } }, flag.text));
}

/** 卡牌的說明（提示框、詳情共用）。 */
export function cardFacts(card, lex, data) {
  const facts = [];
  facts.push(["花色", `${CARD_SUIT_INFO[card.suit].zh}・${card.groupZh}`]);
  facts.push(["分級", RATING_ZH[card.rating]]);
  facts.push(["時代", card.eras.map((e) => ERA_ZH[e] || e).join("、")]);
  if (card.gate === "female") facts.push(["人物", "只在有女性時"]);
  if (card.gate === "male") facts.push(["人物", "只在有男性時"]);
  const item = card.item;
  if (item.mutex) {
    // mutex 是內部代號（hair_length、female_count…），大半沒有中文名；
    // 舉兩個同格的字當例子，比露出代號好懂。
    const sibs = (lex.siblings && lex.siblings.get(card.tag)) || [];
    const eg = sibs.slice(0, 2).map((t) => lex.byTag.get(t)?.zh || t).join("、");
    facts.push(["同一格", sibs.length ? `一張圖只留一個：跟${eg}${sibs.length > 2 ? ` 等 ${sibs.length} 個` : ""}互斥` : "一張圖只留一個"]);
  }
  const rel = [...(item.implies || []), ...(item.bind || [])];
  if (rel.length) facts.push(["附帶", rel.map((t) => lex.byTag.get(t)?.zh || t).join("、")]);
  void data;
  return facts;
}
