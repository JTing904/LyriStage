# 3D 公仔模型

App 用的模型在 [src/renderer/public/models/](../../src/renderer/public/models/)，每个约 3MB。
原始模型（200 万面、70MB 左右）在自己电脑的"图片"文件夹，**不放进 git**。

## 压缩一个新模型

用带贴图的 `base_basic_pbr.glb`（没有贴图的灰模不要用）：

```sh
# 1. 贴图缩到 1024、转成 WebP（gltf-transform 自带的 webp 在 Windows 上会报 colourspace 错，所以用 Pillow）
python scripts/models/glb_webp.py 原始.glb tmp.glb 1024

# 2. 减面（误差上限 0.2%）+ meshopt 压缩
npx @gltf-transform/cli@4.1.1 optimize tmp.glb src/renderer/public/models/新名字.glb \
  --compress meshopt --texture-compress false --simplify-ratio 0.04 --simplify-error 0.002
```

然后在 [src/renderer/src/stores/avatar.js](../../src/renderer/src/stores/avatar.js) 的 `OUTFITS` 加一项。

底座上的名片（IG 帐号）是程序画的，不在模型里：会自动量底座和脚的位置再摆上去，
帐号在 `avatar.js` 的 `NAME_CARD_HANDLE`。
