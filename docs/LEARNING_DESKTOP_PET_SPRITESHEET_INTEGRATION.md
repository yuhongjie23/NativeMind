# 桌宠 Sprite Sheet：代码接入与资源替换说明

> 配套设计文档：`docs/LEARNING_DESKTOP_PET_SPRITESHEET_PROMPT_V1.md`。
> 本文件只讲「代码侧已实现什么」「怎么替换美术资源」「哪些资源可以自由换」。

## 一、代码侧已实现（无需美术即可工作的部分）

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Sprite 类型 | `src/ui/demo/fullscreen-cozy-home/types.ts` | `AnimationDescriptor` 扩展 sprite 字段；`PetAction` 扩展 `study_loop / needs_input / ready / move_left / move_right` |
| Manifest | `sprite-manifest.ts` | 类型 + `loadPetManifest` 加载 + `frameOffset` / `spriteFrameAt` 帧计算（纯函数，已单测） |
| 渲染器 | `components/SpriteRenderer.tsx` | 按 Manifest 帧 / fps / 逐帧时长 / 循环播放；帧变更才重渲染；reduced-motion 显示静态帧；一次性动作播完回调 |
| 接入 | `components/AnimationRenderer.tsx` | `renderer === 'sprite'` 时走 SpriteRenderer |
| 解析 | `asset-resolver.ts` | `configurePetSprite(assetBase)` 加载 Manifest；`resolveAnimation('pet', action)` 有 Manifest 返回 sprite descriptor，否则 CSS 降级 |
| 启动 | `FullscreenCozyHome.tsx` | 读取 `companion.assetBase` 并 `configurePetSprite` |

**降级链**（文档 §14.3）：

```text
Sprite Sheet + Manifest 存在且可加载
  -> 按 Manifest 播放帧
Manifest 缺失 / 图片加载失败
  -> CSS PetActor（现有小绿团）
CSS 不可用
  -> 静态占位
```

**reduced-motion**：系统开启减少动画时，显示每个动作的 `reducedMotionFrame` 静态帧，不自动循环。

## 二、如何替换美术资源（后续 AI 生成后）

### 资源位置

放到 **`companion.assetBase`**（设置 → 陪伴 → 形象资源根目录）下两个文件：

```text
<assetBase>/
  pet-manifest.json          # 动作清单（见下）
  little-sprout-sunny-v01.webp  # Sprite Sheet（或 PNG，文件名与 manifest.spritesheet 一致）
```

### Manifest 格式（对应设计文档 §7.3）

```json
{
  "schemaVersion": 1,
  "id": "little-sprout-sunny",
  "spritesheet": "little-sprout-sunny-v01.webp",
  "frame": { "width": 192, "height": 208, "columns": 8, "rows": 9 },
  "animations": {
    "idle":  { "frames": [0,1,2,3,4,5,6,7], "fps": 2.5, "loop": true, "reducedMotionFrame": 0 },
    "study_loop": { "frames": [8,9,10,11,12,13,14,15], "fps": 4, "loop": true, "reducedMotionFrame": 8 },
    "needs_input": { "frames": [16,17,18,19,20,21,22,23], "fps": 5, "loop": false, "fallback": "idle", "reducedMotionFrame": 22 },
    "ready":  { "frames": [24,25,26,27,28,29,30,31], "fps": 5, "loop": false, "fallback": "idle", "reducedMotionFrame": 29 },
    "concerned": { "frames": [32,33,34,35,36,37,38,39], "fps": 5, "loop": false, "fallback": "idle", "reducedMotionFrame": 36 },
    "greet":  { "frames": [40,41,42,43], "fps": 6, "loop": false, "fallback": "idle", "reducedMotionFrame": 42 },
    "cheer":  { "frames": [44,45,46,47], "fps": 6, "loop": false, "fallback": "idle", "reducedMotionFrame": 46 },
    "sleep_enter": { "frames": [48,49,50,51], "fps": 5, "loop": false, "fallback": "sleep_loop", "reducedMotionFrame": 51 },
    "sleep_loop": { "frames": [52,53,54,55], "fps": 1.5, "loop": true, "reducedMotionFrame": 52 },
    "wake":   { "frames": [56,57,58,59], "fps": 5, "loop": false, "fallback": "idle", "reducedMotionFrame": 59 },
    "look_at_girl": { "frames": [60,61,62,63], "fps": 4, "loop": false, "fallback": "idle", "reducedMotionFrame": 62 },
    "move_right": { "frames": [64,65,66,67], "fps": 7, "loop": true, "reducedMotionFrame": 64 },
    "move_left":  { "frames": [68,69,70,71], "fps": 7, "loop": true, "reducedMotionFrame": 68 }
  }
}
```

### 接入步骤

1. 按设计文档 §10 逐行动画生成 → 归一化到 192×208 透明格 → 脚本打包成 `1536×1872 / 8×9` Sprite Sheet。
2. 按上面的格式写 `pet-manifest.json`（可只列已生成的动作；缺的自动回退 CSS）。
3. 两个文件放进 `companion.assetBase`。
4. 重启应用（或改一下 assetBase 触发重载）。代码自动读取，无需改动业务。

> 说明：桌面端本地文件需 Tauri asset 协议加载（`convertFileSrc` 已在 `sprite-manifest.ts` 处理）；web 预览下放相对路径即可。若加载失败会静默回退 CSS，不报错。

## 三、哪些美术资源可以自由替换

**可以自由替换（纯美术，不影响代码逻辑）：**

| 资源 | 说明 |
| --- | --- |
| **Sprite Sheet**（`*.webp/png`） | 全部动作帧。换一套皮肤/角色，只要帧序号和 Manifest 对齐即可。 |
| **`pet-manifest.json`** | 动作清单（帧序号 / fps / 循环 / fallback / reduced-motion 帧）。调整动画节奏改这里。 |
| CSS 兜底形象 | `PetActor.tsx` 里的 `.pet-art`（小绿团），无 Sprite 时的降级外观。 |
| 台词 / 气泡 | `scene-manifest.ts` 的 `PET_LINES`、陪伴 agent 文案（非美术但可自由改）。 |

**不要随意改（代码契约，改了会破坏）：**

- `PetAction` 枚举 / `resolveAnimation` 映射 —— 改动作名会断状态映射。
- Sprite 网格语义：`columns×rows`、行优先索引、锚点 —— Manifest 必须与 Sprite Sheet 网格严格一致。
- 降级链 / reduced-motion 行为 —— 是产品原则，不是美术。

**替换的通用规则**：换美术只改 `assetBase` 下的 `pet-manifest.json` + Sprite Sheet 文件，不动 `src/` 代码。想换角色，只需把两个文件换成新角色的（保持同一网格契约）。
