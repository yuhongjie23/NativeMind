# GPT Image 2 科研方法图生成提示词

## 0. 使用原则

这张参考图不是普通海报，而是一个包含医学影像、算法流程、几何示意和神经网络结构的科研方法图。生成时需要把内容分成两类：

```text
真实数据层：保留已有的 DSA / X-ray 医学图像，不让模型重绘
算法解释层：用 GPT Image 2 生成更高级、更统一的科学示意图
```

真实 DSA 图像中的血管形状、导管位置、中心线标注和半径结果属于研究数据，不能让图像模型凭空生成。建议把真实医学图像先用 Python、OpenCV、Matplotlib 或医学图像工具处理，再把生成的矢量示意组件叠加上去。

GPT Image 2 更适合生成：

- 距离变换的伪彩色示意图。
- Steering history 轨迹示意。
- Boundary steering cone 几何示意。
- Dagger projection 的曲线、点和向量示意。
- 神经网络模块的高级科研信息图风格。
- 最终整图的布局草稿和视觉统一版本。

GPT Image 2 不适合直接生成：

- 新的患者血管造影图。
- 研究中实际使用的血管中心线。
- 真实半径数值和训练结果。
- 需要像素级可复现的 distance transform。
- 需要绝对准确的网络层数、维度和公式。

---

## 1. 全局母提示词

将以下内容放在每一个组件提示词和整图提示词的前面。

```text
Use case: scientific-educational and publication-quality methodology figure.

Create a premium, clean, technically precise scientific infographic for a medical image-guided navigation research paper. The visual language is modern academic visualization, combining crisp vector geometry, restrained flat illustration, subtle depth, precise alignment, and high-quality editorial figure design. The result must look suitable for a top-tier computer vision, medical imaging, robotics, or machine learning conference paper, not like a marketing poster, dashboard, game UI, or generic AI artwork.

Use a warm white or very light neutral background, generous whitespace, a strict modular grid, consistent margins, consistent stroke widths, clean arrowheads, and strong visual hierarchy. Use restrained colors with fixed semantic meaning: navy blue for process flow and network connections, teal for input and visual features, green for ground-truth or centerline geometry, coral red for radius and final vessel overlays, amber orange for traced trajectory and projection, violet and cyan for learned feature representations, and charcoal for text and mathematical marks. Use soft pale blue, pale green, pale amber, and pale coral panel backgrounds only when they improve grouping.

Use a hybrid of precise vector scientific diagrams and carefully controlled clinical-image overlays. Keep the composition calm, spacious, balanced, and legible at publication scale. Make every geometric relationship intentional. Preserve a clear left-to-right reading direction unless a panel explicitly describes another direction. Use subtle rounded corners only for module containers, with small corner radii and no excessive cards or glassmorphism.

The figure must communicate an algorithm, not decorate it. Every arrow, curve, point, color, label, and module must have a clear technical purpose. Do not invent scientific claims, numerical results, patient data, anatomy, equations, layer dimensions, or performance values. Do not alter the supplied clinical images except for the explicitly requested non-destructive processing or overlay.
```

### 全局负面提示词

```text
no marketing poster, no futuristic dashboard, no neon cyberpunk, no glossy 3D interface, no cartoon laboratory, no decorative icons, no random medical instruments, no invented anatomy, no new patient, no fabricated X-ray, no hallucinated vessel, no anatomical distortion, no inconsistent arrows, no curved arrows crossing unrelated modules, no fake metrics, no fake charts, no random equations, no incorrect layer dimensions, no invented labels, no misspelled technical terms, no watermark, no logo, no citations, no unnecessary legend, no drop shadows that reduce readability, no excessive gradients, no black background except the explicitly requested distance-transform panel, no busy texture, no excessive color variety.
```

---

## 2. 视觉规范与颜色语义

### 2.1 推荐颜色

```yaml
background: "#FAFBFC"
ink: "#17232D"
navy_flow: "#145A78"
teal_feature: "#2E9C9C"
green_gt: "#58B947"
coral_radius: "#E74A4A"
amber_trace: "#F28C3C"
violet_feature: "#7356B6"
cyan_feature: "#42AFC5"
soft_blue_panel: "#EAF5F9"
soft_green_panel: "#EDF8ED"
soft_amber_panel: "#FFF5E8"
soft_coral_panel: "#FFF0EF"
```

### 2.2 颜色必须保持的含义

- 绿色：人工标注的中心线、Ground Truth 点或真实参考几何。
- 红色：最终预测的中心线、半径带或 vessel overlay。
- 橙色：用户历史轨迹、Dagger trajectory、lookahead 轨迹。
- 蓝色：网络连接、steering history、数据流向。
- 紫色和青色：神经网络内部的 learned feature，不表示真实医学数据。
- 黑色：只用于文字、边界和明确要求的黑色 distance-transform 背景。

### 2.3 字体与文字

如果最终图用于论文，推荐在 GPT Image 2 中先生成“无文字底稿”，再使用 Figma、Illustrator、PowerPoint、SVG 或 Matplotlib 添加文字。原因是图像模型可能把 `ResNet-18`、`Softplus`、`Dagger`、希腊字母和维度数字写错。

如果必须让 GPT Image 2 直接生成文字，追加：

```text
Render only the exact labels explicitly listed in the prompt. Preserve spelling, capitalization, hyphens, Greek letters, subscripts, arrows, and dimension values exactly. Do not add any other words. Leave generous empty space around every label so that the text can be corrected later without covering the diagram.
```

---

## 3. 组件级提示词

下面每段都可以单独生成一个组件。若组件要叠加到真实 DSA 图像上，建议输出为透明或纯白背景的独立图层；若 GPT Image 2 无法输出干净透明背景，使用纯色背景生成后再抠图。

### 3.1 DSA 原图与增强图

这两个组件不建议重新生成。保留已有真实图像，使用图像处理代码得到 Raw DSA、Inverted and CLAHE 两个版本。

```text
Use the supplied clinical DSA image as the exact pixel-locked source. Create two non-destructive processing views side by side: “Raw DSA” with the original grayscale appearance, and “Inverted and CLAHE” with contrast-limited adaptive histogram equalization and intensity inversion. Preserve the vessel geometry, catheter geometry, anatomical structures, noise pattern, field of view, crop, and aspect ratio exactly. Do not redraw, beautify, denoise away, hallucinate, remove, or add any anatomical structure. Apply only the specified intensity transformation. Use a neutral scientific presentation with no decorative border and no extra annotation.
```

### 3.2 Manual annotation overlay

```text
Create a publication-quality overlay layer for a supplied grayscale DSA image. Preserve the underlying medical image exactly. Add one manually annotated vessel centerline following the visible vessel path with a thin, smooth, bright green line. The centerline must remain inside the vessel lumen, follow the actual curvature, and use a consistent 2 to 3 pixel stroke. Add no invented branch, no extra vessel, no text, no points, no arrows, and no red marking. The output should look like a careful manual annotation layer for a medical image segmentation paper, with the original grayscale image remaining dominant and the green centerline clearly visible but not oversaturated.
```

### 3.3 Distance transform visualization

```text
Create a clean scientific distance-transform visualization of a single thin curved tubular vessel mask on a pure black background. Show the vessel centerline as a narrow continuous path and encode the distance-to-boundary field with a restrained scientific colormap: dark violet and blue for small values, cyan and green for intermediate values, and yellow-orange for larger values. The color must be smooth along the width of the tube but remain visibly raster-like and analytical, not painterly. Add a slim vertical color bar on the right with a small numeric scale from low to high, using a standard perceptually ordered colormap. The vessel curve must be simple, continuous, and technically legible. Do not add anatomy, patient imagery, labels beyond the color bar, decorative glow, or fake measurements.
```

### 3.4 Radius and centerline overlay

```text
Edit the supplied grayscale DSA image without changing any underlying pixels. Overlay a single predicted vessel centerline and radius representation in coral red. Use a continuous red centerline with a subtle semi-transparent red tubular band whose width follows the local vessel radius. Keep the overlay aligned to the visible vessel and catheter path, with smooth curvature and no offset. The red line must be visually distinct from the grayscale image, while the original image remains readable underneath. Use no green line, no invented branch, no numeric radius labels, no arrows, no anatomy changes, no extra vessels, and no decorative effect.
```

### 3.5 Rotated patch

```text
Using the supplied DSA crop as the exact source, create a clean rotated image patch centered on a small vessel segment and its current tracking point. Rotate the crop so that the local vessel direction is visually normalized and easy for a neural network to inspect. Preserve vessel geometry, grayscale texture, catheter appearance, noise characteristics, and the selected local region. Do not create a new vessel or change the medical image. Use a subtle thin red point or arrow only if explicitly requested; otherwise output the rotated grayscale patch alone on a neutral background.
```

### 3.6 Steering history

```text
Create a precise vector scientific diagram of a short steering history. Show five to six sampled trajectory points connected from left to right by a smooth blue polyline. Place small blue arrowheads along the path to indicate temporal direction. Under the consecutive segments, place the exact angular labels θ_(k-5), θ_(k-4), θ_(k-3), θ_(k-2), and θ_(k-1), evenly spaced and aligned with their corresponding local steering directions. Use a clean white background, dark charcoal labels, a thin navy-blue trajectory, and generous whitespace. The diagram must be minimal, mathematical, and publication-ready. Do not add a graph axis, chart grid, random coordinates, extra points, decorative icons, or unrequested text.
```

### 3.7 Boundary steering cone

```text
Create a precise vector geometry diagram for a boundary steering cone. Place a black current-point marker near the lower center. From that point, draw two thin dashed black boundary rays opening upward and outward to form a symmetric steering cone. Draw a solid green arrow from the current point toward the cone interior to represent the preferred steering direction. Add a small curved black arc between the two boundary rays and label it exactly “Δθ_max”. Use a clean white background, consistent stroke widths, centered composition, and restrained scientific typography. No 3D perspective, no decorative effects, no extra axes, no random labels, no filled cone unless explicitly requested.
```

### 3.8 Dagger projection

```text
Create a premium but technically restrained vector diagram of a Dagger-style projection onto a traced vessel trajectory. Show a green curved ground-truth or reference trajectory, a thin orange dashed traced trajectory, and a short green lookahead segment. Place three circular markers: a green marker for the nearest GT point, a blue marker for the lookahead point, and a black marker for the current point. Connect the current point to the lookahead point with a thin blue line. Add one small pale amber circular lookahead region around the current point. Add a compact legend on the right with exactly these entries: “Nearest GT point”, “Lookahead point”, “Current point”, “Traced trajectory”. Add the exact phrase “Lookahead length” along a subtle orange guide line, with readable horizontal or gently angled typography. Use a white background, clean geometry, and a publication-quality layout. Do not add unrelated coordinate axes, random equations, extra curves, or invented values.
```

### 3.9 Visual encoder module

```text
Create a high-end scientific neural-network module illustration for a medical navigation paper. Show a grayscale DSA image entering a compact visual feature extractor represented by three clean stages of progressively smaller image-like feature maps, followed by a vertical feature vector labeled “f_v”. The visual style is an academic vector infographic with very subtle depth, not a glossy 3D neural network. Use teal and pale blue for the visual pathway, dark navy arrows, clean rectangular modules, and generous whitespace. The module should communicate image encoding without inventing an exact architecture beyond the supplied label “Adapted ResNet-18 Visual Encoder”. Do not create medical anatomy outside the supplied input image, do not add random layer names, and do not invent dimensions other than the explicitly requested “256D”.
```

### 3.10 History encoder module

```text
Create a matching scientific neural-network module illustration for steering-history encoding. Show a small blue steering-history polyline entering a compact MLP-style feature extractor, then a vertical feature vector labeled “f_h”. Use pale blue panels, navy arrows, clean mathematical geometry, and the same stroke width and spacing language as the visual encoder module. The module should communicate temporal or sequential steering-history encoding, not a generic deep-learning illustration. Preserve the exact dimension label “64D” and avoid inventing additional layer names, values, or equations.
```

### 3.11 Feature fusion and representation

```text
Create a clean scientific diagram of multimodal feature fusion. Place a vertical teal feature vector labeled “f_v” above a vertical blue feature vector labeled “f_h”. Feed both into a small circular node labeled “C” representing concatenation. From the node, output one longer vertical cyan-blue vector labeled “320D” and a small label “f” near the outgoing representation. Use clear downward and horizontal arrows, exact alignment, restrained pale blue panels, and ample whitespace. The composition must be mathematically legible and publication-ready. Do not add random network layers, extra operators, decorative symbols, or incorrect dimensions.
```

### 3.12 Three policy heads

```text
Create three vertically stacked, publication-quality policy-head modules with two different input paths. The top module is labeled exactly “Auxiliary Vessel Head” and includes “FC 256 → 128 → 1”; it receives the visual feature f_v directly from the 256D visual branch, before multimodal concatenation. The middle module is labeled exactly “Softplus Radius Head” and includes “FC 320 → 128 → 64 → 1”; it receives the fused 320D feature f. The bottom module is labeled exactly “Beta Steering Head” and includes “FC 320 → 256 → 128”; it also receives the fused 320D feature f. Use three lightly tinted panels with distinct but restrained colors: pale peach for auxiliary vessel, pale blue for radius, and pale green for steering. Use one navy arrow from f_v to the auxiliary vessel head, and separate navy arrows from f to the radius and steering heads. Keep typography large enough for a paper figure and do not add any other layer dimensions or model names.
```

### 3.13 Outputs and expert-action panel

```text
Create a clean output-side scientific panel for a radius-aware vessel navigation policy. Show three semantically distinct outputs aligned vertically: a vessel probability output labeled exactly “V in [0, 1]”, a positive-radius output labeled exactly “r > 0” with a small radius geometry icon, and a steering distribution output labeled exactly “(alpha, beta)” with the range “[-40°, 40°]”. Beside the steering output, show a small grayscale DSA vessel overlay and a small centerline/radius visualization as output thumbnails. Add the exact label “Expert steering action From Centerline/Dagger” near the final action reference, using two lines if necessary. Use coral red for radius, green for centerline/reference, amber for expert trajectory, and navy for data-flow arrows. No fake probability numbers, no fake performance results, no random medical images, no additional labels.
```

---

## 4. 整体生成图一：Centerline-Radius Labeling + Tracing State and Projection

### 4.1 适合生成的范围

第一张图对应原图的 `(a)` 和 `(b)`，主题是：

```text
从真实 DSA 图像得到中心线与半径标注
再把局部血管状态转换成轨迹、边界和 lookahead 投影
```

建议画布：`2048×1152`，横向 16:9。若要放入论文双栏，生成后再导出高分辨率版本并用排版工具缩放。

### 4.2 整图提示词

```text
Use case: scientific-educational methodology figure.
Asset type: first half of a publication-quality medical robotics and medical image analysis figure.
Input image: Image 1 is the supplied reference figure for semantic layout only. Images 2 and onward, if provided, are the original DSA clinical images and must be treated as pixel-locked source data. Do not redraw or alter those clinical images.

Create a premium landscape scientific figure titled with two clearly separated sections: “(a) Centerline-Radius Labeling” and “(b) Tracing State and Projection”. Use a warm white background, strict grid alignment, high-quality vector geometry, restrained color semantics, consistent typography, and a clean academic publication style. Do not make it look like a dashboard or marketing graphic.

Section (a), arranged as a left-to-right pipeline across the upper half:
1. A supplied real grayscale DSA image labeled exactly “Raw DSA”. Preserve the image pixels and medical content.
2. The same supplied image shown with intensity inversion and CLAHE, labeled exactly “Inverted and CLAHE”. Preserve geometry and crop; apply only the image-processing appearance.
3. A larger grouped panel labeled exactly “Manual annotation” containing the supplied image with a thin green manually annotated vessel centerline, next to a separate black-background distance-transform visualization with a restrained violet-blue-cyan-green-yellow color map and a small vertical color bar. The distance transform must be an abstract analytical mask visualization, not a new patient image.
4. A final supplied-image overlay labeled exactly “Radius and centerline”, with a clean coral-red predicted centerline and subtle radius band aligned to the real vessel.
Use navy arrows between the stages, one clear plus sign between manual annotation and distance transform, and one green result arrow into the final overlay. Keep the medical image panels dominant and keep the algorithm overlays technically legible.

Section (b), arranged as a wide horizontal workflow across the lower half:
1. On the far left, show a supplied DSA image with a small white region-of-interest square and two thin amber dashed guide lines leading to a larger local patch.
2. Show a clean rotated grayscale patch labeled exactly “Rotated patch”. Preserve its image texture and local vessel shape.
3. Show a vector diagram labeled exactly “Steering history”, with five or six blue sampled points, a smooth blue trajectory, arrowheads, and angular labels θ_(k-5), θ_(k-4), θ_(k-3), θ_(k-2), θ_(k-1).
4. Show a vector geometry diagram labeled exactly “Boundary Steering Cone”, with a black current point, two dashed boundary rays, a green interior steering arrow, a small arc, and the label “Δθ_max”.
5. Show a vector diagram labeled exactly “Dagger project”, with a green reference curve, an orange dashed traced trajectory, a blue lookahead point, a black current point, a green nearest-GT point, a short blue connecting segment, and the exact legend entries “Nearest GT point”, “Lookahead point”, “Current point”, “Traced trajectory”. Include the exact phrase “Lookahead length”.

Use a left-to-right reading order. Use dark navy for flow arrows, green for ground-truth or centerline geometry, coral red only for the final radius overlay, amber for traced trajectories, and blue for steering history. Keep all panels aligned to a common baseline. Use small rounded rectangles only where they clarify grouping. Leave enough whitespace around every label for later vector correction.

Text to render exactly and only when visible: “(a) Centerline-Radius Labeling”, “Raw DSA”, “Inverted and CLAHE”, “Manual annotation”, “Distance transform”, “Radius and centerline”, “(b) Tracing State and Projection”, “Rotated patch”, “Steering history”, “Boundary Steering Cone”, “Dagger project”, “Δθ_max”, “Lookahead length”, “Nearest GT point”, “Lookahead point”, “Current point”, “Traced trajectory”.

Do not invent anatomy, alter the supplied DSA images, add patient information, add random labels, add equations, add metrics, add a legend not requested above, or change the technical meaning of any arrow or color.
```

### 4.3 生成后检查

- 真实 DSA 图像是否保持原始血管走向和裁切。
- 绿色中心线是否没有漂出血管。
- 距离变换图是否只是算法示意，而不是虚构患者影像。
- `Steering history` 的箭头方向是否从过去指向当前。
- `Boundary Steering Cone` 的 `Δθ_max` 是否标在圆弧上。
- `Dagger project` 中四种颜色的点和轨迹是否与图例一致。
- 所有英文、希腊字母、下标和连字符是否正确；错误文字必须后期重排。

---

## 5. 整体生成图二：Radius-Aware Policy Network

### 5.1 适合生成的范围

第二张图对应原图的 `(c)`，主题是：

```text
DSA 图像 + Steering history
  -> 两路编码
  -> 特征融合
  -> 三个任务头
  -> vessel probability / positive radius / beta steering action
```

建议画布：`2048×1152`，横向 16:9。整图应采用左到右数据流，避免原参考图中输出箭头方向混乱的问题。

### 5.2 整图提示词

```text
Use case: scientific-educational and publication-quality neural-network architecture figure.
Asset type: second half of a medical image-guided navigation methodology figure.
Input image: Image 1 is the supplied reference figure for semantic structure only. The DSA image thumbnail and steering-history thumbnail must be treated as supplied source images and must not be redrawn or anatomically modified.

Create a premium, technically precise, landscape scientific architecture diagram titled exactly “(c) Radius-Aware Policy Network”. Use a warm white background, strict left-to-right data flow, aligned modules, consistent typography, crisp vector arrows, subtle pale module fills, and restrained academic colors. The output must look appropriate for a medical imaging, robotics, or machine-learning conference paper.

Layout from left to right:

Left input column:
1. A real supplied grayscale DSA thumbnail inside a modest input panel labeled exactly “Input 1”.
2. A supplied blue steering-history thumbnail inside a second input panel labeled exactly “Input 2”.

Visual branch:
3. From Input 1, a pale peach module labeled exactly “Adapted ResNet-18 Visual Encoder”. Show a compact image feature extraction motif with progressively smaller feature maps, without inventing detailed layers.
4. Output a vertical teal feature vector labeled exactly “f_v” and “256D”.

History branch:
5. From Input 2, a pale blue module labeled exactly “MLP History Encoder”. Show a compact sequence-to-feature motif.
6. Output a vertical blue feature vector labeled exactly “f_h” and “64D”.

Fusion stage:
7. Bring f_v and f_h into a small circular concatenation node labeled exactly “C”.
8. Output a longer cyan-blue feature vector labeled exactly “f” and “320D”. Use clear arrows and exact dimensions.

Policy-head stage:
9. Show three vertically stacked heads with the correct two-path connection logic:
   - “Auxiliary Vessel Head” with “FC 256 → 128 → 1”, connected directly from the visual feature f_v before concatenation.
   - “Softplus Radius Head” with “FC 320 → 128 → 64 → 1”, connected from the fused feature f.
   - “Beta Steering Head” with “FC 320 → 256 → 128”, connected from the fused feature f.
Use pale peach for the auxiliary vessel head, pale blue for the radius head, and pale green for the steering head. Do not add layers or dimensions not listed.

Output stage:
10. To the right of the three heads, show three aligned outputs:
   - “Vessel probability” and the exact expression “V in [0, 1]”.
   - A simple radius geometry icon with the exact expression “r > 0”.
   - A steering distribution icon with the exact expression “(alpha, beta)” and range “[-40°, 40°]”.
11. At the far right, show two small supplied or algorithmically generated output thumbnails: a vessel-mask-like black thumbnail with a thin white vessel curve, and a centerline/radius thumbnail with a thin cyan centerline. Do not claim these are measured clinical results; they are output illustrations only.
12. Add the exact label “Expert steering action From Centerline/Dagger” near the steering output, using two clean lines if needed.

Use navy arrows for all data flow. The auxiliary vessel head must branch from f_v before concatenation; only the radius head and beta steering head branch from the fused 320D representation f. Use teal and violet/cyan for learned features, green for reference or centerline geometry, coral only for radius visualization, and amber only for expert trajectory or Dagger-related guidance. Use no gradients that obscure structure, no glowing neural-network effects, no random equations, no fake training metrics, no fabricated performance chart, and no additional medical anatomy.

Text to render exactly and only when visible: “(c) Radius-Aware Policy Network”, “Input 1”, “Input 2”, “Adapted ResNet-18 Visual Encoder”, “MLP History Encoder”, “f_v”, “f_h”, “256D”, “64D”, “C”, “f”, “320D”, “Auxiliary Vessel Head”, “FC 256 → 128 → 1”, “Softplus Radius Head”, “FC 320 → 128 → 64 → 1”, “Beta Steering Head”, “FC 320 → 256 → 128”, “Vessel probability”, “V in [0, 1]”, “r > 0”, “(alpha, beta)”, “[-40°, 40°]”, “Expert steering action From Centerline/Dagger”.

Do not change the listed dimensions, do not reverse the data-flow arrows, do not invent a fourth head, do not add loss functions or metrics, do not redraw the clinical input image, and do not generate patient-identifying information.
```

### 5.3 生成后检查

- 两路输入是否清楚分为 visual branch 与 history branch。
- `f_v` 是否为 `256D`，`f_h` 是否为 `64D`，拼接后是否为 `320D`。
- `Auxiliary Vessel Head` 是否直接从 `f_v` 分支，而不是错误地接收 `320D` 融合特征。
- 三个 head 的名称、层维度和顺序是否正确。
- `Softplus Radius Head` 是否对应正值约束 `r > 0`。
- `Beta Steering Head` 是否对应 `(alpha, beta)`，没有被写成普通分类器。
- 所有箭头是否从输入指向输出，而不是反向。
- 真实 DSA 输入是否没有被模型改造成另一种血管图像。

---

## 6. 推荐的两阶段生成策略

### 阶段一：先生成无文字底稿

先使用整图提示词，但把所有 exact text 要求改为：

```text
Leave all label areas as clean empty whitespace placeholders. Do not render any text. Preserve the exact panel geometry and module positions so labels can be overlaid later.
```

这样更容易得到正确的箭头、曲线、颜色和布局。

### 阶段二：局部生成组件

对 distance transform、steering history、boundary cone、Dagger project 和网络模块分别生成，并选出最稳定的一版。最后使用矢量工具完成：

```text
真实 DSA 图像
  + 算法生成的中心线 / 半径 / mask
  + GPT Image 2 生成的几何示意
  + SVG / Figma / Matplotlib 文字、箭头和尺寸
  = 最终论文图
```

### 阶段三：再做整图统一

将选中的组件作为参考图上传给 GPT Image 2，使用整图提示词要求统一：

- 面板间距。
- 线条粗细。
- 箭头样式。
- 颜色含义。
- 圆角和阴影强度。
- 背景色和留白。

但不要让模型重新解释数据或改写组件内部的几何关系。

---

## 7. 最终质量门槛

### 科学准确性

- [ ] 真实 DSA 图像没有被重新绘制。
- [ ] 中心线和半径结果来自真实算法或人工标注，而不是 GPT 臆造。
- [ ] distance transform 的颜色只表达数值距离，不被误解成医学热力图。
- [ ] `r > 0`、`V in [0, 1]` 和 `(alpha, beta)` 的语义没有改变。
- [ ] 三个 policy head 的维度与代码/论文保持一致。

### 视觉质量

- [ ] 两张图使用同一套颜色、字体、箭头和面板规范。
- [ ] 画面留白充足，缩小后仍能区分模块。
- [ ] 没有大面积渐变、发光、玻璃卡片或营销海报风格。
- [ ] 所有曲线、点、箭头和图例都能在视觉上对应。
- [ ] 真实医学图像和算法示意图的层级关系清楚。

### 文字质量

- [ ] `Centerline-Radius`、`Dagger`、`Softplus`、`ResNet-18` 拼写正确。
- [ ] `Δθ_max`、`f_v`、`f_h`、`320D`、`r > 0` 等符号正确。
- [ ] 所有 head 的维度没有被模型改写。
- [ ] 不需要的文字、假数据、假指标和水印已经删除。
