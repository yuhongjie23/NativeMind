# NativeMind 文档索引

> 目的：省 token。需要细节时按需读，不要一次全读。
> 实现以代码为准；本文档只指路。

## 首选（实现相关）
| 文件 | 读它当… |
|---|---|
| `使用文档.md` | 功能怎么用 + 实现流程（最全、最接近现状） |
| `功能总览.md` | 按功能逐一说明「UI → 实现」对照 |
| `讲解笔记.md` | 当前本地开发版的通俗功能介绍、十二分钟演示讲稿、常见问题与能力边界；Word 版位于 `output/documents/NativeMind软件介绍与演示讲稿.docx` |
| `ARCHITECTURE.md` | 分层架构、端口/适配器、数据流 |
| `DATABASE_SCHEMA.md` | 表结构 / 字段 / 迁移 |
| `EVENT_SYSTEM.md` | 事件类型与订阅关系 |
| `exec-plans/tech-debt-tracker.md` | 已知问题 / 在修项 |
| `knowledge-organization-acceptance.md` | 验收 DeepSeek 卡片、长文继续、主题组合与本地反向引用 |
| `benchmarks/rerank-2026-11-10.json` | 查看真实 Qwen3:14b 重排 A/B 逐次结果、限制与冻结基线；复现脚本为 `scripts/benchmark-rerank.mjs` |
| `benchmarks/rerank-excerpts-2026-11-10.json` | 查看长候选片段开头/中部/末部证据的真实模型对比；脚本增加 `--long-passages` |
| `benchmarks/qa-evidence-window-2026-11-10.json` | 查看真实生成/核验对后部事实与缺失答案的验收；复现脚本 `scripts/benchmark-qa-evidence.mjs` |
| `benchmarks/qa-language-2026-11-11.json` | 查看中英文问答、跨语言原文引用及缺失答案的真实模型对比；复现脚本 `scripts/benchmark-qa-language.mjs` |
| `benchmarks/document-pipeline-2026-11-11.json` | 真实长 PDF/EPUB 正式导入、索引、搜索、问答及阅读定位验收；结论未通过，含已修复的切片偏移与未解决的核验超时/召回/取消问题 |
| `DEVELOPMENT.md` | 运行形态、逐文件说明（部分文件已删，以其为准但注意可能过时） |

## 可读可不读
| 文件 | 说明 |
|---|---|
| `FRONTEND.md` / `DESIGN.md` / `PRODUCT_SENSE.md` | 设计理念，改 UI 时参考 |
| `RELIABILITY.md` / `SECURITY.md` / `QUALITY_SCORE.md` | 工程约束与评分 |
| `product-specs/` `design-docs/` `references/` | 产品规格 / 设计稿引用 |
| `generated/db-schema.md` | 生成的 schema 快照 |

## 过时
`PROJECT_STRUCTURE.md` — 设计期结构稿，与当前代码不一致，改代码前别信它。
