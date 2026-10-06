"""細分類：給人找字用的小分類（字盒、左欄、必抽）。

`group`（groups.py）是引擎在用的：骨架格、時代道具、場地判斷、卡面提示詞都看它，
動了就會改到抽取結果和卡面。這一層只管「放在哪一格讓人找得到」：
- 不拆的小分類，細分類就是它自己（sub == group）。
- 拆開的小分類（SPLIT），每個字都要在下面的清單裡有位置，沒有的話 merge 直接報錯 ——
  不留「其他」這種找不到東西的格子。
- 清單可以跨小分類收字，只要在同一段（例如誘惑裡的 closed mouth 放進「表情・嘴」）。

改這裡不會改到抽取：引擎只在必抽時看細分類（必抽「地點・住家」就從住家抽）。
"""

# 拆開的小分類。這些 group 的字都要被下面的 SUBS 收走。
SPLIT = {
    ("quality", "style"),
    ("subject", "extra"),
    ("feature", "hair_style"),
    ("feature", "eyes"),
    ("feature", "body_f"),
    ("feature", "body_m"),
    ("feature", "race"),
    ("feature", "skin"),
    ("feature", "job"),
    ("feature", "sex"),
    ("feature", "other"),
    ("pose", "camera"),
    ("pose", "face"),
    ("pose", "tease"),
    ("pose", "flash"),
    ("pose", "sex"),
    ("pose", "activity"),
    ("pose", "other"),
    ("clothing", "era"),
    ("clothing", "onepiece"),
    ("clothing", "top"),
    ("clothing", "bottom"),
    ("clothing", "underwear"),
    ("clothing", "fabric"),
    ("clothing", "acc"),
    ("env", "place"),
    ("env", "effect"),
    ("env", "other"),
}

# 每段的細分類，依顯示順序。(id, 中文, [字…])。
# id 跟某個沒拆的小分類同名時，那個小分類的字全部預設放這裡，清單裡的是另外收進來的字；
# 清單是 None 就是原樣。
# 拆開的小分類不能沿用原本的 id（例如 eyes 拆成 eye_color／eye_shape），
# 這樣舊存檔裡的必抽「feature:eyes」還是照整個小分類抽，不會默默變成只抽一半。
SUBS = {
    "quality": [
        ("fixed", "固定", None),
        ("style_tech", "畫風・技法", [
            "realistic", "anime coloring", "flat color", "drop shadow", "thick outlines",
            "lineart", "screentones", "comic", "chibi", "painterly", "watercolor (medium)",
            "ink wash painting", "ukiyo-e", "pixel art", "uncensored",
        ]),
        ("style_palette", "畫風・色調", [
            "monochrome", "greyscale", "sepia", "spot color", "partially colored",
            "pastel colors", "muted colors", "limited palette", "colorful", "high contrast",
            "neon palette",
        ]),
        ("style_era", "畫風・年代題材", [
            "1980s (style)", "1990s (style)", "2000s (style)", "retro artstyle",
            "art nouveau", "steampunk", "cyberpunk",
        ]),
        ("boost", "解析／美感", None),
    ],
    "subject": [
        ("count_f", "人數・女", None),
        ("count_m", "人數・男", None),
        ("cast_mix", "人數・組成", [
            "solo", "solo focus", "multiple girls", "multiple boys", "no humans",
        ]),
        ("pairing", "配對", ["hetero", "yuri"]),
    ],
    "feature": [
        ("hair_len", "髮長", None),
        ("hair_color", "髮色", None),
        ("hair_shape", "髮型・綁法造型", [
            "ponytail", "high ponytail", "low ponytail", "side ponytail", "braided ponytail",
            "folded ponytail", "twintails", "low twintails", "braid", "twin braids",
            "single braid", "hair bun", "double bun", "single hair bun", "half updo",
            "drill hair", "hime cut", "undercut", "hair slicked back", "mohawk",
            "dreadlocks", "afro", "cornrows",
            "two side up", "one side up", "short twintails", "side braid", "twin drills", "hair rings",
        ]),
        ("hair_detail", "髮型・瀏海髮質", [
            "blunt bangs", "swept bangs", "parted bangs", "bangs pinned back", "sidelocks",
            "hair intakes", "ahoge", "antenna hair", "hair flaps", "parted hair",
            "hair over shoulder", "hair over one eye", "hair between eyes",
            "eyes visible through hair", "straight hair", "wavy hair", "curly hair",
            "messy hair", "floating hair", "glowing hair",
            "double-parted bangs", "crossed bangs", "spiked hair", "hair behind ear",
        ]),
        ("wear_bits", "髮飾兜帽", ["hair scrunchie", "hair flower", "hood up"]),
        ("eye_color", "眼睛・瞳色", [
            "brown eyes", "blue eyes", "green eyes", "red eyes", "grey eyes", "yellow eyes",
            "pink eyes", "purple eyes", "orange eyes", "aqua eyes", "heterochromia",
            "glowing eyes", "glowing eye",
            "black eyes", "multicolored eyes",
        ]),
        ("eye_shape", "眼睛・眼型瞳孔", [
            "tsurime", "tareme", "narrowed eyes", "closed eyes", "eyelashes",
            "long eyelashes", "colored eyelashes", "thick eyebrows", "bags under eyes",
            "slit pupils", "ringed eyes", "dilated pupils", "symbol-shaped pupils",
            "star-shaped pupils", "heart-shaped pupils", "tears",
            "bright pupils", "white pupils", "one eye covered", "v-shaped eyebrows",
        ]),
        ("mouth_bits", "嘴牙舌", ["tongue", "teeth", "fang", "saliva", "saliva trail", "skin fang"]),
        ("makeup", "妝容", ["eyeshadow", "eyeliner"]),
        ("skin_tone", "皮膚・膚色", [
            "pale skin", "tan", "tanlines", "sun tattoo", "dark skin", "very dark skin",
            "black skin", "green skin", "dark-skinned female", "dark-skinned male", "shiny skin",
            "colored skin",
        ]),
        ("skin_flush", "皮膚・臉紅汗濕", [
            "blush", "nose blush", "body blush", "blush stickers", "sweat", "nervous sweating",
            "sweatdrop", "wet", "wet hair", "steaming body",
            "flying sweatdrops", "light blush",
        ]),
        ("skin_mark", "皮膚・痣疤傷", [
            "mole", "mole under eye", "mole under mouth", "mole on cheek", "mole on breast",
            "freckles", "body freckles", "scar", "scar on face", "scar on cheek", "injury",
            "bruise", "bruise on face", "whip marks", "bite mark", "lipstick mark",
            "lipstick mark on neck", "blood on face", "blood from mouth", "nosebleed", "veins",
        ]),
        ("tattoo", "皮膚・刺青印記", [
            "tattoo", "arm tattoo", "leg tattoo", "neck tattoo", "ass tattoo", "tramp stamp",
            "heart tattoo", "tribal tattoo", "pubic tattoo", "branded", "body writing", "tally",
            "facial mark", "forehead mark", "bindi",
        ]),
        ("bf_shape", "身體・女性身材", [
            "petite", "tall female", "loli", "toned", "muscular female", "curvy", "narrow waist",
            "wide hips", "thick thighs", "thigh gap", "long legs", "huge ass", "mature female",
            "old woman", "pregnant", "minigirl", "giantess", "quadruple amputee",
        ]),
        ("bf_breast", "身體・胸部", [
            "flat chest", "small breasts", "medium breasts", "large breasts", "huge breasts",
            "gigantic breasts", "breasts", "cleavage", "sideboob", "underboob", "backboob",
            "hanging breasts", "sagging breasts", "unaligned breasts", "breasts apart",
            "breasts squeezed together", "bouncing breasts", "breasts out", "breast expansion",
        ]),
        ("bf_intimate", "身體・乳頭私處", [
            "nipples", "puffy nipples", "inverted nipples", "huge nipples", "long nipples",
            "dark nipples", "large areolae", "covered nipples", "nipple piercing", "lactation",
            "pussy", "clitoris", "cleft of venus", "pubic hair", "female pubic hair",
            "pussy piercing", "uterus", "cervix",
            "cum on ass", "futanari",
        ]),
        ("bf_touch", "身體・托胸觸碰", [
            "grabbing own breast", "arm under breasts", "arms under breasts", "breast lift",
            "breast press", "breast suppress", "breast rest", "breasts on table",
            "breasts on glass", "nipple stimulation", "tweaking own nipple",
            "guided breast grab", "grabbing another's breast", "grabbing another's ass",
            "breast bondage", ]),
        ("body_part", "身體・部位", [
            "forehead", "collarbone", "shoulder blades", "armpits", "biceps", "ribs", "midriff",
            "belly", "navel", "covered navel", "ass", "ass ripple", "thighs", "skindentation",
            "thigh strap",
            "stomach",
        ]),
        ("bm_build", "身體・男性身材", [
            "short male", "tall male", "shota", "skinny", "toned male", "muscular",
            "muscular male", "bara", "abs", "pectorals", "broad shoulders", "adam's apple",
            "plump", "fat", "fat man", "obese", "manboobs", "mature male", "old man",
            "giant male", ]),
        ("bm_hair", "身體・鬍子體毛", [
            "facial hair", "stubble", "beard", "goatee", "mustache", "chest hair", "arm hair",
            "leg hair", "male pubic hair",
        ]),
        ("bm_penis", "身體・陰莖睪丸", [
            "penis", "small penis", "large penis", "huge penis", "veiny penis", "erection",
            "half-erect", "flaccid", "twitching penis", "penis out", "penis peek", "phimosis",
            "foreskin", "condom on penis", "penis on ass", "testicles", "small testicles",
            "large testicles", "huge testicles", "covered testicles", "animal penis",
            "horse penis",
        ]),
        ("race_fantasy", "種族・奇幻", [
            "elf", "dark elf", "dwarf", "vampire", "demon", "demon girl", "demon boy", "oni",
            "ghost", "zombie", "skeleton", "android", "alien", "slime girl", "slime boy",
            "mermaid", "merman", "lamia", "harpy", "centaur", "satyr", "minotaur", "goblin",
            "orc", "ogre", "troll", "kobold", "lizardman", "monster girl", "monster boy",
            "fairy", "cyborg",
        ]),
        ("race_kemono", "種族・獸耳獸人", [
            "cat girl", "fox girl", "kitsune", "wolf girl", "dog girl", "rabbit girl",
            "cow girl", "dragon girl", "cat boy", "fox boy", "wolf boy", "dog boy",
            "rabbit boy", "horse boy", "bear boy", "tiger boy", "lion boy", "dragon boy",
            "shark boy", "tanuki", "werewolf",
            "horse girl",
        ]),
        ("nonhuman", "種族・非人特徵", [
            "animal ears", "pointy ears", "tail", "horns", "demon horns", "wings",
            "demon wings", "angel wings", "tusks", "robot joints",
            "cat ears", "rabbit ears", "horse ears", "fox ears", "wolf ears", "dog ears", "animal ear fluff", "cat tail", "fox tail", "horse tail", "demon tail", "rabbit tail", "multiple tails", "feathered wings", "bat wings", "fairy wings", "head wings", "dragon horns", "claws", "mechanical arms",
        ]),
        ("job_classic", "職業・古風奇幻", [
            "knight", "samurai", "ninja", "oiran", "onmyouji", "viking", "gladiator", "witch",
            "wizard", "monk", "priest", "priestess", "blacksmith", "princess", "queen",
            "butler", "barmaid", "cowgirl (western)",
        ]),
        ("job_modern", "職業・現代", [
            "office lady", "salaryman", "teacher", "nurse", "doctor", "scientist",
            "policewoman", "police", "soldier", "military", "firefighter", "pilot",
            "flight attendant", "astronaut", "lifeguard", "coach", "chef", "waitress",
            "barista", "bartender", "cashier", "farmer", "construction worker", "mechanic",
            "janitor", "idol", "model", "dancer", "ballerina", "race queen", "stripper",
            "dominatrix", "detective", ]),
        ("persona", "人設", [
            "bride", "gyaru", "yandere", "tomboy", "otaku", "androgynous", "trap", "genderswap",
            "faceless male", "ugly bastard", "delinquent",
        ]),
        ("relation", "關係", [
            "couple", "husband and wife", "family", "siblings", "sisters", "brothers", "twins",
            "mother and daughter", "mother and son", "father and daughter", "yaoi",
            "age difference", "height difference", "size difference", "group picture",
        ]),
    ],
    "pose": [
        ("body", "身體姿勢", None),
        ("cam_frame", "鏡頭・取景", [
            "portrait", "close-up", "upper body", "cowboy shot", "lower body", "full body",
            "wide shot", "very wide shot", "head out of frame", "feet out of frame",
        ]),
        ("cam_angle", "鏡頭・角度", [
            "straight-on", "from above", "from below", "from side", "from behind", "profile",
            "facing away", "over shoulder", "from outside", "bird's eye view",
            "worm's eye view", "dutch angle", "upside-down", "sideways", "pov", "pov hands",
            "pov crotch",
        ]),
        ("cam_fx", "鏡頭・畫面處理", [
            "fisheye", "foreshortening", "perspective", "vanishing point", "isometric",
            "symmetry", "blurry foreground", "letterboxed", "multiple views", "split screen",
        ]),
        ("gaze", "視線", None),
        ("face_mood", "表情・情緒", [
            "smile", "light smile", "grin", "happy", "laughing", "smug", "smirk", "confident",
            "evil smile", "crazy smile", "forced smile", "nervous smile", "embarrassed", "shy",
            "flustered", "nervous", "surprised", "scared", "sad", "crying", "sobbing",
            "crying with eyes open", "tearing up", "angry", "annoyed", "frown", "pout",
            "serious", "expressionless", "bored", "sleepy", "yawning", "exhausted", "dazed",
            "drunk",
            "shaded face",
        ]),
        ("face_eyes", "表情・眼神", [
            "half-closed eyes", "one eye closed", "wide-eyed", "sparkling eyes", "empty eyes",
            "crazy eyes", "jitome", "rolling eyes", "raised eyebrow", "furrowed brow",
        ]),
        ("face_mouth", "表情・嘴", [
            "closed mouth", "open mouth", "parted lips", "tongue out", "licking lips",
            "biting own lip", "clenched teeth", "drooling",
            "upper teeth only", "wavy mouth",
        ]),
        ("face_lewd", "表情・情色", [
            "come hither", "seductive smile", "naughty face", "aroused", "heavy breathing",
            "moaning", "orgasm", "ahegao", "torogao", "fucked silly", "penis awe", "rape face",
        ]),
        ("pose_stance", "動作・姿態", [
            "contrapposto", "standing on one leg", "ojou-sama pose", "head tilt", "arched back",
            "leaning forward", "leaning back", "leaning to the side", "leaning on object",
            "against wall", "against glass", "against window", "crossed legs", "knees up",
            "leg up", "legs up", "hugging own legs", "arm support", "facing viewer",
            "balancing", "spinning", "bouncing", "trembling", ]),
        ("pose_hand", "動作・手的位置", [
            "arms at sides", "arms behind back", "arms behind head", "arms up", "arm up",
            "crossed arms", "hand on own hip", "hands on own hips", "w arms", "v arms",
            "hand on own chest", "hands on own breasts", "breast hold", "paizuri gesture", "hand on own cheek",
            "hand on own chin", "hand on own face", "hand on own neck", "hand in own hair",
            "hand on own thigh", "hands on own thighs", "hand on own knee", "hand in pocket",
            "hands in pockets", "holding own wrist", "own hands together", "covering own mouth",
            "covering own eyes", "finger to mouth", "cheek squash",
            "hand up", "hands up", "outstretched arms", "arm behind head",
        ]),
        ("pose_sign", "動作・比手勢", [
            "shushing", "v", "double v",
            "heart hands", "finger heart", "index fingers together", "thumbs up", "ok sign",
            "finger gun", "paw pose", "salute", "index finger raised", "pointing",
            "pointing at viewer", "reaching", "reaching towards viewer", "outstretched hand",
            "beckoning", "waving", "blowing kiss", "between fingers",
            "clenched hand",
        ]),
        ("pose_two", "動作・兩人互動", [
            "hug", "hug from behind", "cuddling", "clinging", "kiss", "holding hands",
            "interlocked fingers", "arms around neck", "hand on another's head",
            "hand on another's shoulder", "hand on another's face", "hand on another's cheek",
            "kabedon", "sitting on lap", "sitting between legs", "lap pillow", "princess carry",
            "piggyback", "shoulder carry", "back-to-back", "sandwiched", "feeding",
            "washing back",
            "lifting person", "kissing neck",
        ]),
        ("pose_act", "動作・小動作", [
            "adjusting hair", "tying hair", "adjusting clothes", "adjusting eyewear",
            "adjusting gloves", "clothes tug", "clothes grab", "lifting own clothes",
            "washing hair", "after bathing", "splashing", "pillow hug", "head on pillow",
            "face in pillow", "smelling", "licking", "punching", "struggling", "between legs",
            ]),
        ("pose_hold", "動作・手持物", [
            "holding weapon", "holding sword", "holding knife", "holding gun", "holding staff",
            "dual wielding", "aiming",
            "mouth hold",
            "holding cup", "holding phone", "holding umbrella", "holding fan",
        ]),
        ("pose_situ", "曖昧情境", [
            "breast focus", "spread cleavage", "wardrobe malfunction", "accidental exposure",
            "groping", "voyeurism", "breastfeeding", "netorare", "cheating (relationship)",
        ]),
        ("flash_lift", "走光・掀拉脫", [
            "skirt lift", "dress lift", "kimono lift", "clothes lift", "shirt lift",
            "sweater lift", "sports bra lift", "clothes pull", "shirt pull", "sweater pull",
            "dress pull", "one-piece swimsuit pull", "pants pull", "panty pull", "bra pull",
            "strap slip", "clothing aside", "swimsuit aside", "bikini bottom aside",
            "leotard aside", "wedgie", "undressing", "undressing another", "hand under clothes",
            "wind lift",
        ]),
        ("flash_expose", "走光・露出", [
            "upskirt", "downblouse", "one breast out", "nipple slip", "areola slip", "cameltoe",
            "ass visible through thighs", "bulge", "erection under clothes", "flashing",
            "exhibitionism", "public nudity", "caught", "hidden camera",
            "clothed female nude male", "clothed male nude female",
            "pantyshot",
        ]),
        ("flash_pose", "走光・姿勢", [
            "bent over", "presenting", "jack-o' challenge", "m legs", "spread legs", "leg lift",
            "legs over head", "straddling", "ass focus", "pussy focus",
            "between breasts", "between thighs", "hand on own ass", "hand on own crotch",
            "covering breasts", "covering crotch", "covering privates", ]),
        ("sex_pos", "性愛・體位與情境", [
            "sex", "vaginal", "anal", "missionary", "mating press", "piledriver (sex)", "folded",
            "leg lock", "boy on top", "girl on top", "cowgirl position",
            "reverse cowgirl position", "squatting cowgirl position", "amazon position",
            "upright straddle", "reverse upright straddle", "doggystyle", "standing doggystyle",
            "prone bone", "sex from behind", "spooning", "standing sex", "full nelson",
            "suspended congress", "reverse suspended congress", "mounting",
            "guided penetration", "imminent penetration", "deep penetration", "stomach bulge",
            "clothed sex", "penetration through clothes", "happy sex", "rough sex",
            "stealth sex", "implied sex", "public indecency", "underwater sex",
        ]),
        ("sex_oral", "性愛・口手足與磨擦", [
            "french kiss", "fellatio", "imminent fellatio", "licking penis", "deepthroat",
            "irrumatio", "reverse fellatio", "throat bulge", "testicle sucking", "penis on face", "penis over eyes", "oral",
            "cunnilingus", "anilingus", "sitting on face", "69", "breast sucking",
            "licking nipple", "licking ear", "head between breasts", "breast smother",
            "handjob", "two-handed handjob", "double handjob", "cooperative handjob",
            "nursing handjob", "footjob", "paizuri", "paizuri under clothes",
            "perpendicular paizuri", "straddling paizuri", "naizuri", "thigh sex", "buttjob",
            "hairjob", "armpit sex", "kneepit sex", "frottage", "grinding", "tribadism",
        ]),
        ("sex_touch", "性愛・自慰愛撫", [
            "masturbation", "female masturbation", "male masturbation",
            "masturbation through clothes", "mutual masturbation", "hand in panties",
            "fingering", "anal fingering", "spread pussy", "spread ass", "spread anus",
            "pussy peek", "nipple tweak", "nipple pull", "ass grab", "crotch grab",
            "testicle grab", "grabbing from behind", "hickey", "chikan", "molestation",
            "sleep molestation", "holding sex toy", "dildo riding",
        ]),
        ("sex_group", "性愛・多人", [
            "threesome", "mmf threesome", "ffm threesome", "foursome", "fivesome",
            "group sex", "orgy", "gangbang", "spitroast", "reverse spitroast",
            "double penetration", "triple penetration", "double vaginal", "double anal",
            "surrounded by penises", "public use", "netorase",
        ]),
        ("sex_cum", "性愛・射精", [
            "cum", "ejaculation", "projectile cum", "handsfree ejaculation", "facial",
            "bukkake", "cum in mouth", "cum on tongue", "gokkun", "cum in pussy",
            "internal cumshot", "cum in ass", "cum overflow", "cumdrip", "cumdrip from penis",
            "excessive cum", "cum pool", "cum string", "cum bubble", "cum on body",
            "cum on breasts", "cum on stomach", "cum on legs", "cum on feet", "cum on hands",
            "cum on hair", "cum on penis", "cum on pussy", "cum on clothes",
            "cum through clothes", "cum in nose", "cum in container", "cumdump",
        ]),
        ("sex_after", "性愛・體液事後", [
            "precum", "precum drip", "precum string", "pussy juice", "pussy juice trail",
            "pussy juice puddle", "excessive pussy juice", "female ejaculation",
            "lactation through clothes", "impregnation", "after sex", "after vaginal",
            "after anal", "after fellatio", "after paizuri", "after ejaculation", "afterglow",
        ]),
        ("sex_bdsm", "性愛・拘束支配", [
            "bondage", "bdsm", "restrained", "bound ankles", "frogtie", "hogtie",
            "tape bondage", "suspension", "crucifixion", "crotch rope", "butt plug",
            "anal beads", "leash pull", "pet play", "slave", "femdom", "pegging",
            "prostate milking", "humiliation", "objectification", "human furniture",
            "forniphilia", "spanking", "slapping", "slap mark", "whipping", "wax play",
            "electrostimulation", "orgasm denial", "foot worship", "trampling", "crotch kick",
            "stomach punch", "head grab", "grabbing another's hair", "holding another's wrist",
            "neck grab", "strangling", "headlock", "rear naked choke", "asphyxiation",
            "rape", "after rape", "prostitution",
        ]),
        ("sex_inside", "性愛・內部視圖", [
            "x-ray", "cross-section", "stomach (organ)", "ovum", "sperm cell", "fertilization",
        ]),
        ("sex_alien", "性愛・觸手異種", [
            "tentacles", "tentacle sex", "interspecies", "bestiality", "knotting",
            "parasite", "egg laying", "egg implantation", ]),
        ("sex_insert", "性愛・插入擴張", [
            "object insertion", "vaginal object insertion", "large insertion",
            "penis size difference", "sex machine", "fisting", "anal fisting",
            "urethral insertion", "urethral fingering", "nipple penetration",
            "navel penetration", "cervical penetration", "gaping", "prolapse",
            "anal prolapse", "inflation", "cum inflation", "enema",
        ]),
        ("sex_fetish", "性愛・特殊癖好", [
            "mind control", "hypnosis", "corruption", "transformation", "petrification",
            "encasement", "food on body", "whipped cream", "chocolate on body",
            "cum on food", "nyotaimori", "peeing", "scat", "vore", "unbirthing", "digestion",
            "guro", "necrophilia",
            "sex doll",
        ]),
        ("act_daily", "活動・日常", [
            "eating", "drinking", "cooking", "cleaning", "shopping", "reading", "studying",
            "writing", "talking on phone", "selfie", "mirror selfie", "taking picture",
            "smoking", "carrying", "driving", "praying", "hiding",
            "recording",
        ]),
        ("act_fun", "活動・娛樂表演", [
            "singing", "karaoke", "playing instrument", "playing guitar", "drawing (action)",
            "painting (action)", "playing games", "playing video games", "livestream",
            "pole dancing", "lion dance", "goldfish scooping", "picnic", "camping", "fishing",
            "flying",
        ]),
        ("act_sport", "活動・運動", [
            "playing sports", "exercising", "training", "stretching", "yoga", "jogging",
            "hiking", "weightlifting", "track and field", "tennis", "badminton",
            "table tennis", "soccer", "golf", "archery", "boxing", "skiing",
            "horseback riding", "riding bicycle",
            "fighting",
        ]),
        ("act_water", "活動・玩水洗浴", [
            "bathing", "showering", "shared bathing", "swimming", "wading", "floating",
            "diving", "sunbathing",
            "partially submerged", "mixed-sex bathing",
        ]),
    ],
    "clothing": [
        ("nude", "裸身", ["topless female", "topless male", "bottomless", "bare shoulders", "bare arms"]),
        ("era_jp", "時代・和風", [
            "japanese clothes", "kimono", "white kimono", "blue kimono", "purple kimono",
            "print kimono", "floral print kimono", "furisode", "open kimono", "yukata",
            "bath yukata", "uchikake", "haori", "hakama", "fundoshi", "tabi", "geta", "zouri",
            "okobo", "japanese armor",
        ]),
        ("era_cn", "時代・中華", [
            "chinese clothes", "hanfu", "ruqun", "dudou", "chinese armor", "qipao",
            "tangzhuang",
        ]),
        ("era_west", "時代・西洋古典", [
            "ancient greek clothes", "chiton", "peplos", "himation", "toga", "roman clothes",
            "loincloth", "pelvic curtain", "tunic", "armor", "plate armor", "chainmail",
            "leather armor", "cloak", "hooded cloak", "cape", "capelet", "tabard", "shawl",
            "gown", "chemise", "corset", "waistcoat", "petticoat", "hoop skirt", "tailcoat",
            "breastplate",
        ]),
        ("era_folk", "民族服裝", [
            "korean clothes", "hanbok", "vietnamese clothes", "ao dai", "german clothes",
            "dirndl", "russian clothes", "sari", "harem outfit", "flamenco dress",
            "mexican clothes", "hawaiian clothes", "native american clothes",
            "ancient egyptian clothes",
        ]),
        ("op_dress", "連身・洋裝禮服", [
            "dress", "short dress", "sundress", "sleeveless dress", "strapless dress",
            "off-shoulder dress", "backless dress", "backless outfit", "sweater dress",
            "pinafore dress", "pencil dress", "sailor dress", "white dress", "black dress",
            "red dress", "pink dress", "blue dress", "green dress", "purple dress",
            "evening gown", "cocktail dress", "wedding dress",
            "frilled dress",
        ]),
        ("op_uniform", "連身・制服套裝", [
            "school uniform", "serafuku", "gakuran", "gym uniform", "track uniform",
            "sportswear", "basketball uniform", "soccer uniform", "baseball uniform",
            "tennis uniform", "volleyball uniform", "cheerleader", "maid", "apron", "miko",
            "nun", "police uniform", "military uniform", "suit", "business suit", "pant suit",
            "tuxedo", "hospital gown", "racing suit", "mecha pilot suit", "overalls", "jumpsuit",
            "idol clothes", "magical girl", "superhero costume", "santa costume",
        ]),
        ("op_swim", "連身・泳裝", [
            "swimsuit", "one-piece swimsuit", "school swimsuit", "competition swimsuit",
            "casual one-piece swimsuit", "blue one-piece swimsuit", "red one-piece swimsuit",
            "white one-piece swimsuit", "bikini", "string bikini", "micro bikini",
            "o-ring bikini", "sports bikini", "blue bikini", "pink bikini", "slingshot swimsuit",
            "swim briefs", "wetsuit",
            "side-tie bikini bottom",
        ]),
        ("op_body", "連身・緊身特裝", [
            "leotard", "black leotard", "highleg leotard", "thong leotard", "playboy bunny",
            "reverse bunnysuit", "bodysuit", "black bodysuit", "blue bodysuit", "red bodysuit",
            "open bodysuit", "torn bodysuit", "latex bodysuit", "catsuit", "bodystocking",
            "living clothes", "straitjacket", "bikini armor", "power armor",
        ]),
        ("op_night", "連身・睡衣情趣", [
            "pajamas", "nightgown", "negligee", "babydoll", "bathrobe", "lingerie",
            "bridal lingerie",
        ]),
        ("op_only", "只穿一件", [
            "underwear only", "naked shirt", "naked sweater", "naked apron", "naked towel",
            "naked coat", "naked jacket", "bikini top only",
        ]),
        ("top_shirt", "上衣・襯衫T恤", [
            "shirt", "blouse", "collared shirt", "dress shirt", "sleeveless shirt", "t-shirt",
            "white shirt", "black shirt", "red shirt", "pink shirt", "blue shirt",
            "aqua shirt", "green shirt", "open shirt", "unbuttoned shirt", "shirt tucked in",
            "oversized shirt", "wet shirt", "see-through shirt", "torn shirt", "sailor shirt",
            "gym shirt", "jersey", "rash guard", "hoodie",
        ]),
        ("top_knit", "上衣・毛衣", [
            "sweater", "white sweater", "red sweater", "blue sweater", "green sweater",
            "ribbed sweater", "turtleneck", "turtleneck sweater", "off-shoulder sweater",
            "virgin killer sweater", "sweater vest",
        ]),
        ("top_tank", "上衣・背心與上身", [
            "tank top", "white tank top", "black tank top", "red tank top", "camisole",
            "crop top", "tube top", "off shoulder", "cleavage cutout", "vest", "underbust",
            "sarashi", ]),
        ("bot_skirt", "下身・裙", [
            "skirt", "miniskirt", "microskirt", "pleated skirt", "plaid skirt", "pencil skirt",
            "long skirt", "high-waist skirt", "suspender skirt", "hakama skirt", "torn skirt",
            "black skirt", "white skirt", "blue skirt", "brown skirt",
            "frilled skirt",
        ]),
        ("bot_pants", "下身・褲", [
            "pants", "jeans", "suit pants", "sweatpants", "yoga pants", "high-waist pants",
            "black pants", "blue pants", "brown pants", "shorts", "short shorts",
            "micro shorts", "denim shorts", "dolphin shorts", "bike shorts", "boxing shorts",
            "black shorts", "blue shorts", "buruma", ]),
        ("uw_top", "內衣・胸罩", [
            "bra", "no bra", "white bra", "black bra", "pink bra", "blue bra", "lace bra",
            "strapless bra", "bustier", "sports bra", "black sports bra", "blue sports bra",
            "pink sports bra", "bra visible through clothes",
        ]),
        ("uw_bottom", "內衣・內褲", [
            "panties", "no panties", "white panties", "black panties", "red panties",
            "blue panties", "striped panties", "lace-trimmed panties", "side-tie panties",
            "highleg panties", "string panties", "thong", "g-string", "crotchless panties",
            "crotchless", "panties aside", "panties around one leg", "boxers", "briefs",
            "male underwear", "chastity belt", "maebari", "heart maebari",
        ]),
        ("legs", "腿襪", ["loose socks"]),
        ("feet", "鞋履", ["armored boots"]),
        ("outer", "外套", None),
        ("fab_sleeve", "衣料・袖子領口", [
            "long sleeves", "short sleeves", "wide sleeves", "puffy sleeves",
            "detached sleeves", "sleeves rolled up", "sailor collar", "mandarin collar",
            "halterneck", "side slit",
            "sleeveless", "puffy short sleeves", "puffy long sleeves", "sleeves past wrists", "juliet sleeves", "frilled sleeves", "layered sleeves", "high collar",
        ]),
        ("fab_material", "衣料・材質花紋", [
            "see-through clothes", "latex", "leather", "denim", "satin", "shiny clothes",
            "fishnets", "fur trim", "frills", "polka dot",
            "animal print", "cow print",
            "striped clothes", "plaid clothes", "floral print", "ribbon trim", "lace trim", "fur collar",
        ]),
        ("fab_state", "衣料・穿著狀態", [
            "tight clothes", "skin tight", "oversized clothes", "revealing clothes",
            "open clothes", "unzipped", "clothes between breasts", "layered clothes",
            "swimsuit under clothes", "wet clothes", "torn clothes", "blood on clothes",
            "costume switch", "reverse outfit",
            "clothing cutout", "strapless", "highleg",
        ]),
        ("fab_style", "衣料・穿搭風格", [
            "casual", "cosplay", "lolita fashion", "gothic lolita", "halloween costume",
            "animal costume",
            "formal clothes",
        ]),
        ("fab_detail", "衣料・圍裙扣件", [
            "maid apron", "waist apron", "frilled apron", "suspenders", "buttons", "zipper",
            "zipper pull tab", "pocket", "breast pocket",
        ]),
        ("acc_head", "飾品・帽子頭飾", [
            "hat", "top hat", "sun hat", "witch hat", "cowboy hat", "sombrero", "beret",
            "baseball cap", "police hat", "nurse cap", "chef hat", "hard hat", "helmet",
            "bicycle helmet", "swim cap", "bonnet", "hood", "turban", "hijab", "veil",
            "crown", "tiara", "circlet", "kokoshnik", "laurel crown", "halo",
            "maid headdress", "fake animal ears", "hair ornament", "hair ribbon", "hairband",
            "hairclip", "hairpin", "hair stick", "kanzashi",
            "hood down", "hair bow", "headband", "scrunchie", "hair bobbles", "star hair ornament", "feather hair ornament", "hair bell", "santa hat",
        ]),
        ("acc_bow", "飾品・蝴蝶結緞帶", [
            "bow", "ribbon", "hat bow", "hat ribbon", "tassel",
        ]),
        ("acc_face", "飾品・眼鏡面具耳機", [
            "glasses", "coke-bottle glasses", "sunglasses", "goggles", "eyewear on head",
            "eyepatch", "medical eyepatch", "mask", "masquerade mask", "headphones",
            "headphones around neck", "earbuds",
            "mask on head", "fox mask",
        ]),
        ("acc_neck", "飾品・領帶頸飾", [
            "necktie", "black necktie", "blue necktie", "bowtie", "black bowtie", "ascot",
            "neck ribbon", "detached collar", "scarf", "choker", "collar", "black collar",
            "red collar", "animal collar",
            "neckerchief", "frilled collar",
        ]),
        ("acc_jewel", "飾品・首飾穿環", [
            "jewelry", "necklace", "bead necklace", "cross necklace", "tooth necklace",
            "flower necklace", "pendant", "gold chain", "prayer beads", "lei", "gem", "brooch",
            "earrings", "stud earrings", "hoop earrings", "tassel earrings", "ring",
            "wedding ring", "bracelet", "wrist cuffs", "watch", "anklet", "belly chain",
            "piercing", "ear piercing", "nose ring", "tongue piercing", "navel piercing",
            "chinese knot", "celtic knot",
        ]),
        ("acc_hand", "飾品・手套腰帶護具", [
            "gloves", "black gloves", "elbow gloves", "fingerless gloves", "latex gloves",
            "boxing gloves", "belt", "black belt", "brown belt", "belt buckle", "buckle",
            "obi", "sash", "o-ring", "armband", "shoulder armor", "knee pads",
            "wristband", "gauntlets", "pauldrons",
        ]),
        ("acc_carry", "飾品・隨身物品", [
            "bag", "handbag", "shoulder bag", "backpack", "pouch", "suitcase", "umbrella",
            "parasol", "oil-paper umbrella", "towel", "name tag", "clipboard", "stethoscope",
            "microphone", ]),
        ("acc_bandage", "飾品・繃帶OK繃", [
            "bandages", "bandaged arm", "bandaged leg", "bandaged head",
            "bandage over one eye", "bandaid", "bandaid on face", "bandaid on cheek",
            "bandaid on nose", "bandaid on knee", "bandaid on pussy",
            "needle",
        ]),
        ("acc_toy", "飾品・情趣用品", [
            "sex toy", "vibrator", "egg vibrator", "remote control vibrator",
            "public vibrator", "vibrator cord", "vibrator in thighhighs", "vibrator on nipple",
            "dildo", "strap-on", "condom", "multiple condoms", "used condom",
            "holding condom", "condom in mouth", "condom wrapper", "condom box", "pasties",
            "cross pasties", "nipple tassels", "nipple clamps", "nipple rings", "nipple bar",
            "breast pump", "milking machine", "speculum", ]),
        ("acc_bind", "飾品・拘束具", [
            "blindfold", "gag", "ball gag", "bit gag", "ring gag", "tape gag", "nose hook",
            "leash", "chain leash", "handcuffs", "cuffs", "shackles", "restraints",
            "bound wrists", "rope", "shibari", "spreader bar", "pillory", "stocks",
        ]),
    ],
    "env": [
        ("inout", "室內外", None),
        ("pl_home", "地點・住家", [
            "bedroom", "bed", "canopy bed", "futon", "living room", "kitchen",
            "dining room", "bathroom", "bathtub", "shower (place)", "closet", "messy room",
            "otaku room", "washitsu", "genkan", "apartment", "balcony", "porch", "rooftop",
            "garage", "window", "couch",
        ]),
        ("pl_bath", "地點・浴場泳池", [
            "onsen", "bath", "bathhouse", "ofuro", "bubble bath", "sauna", "pool",
            "poolside", "pool ladder", "empty pool", "water slide",
        ]),
        ("pl_school", "地點・學校職場", [
            "school", "classroom", "clubroom", "library", "infirmary", "cafeteria",
            "school gym", "locker room", "changing room", "office", "laboratory",
            ]),
        ("pl_passage", "地點・通道廠房", [
            "hallway", "elevator", "warehouse", "factory", "construction site",
        ]),
        ("pl_shop", "地點・店家餐飲", [
            "cafe", "maid cafe", "restaurant", "izakaya", "bar (place)", "tavern",
            "conveyor belt sushi", "yatai", "market", "market stall", "convenience store",
            "supermarket", "shop", "bakery", "clothes shop", "fitting room", "flower shop",
            "bookstore", "laundromat", ]),
        ("pl_fun", "地點・娛樂住宿", [
            "hotel room", "love hotel", "ryokan", "karaoke box", "internet cafe", "arcade",
            "casino", "nightclub", "ballroom", "movie theater", "theater", "stage",
            "backstage", "dressing room", "concert", "museum", "planetarium", "aquarium", "zoo",
            "amusement park", "ferris wheel", "carousel", "roller coaster", "skating rink",
            "festival",
        ]),
        ("pl_sport", "地點・運動場", [
            "fitness gym", "dojo", "stadium", "sports court", "basketball court",
            "tennis court", "soccer field", "baseball stadium", "golf course", "running track",
            "boxing ring", "bowling alley", ]),
        ("pl_public", "地點・公共設施", [
            "hospital", "clinic", "prison", "prison cell", "dungeon",
            "public restroom", "toilet stall", "glory hole", "sewer", "parking lot",
            "airport", "train station", "train station platform", "subway station",
            "bus stop",
        ]),
        ("pl_ride", "地點・交通工具", [
            "car", "car interior", "taxi", "bus", "bus interior", "train", "train interior",
            "subway", "streetcar", "steam locomotive", "vehicle interior", "airplane interior",
            "cockpit", "airship", "boat", "rowboat", "ship", "pirate ship", "submarine",
            "carriage", "spacecraft", "spacecraft interior", "gondola",
            "rickshaw", "bicycle",
        ]),
        ("pl_street", "地點・街道城市", [
            "street", "alley", "city", "cityscape", "skyline", "skyscraper", "park",
            "park bench", "fountain", "gazebo", "bridge", "pedestrian bridge", "highway",
            "tunnel", "railroad tracks", "railroad crossing", "industrial", "clock tower", "gas station", "playground",
        ]),
        ("pl_water", "地點・海邊水邊", [
            "beach", "shore", "ocean", "island", "coral reef", "underwater", "seafloor",
            "shipwreck", "river", "riverbank", "stream", "lake", "pond", "waterfall",
            "wetland",
            "canal", "pier", "harbor", "dock", "lighthouse",
        ]),
        ("pl_nature", "地點・山野田園", [
            "forest", "bamboo forest", "jungle", "mountain", "hill", "cliff",
            "valley", "canyon", "cave", "cave interior", "volcano", "lava", "glacier",
            "desert", "sand dune", "oasis", "savannah", "meadow", "field", "flower field",
            "sunflower field", "wheat field", "rice paddy", "farm", "barn", "greenhouse",
            "garden", "courtyard", "treehouse", "tent", "igloo",
            "village", "rural",
        ]),
        ("pl_history", "地點・古蹟宗教", [
            "shrine", "torii", "temple", "pagoda", "east asian architecture", "pavilion",
            "palace", "castle", "throne", "throne room", "mansion", "gothic architecture",
            "colonnade", "colosseum", "ruins", "altar", "graveyard", "battlefield",
            "church", "cathedral",
        ]),
        ("pl_landmark", "地點・名勝奇幻", [
            "tokyo", "shibuya (tokyo)", "kyoto (city)", "mount fuji", "tokyo tower",
            "tokyo skytree", "new york city", "statue of liberty", "elizabeth tower",
            "eiffel tower", "taipei 101", "pyramid (structure)", "sphinx", "space", "space station", "planet",
            "earth (planet)", "asteroid", "floating island", "floating city",
            "underwater city", "heaven", "hell", "tentacle pit",
        ]),
        ("background", "背景", None),
        ("furniture", "坐臥面", None),
        ("time", "晝夜", None),
        ("weather", "天氣", ["wind", "smoke", "dust"]),
        ("sky", "天空", ["full moon"]),
        ("light", "光線", ["campfire"]),
        ("fx_comic", "特效・漫畫符號", [
            "heart", "spoken heart", "anger vein", "motion lines", "speed lines",
            "emphasis lines", "afterimage", "time stop", "glitch",
            "star (symbol)",
        ]),
        ("fx_glow", "特效・光", [
            "glowing", "aura", "light particles", "sparkle", "sparks", "embers", "blue fire",
            "electricity", "lightning", "magic circle", "fireworks", "sparkler", "glowstick",
            "shooting star", "rainbow", "caustics", ]),
        ("fx_fall", "特效・飄落", [
            "water drop", "dripping", "ripples", "bubble", "soap bubbles", "snowflakes", "petals", "falling petals", "falling leaves", "confetti", "floating clothes",
        ]),
        ("fx_lens", "特效・鏡頭", [
            "depth of field", "bokeh", "lens flare", "bloom", "diffraction spikes",
            "motion blur", "chromatic aberration", "film grain",
        ]),
        ("obj_build", "景物・建築地面", [
            "architecture", "building", "european architecture", "greco-roman architecture",
            "tower", "windmill", "arch", "pillar", "stone wall", "brick wall",
            "stained glass", "iron bars", "railing", "fence", "chain-link fence", "hedge",
            "stairs", "stone stairs", "spiral staircase", "escalator", "floor",
            "wooden floor", "stone floor", "tiles", "tatami", "shouji", "fusuma", "noren",
            "veranda",
            "chain",
        ]),
        ("obj_street", "景物・街景", [
            "town", "urban", "road", "dirt road", "path", "sidewalk", "crosswalk",
            "power lines", "utility pole", "billboard", "graffiti", "bulletin board",
            "vending machine", "phone booth", "abandoned", "rubble",
            "shopping cart",
        ]),
        ("obj_furn", "景物・家具寢具", [
            "table", "desk", "counter", "chair", "office chair", "swivel chair",
            "gaming chair", "bench", "wooden bench", "nightstand", "bookshelf", "locker",
            "kotatsu", "poker table", "pillow", "blanket", "bed sheet", "carpet", "curtains", "mirror",
            "full-length mirror", "clock", "sink", "shower head", "tissue box", "whiteboard",
        ]),
        ("obj_classic", "景物・古風擺設", [
            "folding screen", "stone lantern", "paper lantern", "rock garden", "incense",
            "incense burner", "scroll", "calligraphy", "ofuda", "komainu", "jizou",
            "teapot", "teacup", "tea set", "silk", "beads", "amphora", "birdcage",
            "crystal ball", "pocket watch", "cane", "statue", "lace",
        ]),
        ("obj_plant", "景物・植物動物", [
            "tree", "pine tree", "willow", "palm tree", "bamboo", "bush", "grass", "moss",
            "overgrown", "rose", "lotus", "chrysanthemum", "sunflower", "koi", "horse",
            "cherry blossoms", "autumn leaves", "maple leaf", "plum blossoms",
            "flower", "leaf", "feathers",
        ]),
        ("obj_land", "景物・地景水土", [
            "scenery", "landscape", "horizon", "mountainous horizon", "rock", "stalactite",
            "sand", "water", "puddle", "reflection", "condensation", "slime (substance)",
        ]),
        ("obj_food", "物品・飲食", [
            "cup", "mug", "bottle", "wine glass", "coffee", "bubble tea", "beer",
            "wine", "sake", "champagne", "rice bowl", "chopsticks", "onigiri", "sushi",
            "ramen", "curry", "pasta", "pizza", "taco", "bread", "mooncake", "cake",
            "cookie", "donut", "chocolate", "candy", "lollipop", "ice cream", "popsicle",
            "strawberry", "apple", "grapes", "olive",
        ]),
        ("obj_hand", "物品・手持小物", [
            "book", "newspaper", "pen", "pencil", "quill", "calligraphy brush", "paintbrush",
            "phone", "cellphone", "smartphone", "selfie stick", "camera", "cigarette",
            "cigar", "smoking pipe", "kiseru", "folding fan", "hand fan", "uchiwa",
            "shopping bag", "basket", "broom", "mop", "bucket", "ladle",
            "frying pan", "scissors", "key", "bell", "playing card", "balloon",
            "stuffed toy", "teddy bear",
        ]),
        ("obj_tech", "物品・電器機台", [
            "computer", "laptop", "monitor", "game controller", "arcade cabinet",
            "crane game", "purikura", "steering wheel", "microphone stand", ]),
        ("obj_music", "物品・樂器", ["guitar", "piano", "violin", "drum", "lyre", "guqin", "erhu"]),
        ("obj_weapon", "物品・武器", [
            "sword", "katana", "knife", "spear", "polearm", "trident", "staff", "shield",
            "gun", "handgun", "rifle", "arrow (projectile)",
            "bow (weapon)",
        ]),
        ("obj_sport", "物品・運動海灘", [
            "basketball (object)", "soccer ball", "volleyball (object)", "baseball (object)",
            "tennis ball", "golf ball", "bowling ball", "table tennis ball", "shuttlecock",
            "baseball bat", "baseball mitt", "tennis racket", "badminton racket",
            "table tennis paddle", "golf club", "dumbbell", "skateboard",
            "surfboard", "innertube", "beach umbrella", "beach towel", "fishing rod",
        ]),
        ("obj_flag", "物品・旗幟", [
            "banner", "japanese flag", "american flag", "french flag", "german flag",
            "russian flag", "mexican flag", "brazilian flag",
        ]),
        ("obj_fest", "節慶", [
            "christmas", "christmas tree", "new year", "chinese new year", "lantern festival", "mid-autumn festival", "summer festival", "halloween", "easter", "oktoberfest", "wedding",
        ]),
        ("obj_theme", "題材", [
            "winter", "tropical", "fantasy", "magic", "medieval", "victorian", "tribal",
            "science fiction", "post-apocalypse", "surreal",
            "mecha",
            "summer",
        ]),
    ],
}


SUB_ORDER = {sec: [sid for sid, _, _ in rows] for sec, rows in SUBS.items()}
SUB_ZH = {sid: zh for rows in SUBS.values() for sid, zh, _ in rows}

_EXPLICIT = {}
for _sec, _rows in SUBS.items():
    for _sid, _zh, _tags in _rows:
        for _t in _tags or ():
            if (_sec, _t) in _EXPLICIT:
                raise ValueError(f"subgroups.py：{_sec}/{_t} 同時在 {_EXPLICIT[(_sec, _t)]} 和 {_sid}")
            _EXPLICIT[(_sec, _t)] = _sid


def assign_sub(item: dict) -> str | None:
    """這個字放在哪個細分類。拆開的小分類裡沒被收走的字回 None（merge 會報錯）。"""
    sec, tag, grp = item.get("section"), item.get("tag"), item.get("group")
    hit = _EXPLICIT.get((sec, tag))
    if hit:
        return hit
    if (sec, grp) in SPLIT:
        return None
    return grp


def check_subs(items: list[dict]) -> list[str]:
    """回傳問題清單：沒有位置的字、清單裡寫了但詞庫沒有的字、空的細分類、撞名。"""
    problems = []
    groups_by_sec = {}
    for it in items:
        groups_by_sec.setdefault(it["section"], set()).add(it["group"])
    for sec, rows in SUBS.items():
        for sid, _, tags in rows:
            if tags is None and (sec, sid) in SPLIT:
                problems.append(f"{sec}/{sid}：拆開的小分類不能原樣保留")
            if sid in groups_by_sec.get(sec, set()) and (sec, sid) in SPLIT:
                problems.append(f"{sec}/{sid}：拆開的小分類不能沿用原本的 id")
    have = {(it["section"], it["tag"]) for it in items}
    for (sec, tag), sid in _EXPLICIT.items():
        if (sec, tag) not in have:
            problems.append(f"{sec}/{sid}：詞庫裡沒有 {tag!r}")
    used = {}
    for it in items:
        sub = assign_sub(it)
        if sub is None:
            problems.append(f"{it['section']}/{it['group']}：{it['tag']!r} 沒有細分類，請在 scripts/subgroups.py 的 SUBS 裡放進一格")
            continue
        if sub not in SUB_ORDER.get(it["section"], []):
            problems.append(f"{it['section']}/{sub}：不在 SUBS 的順序裡（{it['tag']!r}）")
        used.setdefault(it["section"], set()).add(sub)
    for sec, order in SUB_ORDER.items():
        for sid in order:
            if sid not in used.get(sec, set()) and sid != "fixed":
                problems.append(f"{sec}/{sid}：沒有任何字")
    return problems
