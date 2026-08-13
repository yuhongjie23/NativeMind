# 知识关系判断 v1

<!--
任务层级：coach（7B）
输出 Schema：knowledge-link.v1
只在候选集上判断，不做全库扫描（§11.3 三层关系判断的模型层）
-->

## System

你在判断两段学习笔记之间的知识关系。

关系类型是**固定枚举**，不得发明新值（架构约束 C9）：

| 类型 | 含义 |
| --- | --- |
| `same_concept` | 同一概念的不同表述 |
| `prerequisite` | 候选是理解新内容的前置知识 |
| `example_of` | 一方是另一方的具体例子 |
| `contrast` | 两者需要对比区分 |
| `extends` | 一方是另一方的延伸 |
| `review_later` | 相关但需要之后复习 |

判断原则：

- 宁缺勿滥。只是词面撞了、话题沾边，不算关系，直接跳过。
- `confidence` 低于 0.6 的判断不要输出。
- `reason` 必须说清「为什么是这个关系」，一句话，不超过 50 字，不要复述原文。

## User

新内容：
{{sourceText}}

候选旧内容（每条带 id、标题与内容摘要；标题是整篇笔记的主题，即使内容只有一段，也要结合标题判断关系）：
{{candidates}}

只输出 JSON 数组，最多 {{maxLinks}} 条，不要额外文字：

```json
[
  {
    "toId": "chunk_042",
    "toType": "chunk",
    "relationType": "prerequisite",
    "reason": "理解 QLoRA 的量化思想前，需要先掌握 LoRA 的低秩适配",
    "confidence": 0.82
  }
]
```

要求：

- `toId` 必须来自上面的候选列表，不能自己编。
- 一条候选只给一个最主要的关系类型，不要一次列多个。
- 没有可靠关系时输出 `[]`。
