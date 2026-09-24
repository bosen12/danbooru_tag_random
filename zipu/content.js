/**
 * 字鋪的內容：道具、印材、字模、鋪子升級、客人、貴客、起手字盒、附加委託。
 * 只有資料和小函式，沒有流程 —— 流程在 run.js，計分在 rules.js。
 */
import { HAND_TYPE } from "./rules.js";
import { ERA_ZH, HISTORIC_ERAS, SUIT_INFO } from "./pool.js";

const suitMult = (suit, n) => (j, c) => (c.it.card.suit === suit ? { mult: n } : null);
const eraMult = (era, n) => (j, c) => (c.it.card.eras.includes(era) ? { mult: n } : null);

const NIGHT = new Set([
  "night", "evening", "dusk", "moonlight", "full moon", "starry sky", "city lights", "neon lights",
  "candlelight", "lantern", "paper lantern", "lamppost", "torch", "bonfire", "campfire", "candle",
  "oil lamp", "fireplace", "chandelier", "candelabra", "desk lamp", "lamp", "dim lighting", "stone lantern",
]);
const SKY_GROUPS = new Set(["weather", "time", "sky"]);

/**
 * 道具。hook：
 *   card(j, c, h)       每張計分牌觸發一次，c = {it, index, isFirst, isLast}
 *   hand(j, h)          整版算完之後觸發一次
 *   retrigger(j, c, h)  這張牌要多計幾次
 *   passive             {capacity, hands, discards, handSize}
 *   payout(j, run)      委託完成時多給的錢
 *   onPrint(j)          印出一張作品時
 * 需要記數的道具把數字放在 j.state 裡（會跟著存檔）。
 */
export const JOKERS = [
  { id: "vermilion", zh: "朱墨", rarity: 1, price: 4, desc: "每一版 +4 倍率", hand: () => ({ mult: 4 }) },
  { id: "rack", zh: "鉛字架", rarity: 1, price: 5, desc: "手盒多 2 格", passive: { capacity: 2 } },
  { id: "loupe", zh: "放大鏡", rarity: 1, price: 5, desc: "長相牌計分時 +3 倍率", card: suitMult("look", 3) },
  { id: "shears", zh: "裁縫剪", rarity: 1, price: 5, desc: "服裝牌計分時 +3 倍率", card: suitMult("wear", 3) },
  { id: "footlight", zh: "舞台燈", rarity: 1, price: 5, desc: "姿勢牌計分時 +3 倍率", card: suitMult("pose", 3) },
  { id: "sketchbook", zh: "風景畫帖", rarity: 1, price: 5, desc: "場景牌計分時 +3 倍率", card: suitMult("scene", 3) },
  {
    id: "bigtype", zh: "大號鉛字", rarity: 1, price: 4, desc: "佔 3 格以上的牌計分時 +25 籌碼",
    card: (j, c) => (c.it.card.slots >= 3 ? { chips: 25 } : null),
  },
  {
    id: "spectacles", zh: "老花鏡", rarity: 1, price: 4, desc: "只佔 1 格的牌計分時 +8 籌碼",
    card: (j, c) => (c.it.card.slots === 1 ? { chips: 8 } : null),
  },
  {
    id: "quad", zh: "空鉛", rarity: 1, price: 5, desc: "手盒每空 1 格，+3 倍率",
    hand: (j, h) => {
      const free = Math.max(0, h.capacity - h.ev.slots);
      return free ? { mult: free * 3 } : null;
    },
  },
  {
    id: "abacus", zh: "算盤", rarity: 1, price: 5, desc: "身上每有 5 兩，+1 倍率",
    hand: (j, h) => {
      const n = Math.floor((h.run.money || 0) / 5);
      return n > 0 ? { mult: n } : null;
    },
  },
  { id: "wastebasket", zh: "廢紙簍", rarity: 1, price: 4, desc: "每個委託多 1 次換字", passive: { discards: 1 } },
  { id: "oillamp", zh: "加班油燈", rarity: 2, price: 6, desc: "每個委託多 1 次付印", passive: { hands: 1 } },
  {
    id: "redthread", zh: "月老紅線", rarity: 1, price: 5, desc: "每一組呼應再 +3 倍率",
    hand: (j, h) => (h.ev.pairs.length ? { mult: h.ev.pairs.length * 3 } : null),
  },
  {
    id: "apprentice", zh: "印刷學徒", rarity: 1, price: 4, desc: "每版第一張計分牌，籌碼多算兩次",
    card: (j, c) => (c.isFirst ? { chips: c.it.card.chips * 2 } : null),
  },
  {
    id: "scrap", zh: "回收鉛", rarity: 2, price: 6, desc: "每有一張撞字或不合時代的牌，+5 倍率",
    hand: (j, h) => (h.ev.burned ? { mult: h.ev.burned * 5 } : null),
  },
  {
    id: "antiquary", zh: "考據家", rarity: 2, price: 7, desc: "同代、時代全版 ×2 倍率",
    hand: (j, h) => (h.ev.type === "era" || h.ev.type === "eraFull" ? { xmult: 2 } : null),
  },
  {
    id: "catalog", zh: "型錄", rarity: 2, price: 6, desc: "版內有 3 張以上服裝牌時 ×2 倍率",
    hand: (j, h) => (h.ev.scoring.filter((it) => it.card.suit === "wear").length >= 3 ? { xmult: 2 } : null),
  },
  {
    id: "almanac", zh: "黃曆", rarity: 1, price: 5, desc: "版內有天氣、晝夜或天空牌時 +8 倍率",
    hand: (j, h) => (h.ev.scoring.some((it) => SKY_GROUPS.has(it.card.group)) ? { mult: 8 } : null),
  },
  {
    id: "nightshift", zh: "夜班", rarity: 2, price: 6, desc: "版內有夜色或燈火時 ×2 倍率",
    hand: (j, h) => (h.ev.scoring.some((it) => NIGHT.has(it.card.tag)) ? { xmult: 2 } : null),
  },
  {
    id: "club", zh: "運動社團", rarity: 2, price: 7, desc: "成套 ×3 倍率",
    hand: (j, h) => (h.ev.type === "set" ? { xmult: 3 } : null),
  },
  {
    id: "collector", zh: "收藏家", rarity: 2, price: 6, desc: "每印出一張作品，這張 +2 倍率",
    hand: (j) => ((j.state?.n || 0) > 0 ? { mult: 2 * j.state.n } : null),
    onPrint: (j) => {
      j.state = { n: (j.state?.n || 0) + 1 };
    },
    note: (j) => `目前 +${2 * (j.state?.n || 0)}`,
  },
  {
    id: "developer", zh: "顯影液", rarity: 2, price: 6, desc: "每個委託的第一次付印 ×2 倍率",
    hand: (j, h) => (h.handIndex === 0 ? { xmult: 2 } : null),
  },
  {
    id: "shortrun", zh: "短版印刷", rarity: 1, price: 5, desc: "版內 3 張以下時 +15 倍率",
    hand: (j, h) => (h.ev.items.length <= 3 ? { mult: 15 } : null),
  },
  {
    id: "handscroll", zh: "長卷", rarity: 2, price: 6, desc: "版內 6 張以上時 ×2 倍率",
    hand: (j, h) => (h.ev.items.length >= 6 ? { xmult: 2 } : null),
  },
  { id: "luckycat", zh: "招財貓", rarity: 1, price: 5, desc: "委託完成時 +3 兩", payout: () => 3 },
  {
    id: "lots", zh: "籤筒", rarity: 2, price: 6, desc: "每一版抽一支籤：×1、×2 或 ×3",
    hand: (j, h) => {
      const x = 1 + Math.floor(h.rng() * 3);
      return x > 1 ? { xmult: x } : null;
    },
  },
  {
    id: "twocolor", zh: "雙色套印", rarity: 1, price: 4, desc: "兩拼時 +10 倍率",
    hand: (j, h) => (h.ev.type === "duo" ? { mult: 10 } : null),
  },
  {
    id: "folio", zh: "四開版", rarity: 2, price: 7, desc: "全版、時代全版 ×1.5 倍率",
    hand: (j, h) => (h.ev.type === "full" || h.ev.type === "eraFull" ? { xmult: 1.5 } : null),
  },
  {
    id: "master", zh: "活字大師", rarity: 3, price: 9, desc: "版內每多一種花色，×1.25 倍率",
    hand: (j, h) => (h.ev.suits.size ? { xmult: Math.round(Math.pow(1.25, h.ev.suits.size) * 100) / 100 } : null),
  },
  { id: "cinnabar", zh: "朱砂印泥", rarity: 3, price: 8, desc: "每張計分牌 +2 倍率", card: () => ({ mult: 2 }) },
  {
    id: "mirror", zh: "反字鏡", rarity: 3, price: 9, desc: "最後一張計分牌再計一次",
    retrigger: (j, c) => (c.isLast ? 1 : 0),
  },
  {
    id: "agency", zh: "薦頭店", rarity: 2, price: 6, desc: "職業牌計分時 ×1.5 倍率",
    card: (j, c) => (c.it.card.group === "job" ? { xmult: 1.5 } : null),
  },
  { id: "kimonoshop", zh: "吳服屋", rarity: 1, price: 5, desc: "江戶的牌計分時 +4 倍率", card: eraMult("edo", 4) },
  { id: "tradinghouse", zh: "洋行", rarity: 1, price: 5, desc: "維多利亞的牌計分時 +4 倍率", card: eraMult("victorian", 4) },
  { id: "smithy", zh: "鐵匠鋪", rarity: 1, price: 5, desc: "中世紀的牌計分時 +4 倍率", card: eraMult("medieval", 4) },
  { id: "silkhouse", zh: "綢緞莊", rarity: 1, price: 5, desc: "古中國的牌計分時 +4 倍率", card: eraMult("ancient_china", 4) },
  { id: "sculptor", zh: "石像工坊", rarity: 1, price: 5, desc: "古希臘的牌計分時 +4 倍率", card: eraMult("ancient_greece", 4) },
  {
    id: "dyehouse", zh: "染坊", rarity: 1, price: 5, desc: "髮色、瞳色牌計分時 +20 籌碼",
    card: (j, c) => (c.it.card.mutex === "hair_color" || c.it.card.mutex === "eye_color" ? { chips: 20 } : null),
  },
  {
    id: "camera", zh: "照相機", rarity: 1, price: 5, desc: "鏡頭牌計分時 +5 倍率",
    card: (j, c) => (c.it.card.group === "camera" ? { mult: 5 } : null),
  },
  {
    id: "opera", zh: "戲班", rarity: 1, price: 5, desc: "表情牌計分時 +5 倍率",
    card: (j, c) => (c.it.card.group === "face" ? { mult: 5 } : null),
  },
  {
    id: "teahouse", zh: "茶館", rarity: 2, price: 6, desc: "呼應 2 組以上時 ×2 倍率",
    hand: (j, h) => (h.ev.pairs.length >= 2 ? { xmult: 2 } : null),
  },
  {
    id: "gilding", zh: "鎏金", rarity: 3, price: 10, desc: "燙金的牌計分時 ×1.5 倍率",
    card: (j, c) => (c.it.inst.enh === "gold" ? { xmult: 1.5 } : null),
  },
  {
    id: "ghostwriter", zh: "代筆", rarity: 1, price: 4, desc: "每個附帶的字再 +8 籌碼",
    hand: (j, h) => {
      const n = h.ev.scoring.reduce((s, it) => s + it.ghosts.length, 0);
      return n ? { chips: n * 8 } : null;
    },
  },
];
export const JOKER = Object.fromEntries(JOKERS.map((j) => [j.id, j]));
export const RARITY_ZH = { 1: "普通", 2: "少見", 3: "珍品" };

/** 印材：用在手上的牌。target 是要選幾張（0 = 不用選）。 */
export const MATERIALS = [
  { id: "gold", zh: "金箔", price: 3, target: 1, desc: "選 1 張手牌燙金：計分時 +30 籌碼" },
  { id: "seal", zh: "朱印泥", price: 3, target: 1, desc: "選 1 張手牌蓋朱印：計分時 +4 倍率" },
  { id: "bronze", zh: "銅模", price: 4, target: 1, desc: "選 1 張手牌鑄銅：計分時 ×1.5 倍率" },
  { id: "dup", zh: "複刻", price: 3, target: 1, desc: "選 1 張手牌，多刻一張一模一樣的放進字盒" },
  { id: "recut", zh: "改刻", price: 3, target: 1, desc: "選 1 張手牌，改刻成同一類的另一個字（保留燙金朱印）" },
  { id: "melt", zh: "熔爐", price: 3, target: 2, desc: "選至多 2 張手牌，從字盒裡熔掉" },
  { id: "purse", zh: "錢袋", price: 4, target: 0, desc: "身上的錢翻倍（最多多 20 兩）" },
];
export const MATERIAL = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

/** 字模：買下就把一種牌型升一級。拿中文字體當行星。 */
export const TYPEFACES = [
  { id: "tf-loose", type: "loose", zh: "宋體字模" },
  { id: "tf-duo", type: "duo", zh: "楷書字模" },
  { id: "tf-trio", type: "trio", zh: "隸書字模" },
  { id: "tf-full", type: "full", zh: "仿宋字模" },
  { id: "tf-mono", type: "mono", zh: "黑體字模" },
  { id: "tf-era", type: "era", zh: "篆書字模" },
  { id: "tf-set", type: "set", zh: "魏碑字模" },
  { id: "tf-eraFull", type: "eraFull", zh: "金文字模" },
].map((t) => ({ ...t, price: 3, desc: `「${HAND_TYPE[t.type].zh}」升一級` }));
export const TYPEFACE = Object.fromEntries(TYPEFACES.map((t) => [t.id, t]));

/** 鋪子升級：每一章的商店擺一樣，買了就一直有效。 */
export const VOUCHERS = [
  { id: "longstick", zh: "長手盒", price: 10, desc: "手盒永久多 2 格", mod: { capacity: 2 } },
  { id: "bigcase", zh: "大字盒", price: 10, desc: "手牌永久多 1 張", mod: { handSize: 1 } },
  { id: "fasthand", zh: "快手", price: 10, desc: "每個委託永久多 1 次付印", mod: { hands: 1 } },
  { id: "recycle", zh: "回收桶", price: 10, desc: "每個委託永久多 1 次換字", mod: { discards: 1 } },
];
export const VOUCHER = Object.fromEntries(VOUCHERS.map((v) => [v.id, v]));

export const PACKS = [
  { id: "pack-cards", zh: "一疊鉛字", price: 4, desc: "翻開 3 張字，挑 1 張放進字盒", kind: "cards", show: 3 },
  { id: "pack-type", zh: "字模匣", price: 4, desc: "翻開 3 個字模，挑 1 個", kind: "typefaces", show: 3 },
  { id: "pack-mat", zh: "印材盒", price: 4, desc: "翻開 2 種印材，挑 1 種", kind: "materials", show: 2 },
];
export const PACK = Object.fromEntries(PACKS.map((p) => [p.id, p]));

/** 散客與熟客。portrait 是烘焙插畫用的 prompt。 */
export const CUSTOMERS = [
  { id: "teahouse", zh: "茶館老闆娘", hello: "晚上好。我們茶館要換一張新的掛畫。", portrait: "1girl, mature female, apron, hair bun, chinese clothes, teahouse, smile" },
  { id: "scholar", zh: "窮書生", hello: "錢不多，但我想要一張好畫。", portrait: "1boy, scholar, hanfu, holding book, thin, gentle smile" },
  { id: "editor", zh: "報館編輯", hello: "明天的副刊缺一張插畫，今晚就要。", portrait: "1boy, glasses, vest, rolled up sleeves, holding newspaper, office" },
  { id: "photographer", zh: "照相館老闆", hello: "我拍了一輩子照片，想看看你們排出來的。", portrait: "1boy, old man, mustache, suit, vintage camera, photo studio" },
  { id: "lady", zh: "洋行小姐", hello: "給我來點不一樣的。", portrait: "1girl, victorian, dress, parasol, gloves, elegant, smile" },
  { id: "inspector", zh: "巡捕房探長", hello: "我在找一張畫裡的人。你們排排看。", portrait: "1boy, detective, coat, fedora, serious, city street, night" },
  { id: "teacher", zh: "學堂先生", hello: "拿去給學生們當範本的。", portrait: "1girl, teacher, glasses, cardigan, holding book, classroom" },
  { id: "apothecary", zh: "藥鋪掌櫃", hello: "店裡太素了，掛張畫熱鬧熱鬧。", portrait: "1boy, old man, chinese clothes, beard, medicine cabinet, smile" },
  { id: "florist", zh: "賣花姑娘", hello: "我想要一張看了會開心的畫。", portrait: "1girl, flower basket, straw hat, sundress, smile, flowers" },
  { id: "storyteller", zh: "說書人", hello: "下一回的故事，就照你們排的畫來講。", portrait: "1boy, old man, folding fan, chinese clothes, teahouse, open mouth" },
  { id: "boatman", zh: "船家", hello: "船艙裡想掛一張。", portrait: "1boy, straw hat, tan, boat, river, smile" },
  { id: "taoist", zh: "道士", hello: "此畫有用。你照排便是。", portrait: "1boy, taoist, robe, long hair, ofuda, mountain, mist" },
  { id: "painter", zh: "畫師", hello: "我畫不出來的東西，想看你們怎麼排。", portrait: "1girl, painter, beret, paintbrush, paint on face, art studio" },
  { id: "waitress", zh: "咖啡館女侍", hello: "店長說要一張能讓客人多坐一會兒的畫。", portrait: "1girl, waitress, apron, cafe, holding tray, smile" },
];
export const CUSTOMER = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c]));

/**
 * 貴客：每章第三個委託。規則要一句話講得完。
 *   debuff(card) → 這張不計分的理由；mod → 改付印／換字／手牌／手盒；zeroIf(ev, round) → 整版不計分的理由。
 */
export const BOSSES = [
  { id: "critic", zh: "挑剔的評論家", rule: "場景牌不計分", portrait: "1boy, monocle, suit, arrogant, art gallery", debuff: (c) => (c.suit === "scene" ? "評論家不看場景" : "") },
  { id: "scholarly", zh: "老學究", rule: "只屬於現代的牌不計分", portrait: "1boy, old man, chinese clothes, long beard, scroll, frown", debuff: (c) => (c.eras.length === 1 && c.eras[0] === "modern" ? "老學究嫌它太新" : "") },
  { id: "deadline", zh: "趕稿的主筆", rule: "付印次數少 1 次", portrait: "1boy, glasses, messy hair, ink stains, clock, night, office", mod: { hands: -1 } },
  { id: "miser", zh: "吝嗇的掌櫃", rule: "不能換字", portrait: "1boy, fat, abacus, chinese clothes, counting money, smug", mod: { discards: -99 } },
  { id: "tailor", zh: "裁縫師傅", rule: "服裝牌不計分", portrait: "1girl, mature female, tape measure, glasses, sewing, tailor shop", debuff: (c) => (c.suit === "wear" ? "裁縫師傅嫌棄這身衣服" : "") },
  { id: "diva", zh: "戲班花旦", rule: "姿勢牌不計分", portrait: "1girl, chinese opera, peking opera, headdress, makeup, stage", debuff: (c) => (c.suit === "pose" ? "花旦只認自己的身段" : "") },
  { id: "comprador", zh: "洋行買辦", rule: "長相牌不計分", portrait: "1boy, suit, bowler hat, mustache, victorian, cane", debuff: (c) => (c.suit === "look" ? "買辦不看臉" : "") },
  { id: "myopic", zh: "近視的老師傅", rule: "佔 3 格以上的牌不計分", portrait: "1boy, old man, thick glasses, squinting, print shop, apron", debuff: (c) => (c.slots >= 3 ? "字太長，老師傅看不清" : "") },
  { id: "bride", zh: "急性子的新娘", rule: "手盒少 4 格", portrait: "1girl, bride, wedding dress, veil, impatient, church", mod: { capacity: -4 } },
  { id: "proofreader", zh: "嚴格的校對", rule: "有撞字或不合時代的牌，整版不計分", portrait: "1girl, glasses, red pen, stern, proofreading, desk", zeroIf: (ev) => (ev.burned > 0 ? "校對抓到錯字，整版作廢" : "") },
  { id: "fickle", zh: "喜新厭舊的收藏家", rule: "同一種牌型只算第一次", portrait: "1girl, rich, fur coat, jewelry, bored, mansion", zeroIf: (ev, round) => (round.typesPlayed.includes(ev.type) ? "這種牌型收藏家已經有了" : "") },
  { id: "fortune", zh: "算命先生", rule: "手牌少 1 張", portrait: "1boy, fortune teller, round eyewear, chinese clothes, fortune sticks, street stall", mod: { handSize: -1 } },
];
export const BOSS = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
export const FINAL_BOSS = { id: "owner", zh: "字鋪東家", portrait: "1girl, mature female, qipao, fur shawl, smoking pipe, sitting, print shop, dim lighting, confident" };

/** 起手字盒：四種花色各 9 張。 */
export const DECKS = [
  {
    id: "daily",
    zh: "日常字盒",
    desc: "現代的街角、咖啡館、圖書館。呼應好湊，最適合第一次開鋪。",
    tags: [
      "black hair", "blonde hair", "red hair", "brown hair", "long hair", "short hair", "ponytail", "twintails", "blue eyes",
      "shirt", "skirt", "dress", "hoodie", "jeans", "sweater", "apron", "glasses", "umbrella",
      "standing", "sitting", "smile", "looking back", "reading", "cooking", "shopping", "drinking", "from above",
      "library", "kitchen", "cafe", "street", "park", "rain", "night", "city lights", "candlelight",
    ],
  },
  {
    id: "period",
    zh: "時代劇字盒",
    desc: "江戶、古中國、維多利亞混在一盒。同代好湊，但要小心不合時代。",
    tags: [
      "black hair", "white hair", "long hair", "very long hair", "hair bun", "hime cut", "braid", "red eyes", "blue eyes",
      "kimono", "yukata", "hakama", "geta", "hanfu", "ruqun", "gown", "corset", "capelet",
      "standing", "seiza", "kneeling", "smile", "looking back", "looking down", "head tilt", "reading", "writing",
      "shrine", "torii", "paper lantern", "cherry blossoms", "palace", "pavilion", "mansion", "candlelight", "night",
    ],
  },
  {
    id: "sports",
    zh: "運動字盒",
    desc: "球場、球具、球衣。湊成套分數最高，但其他牌型偏弱。",
    tags: [
      "ponytail", "high ponytail", "short hair", "black hair", "brown hair", "blonde hair", "blue eyes", "green eyes", "freckles",
      "basketball uniform", "tennis uniform", "soccer uniform", "sneakers", "sportswear", "track jacket", "t-shirt", "shorts", "baseball cap",
      "playing sports", "tennis", "soccer", "stretching", "jogging", "standing", "smile", "looking back", "from below",
      "basketball court", "tennis court", "soccer field", "basketball (object)", "tennis racket", "tennis ball", "soccer ball", "blue sky", "day",
    ],
  },
];
export const DECK = Object.fromEntries(DECKS.map((d) => [d.id, d]));

/**
 * 章的門檻。散客 ×1、熟客 ×1.5、貴客 ×2。
 * 比 Balatro 那條曲線緩：模擬機器人（只會挑眼前最高分、不懂道具連乘）平均走到第 5～6 章，
 * 懂得湊呼應、疊乘法道具的人才打得穿第 8 章。
 */
export const ANTE_BASE = [300, 700, 1600, 3600, 7500, 13000, 22000, 35000];
export const FINAL_ANTE = 8;
export function anteBase(ante) {
  if (ante <= ANTE_BASE.length) return ANTE_BASE[ante - 1];
  let v = ANTE_BASE[ANTE_BASE.length - 1];
  for (let a = ANTE_BASE.length; a < ante; a++) v = Math.round(v * 1.8);
  return v;
}
export const BLINDS = [
  { key: "small", zh: "散客", mult: 1, reward: 3 },
  { key: "big", zh: "熟客", mult: 1.5, reward: 4 },
  { key: "boss", zh: "貴客", mult: 2, reward: 5 },
];

/** 附加委託：做到了多給錢。從玩家自己的字盒裡出題，保證做得到。 */
export function makeRequest(world, deckTags, rand) {
  const kinds = ["tag", "tag", "suitCount", "full", "pair", "slots"];
  const eraCounts = new Map();
  for (const t of deckTags) {
    const c = world.byCard.get(t);
    if (!c) continue;
    for (const e of c.eras) if (HISTORIC_ERAS.includes(e)) eraCounts.set(e, (eraCounts.get(e) || 0) + 1);
  }
  const eras = [...eraCounts].filter(([, n]) => n >= 4).map(([e]) => e);
  if (eras.length) kinds.push("era", "era");
  const pairable = deckTags.filter((t) => world.pairs.has(t) && [...world.pairs.get(t)].some((u) => deckTags.includes(u)));
  const kind = kinds[Math.floor(rand() * kinds.length)];
  if (kind === "tag") {
    const tag = deckTags[Math.floor(rand() * deckTags.length)];
    return { kind, tag, text: `畫裡要有「${world.byCard.get(tag)?.zh || tag}」` };
  }
  if (kind === "suitCount") {
    const suit = ["look", "wear", "pose", "scene"][Math.floor(rand() * 4)];
    return { kind, suit, n: 3, text: `${SUIT_INFO[suit].zh}牌至少 3 張` };
  }
  if (kind === "pair" && pairable.length) return { kind, text: "要有呼應：東西配得上地方" };
  if (kind === "era") {
    const era = eras[Math.floor(rand() * eras.length)];
    return { kind, era, text: `要一版${ERA_ZH[era]}的同代` };
  }
  if (kind === "slots") return { kind, n: 8, text: "排得滿一點：至少 8 格" };
  return { kind: "full", text: "長相、服裝、姿勢、場景，一樣都不能少" };
}

export function requestMet(req, ev) {
  if (!req) return false;
  switch (req.kind) {
    case "tag":
      return ev.scoring.some((it) => it.card.tag === req.tag);
    case "suitCount":
      return ev.scoring.filter((it) => it.card.suit === req.suit).length >= req.n;
    case "pair":
      return ev.pairs.length > 0;
    case "era":
      return (ev.type === "era" || ev.type === "eraFull") && ev.era === req.era;
    case "slots":
      return ev.slots >= req.n;
    case "full":
      return ev.suits.size === 4;
    default:
      return false;
  }
}
export const REQUEST_BONUS = 3;
