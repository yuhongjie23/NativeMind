# NativeMind 文档索引

> 目的：省 token。需要细节时按需读，不要一次全读。
> 实现以代码为准；本文档只指路。

## 首选（实现相关）
| 文件 | 读它当… |
|---|---|
| `使用文档.md` | 功能怎么用 + 实现流程（最全、最接近现状） |
| `ARCHITECTURE.md` | 分层架构、端口/适配器、数据流 |
| `DATABASE_SCHEMA.md` | 表结构 / 字段 / 迁移 |
| `EVENT_SYSTEM.md` | 事件类型与订阅关系 |
| `exec-plans/tech-debt-tracker.md` | 已知问题 / 在修项 |
| `DEVELOPMENT.md` | 运行形态、逐文件说明（部分文件已删，以其为准但注意可能过时） |

## 可读可不读
| 文件 | 说明 |
|---|---|
| `FRONTEND.md` / `DESIGN.md` / `PRODUCT_SENSE.md` | 设计理念，改 UI 时参考 |
| `RELIABILITY.md` / `SECURITY.md` / `QUALITY_SCORE.md` | 工程约束与评分 |
| `产品架构_v2.md` | 产品架构约束（C1–C7），大文档 |
| `宠物互动接口补充方案.md` | 陪伴交互接口设计 |
| `product-specs/` `design-docs/` `references/` | 产品规格 / 设计稿引用 |
| `generated/db-schema.md` | 生成的 schema 快照 |

## 归档（默认不读）
`archive/` — 一次性设计/资产 prompt（COZY_HOME 系列、SEEDANCE 工作流）与 demo 截图。不是实现文档。

## 过时
`PROJECT_STRUCTURE.md` — 设计期结构稿，与当前代码不一致，改代码前别信它。
