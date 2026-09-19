# WAI 品質前綴設計

## 目標

正面提示詞以 WAI 建議的品質控制詞開頭。預設品質詞（`masterpiece`、
`best quality`、`amazing quality`）固定在最前；使用者釘選的 `boost` 詞
（例如 `very aesthetic`、`newest`、`absurdres`）緊接其後。

## 順序

`quality → boost → cast → feature → clothing → pose → env → rating tail → style`

視覺媒材／畫風（例如 `cel shading`、`lineart`）仍是內容描述，不混入品質前綴。
LoRA／角色 trigger 保持在 cast 後方，因此完整前段是：

`quality → boost → 1girl/1boy/solo → trigger → 其餘內容`

## 驗證

- 固定 seed 驗證三個預設品質詞佔據前三個位置。
- 釘選 `very aesthetic` 時驗證它位於 cast 前；釘選 `cel shading` 時驗證它位於 cast 後。
- 驗證前置品質詞存在時，trigger 仍插在 cast 後。
- 跑完整 `test.bat`，不調低既有門檻。
