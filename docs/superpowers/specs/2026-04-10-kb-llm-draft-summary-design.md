# 知识草稿 LLM 摘要设计

**日期：** 2026-04-10

**目标：** 将“从会话提取知识草稿”的核心摘要段落升级为 LLM 生成，同时保留现有结构化草稿的可追溯性与可控性。

**范围：**
- 后端知识草稿生成链路
- LLM 摘要 prompt 与结果解析
- 草稿回退策略与测试覆盖

**非目标：**
- 不修改前端交互流程
- 不引入 OpenViking `commit` 归档副作用
- 不把整篇草稿完全交给 LLM 自由生成

## 1. 背景

当前项目的知识草稿生成流程是：

1. 前端 `KBExtractDialog` 调用 `POST /api/kb/extract-draft`
2. 后端读取会话消息
3. `buildKnowledgeDraft()` 以模板方式拼接 Markdown
4. 用户审核草稿后调用 `POST /api/kb/save-draft` 保存到 `KB_ROOT_URI`

现状问题：

- `## 摘要` 只是把消息拼接后截断，表达质量有限
- `## 关键结论` 依赖最近几条 assistant 消息，容易遗漏真实结论
- `## 后续建议` 是固定占位语，缺少实际价值

## 2. OpenViking 边界结论

已确认 OpenViking 有两类相关能力，但都不适合直接作为当前草稿摘要接口：

1. `POST /api/v1/sessions/{session_id}/extract`
   - 这是 memory extract 接口
   - 返回 memory 列表，不返回面向知识草稿的摘要文本

2. Session 内部 `_generate_archive_summary_async()`
   - 这是 OpenViking 内部的 LLM 摘要能力
   - 当前挂在 archive/commit 流程中，不是公开的无副作用摘要 API
   - 若直接复用 `commit`，会引入归档、记忆提取和任务状态副作用，不适合作为“生成待审核草稿”的同步接口

因此，本项目采用：

- **保留 OpenViking 仅作为知识库存储/检索后端**
- **在本项目后端直接调用 OpenAI-compatible API 生成知识草稿摘要**
- **在本项目内新增一个无副作用的知识草稿 LLM 摘要层**

## 3. 方案选择

### 3.1 备选方案

1. 只替换 `## 摘要`
2. 混合生成：LLM 负责关键语义段，结构化逻辑负责可追溯段
3. 整篇草稿全由 LLM 输出

### 3.2 选择

采用 **混合生成**。

理由：

- 比只替换 `摘要` 的收益更高
- 比全量 LLM 生成更稳定，格式更可控
- 保留 `处理过程` 和 `来源`，便于用户审阅和追溯

## 4. 目标草稿结构

最终草稿仍然是 Markdown，但来源分成两类：

### 4.1 由 LLM 生成

- `## 摘要`
- `## 关键结论`
- `## 后续建议`

### 4.2 由结构化逻辑生成

- `# 标题`
- `## 背景`
- `## 处理过程`
- `## 来源`

## 5. 新增后端结构

## 5.1 新增知识草稿摘要器

在 `src/kb-proxy.ts` 附近新增一层知识草稿摘要器，职责单一：

- 输入：清洗后的会话消息、标题、会话元信息
- 输出：结构化摘要字段
- 执行方式：后端通过 `fetch` 调用 OpenAI-compatible `chat/completions`

建议结构：

```ts
type KnowledgeDraftSummary = {
  summary: string;
  conclusions: string[];
  followUps: string[];
  warnings?: string[];
};
```

建议新增函数：

```ts
async function summarizeKnowledgeDraft(
  messages: ExtractMessage[],
  options: BuildKnowledgeDraftOptions,
  identity?: OpenVikingIdentity,
): Promise<KnowledgeDraftSummary>
```

## 5.2 `buildKnowledgeDraft()` 改造

`buildKnowledgeDraft()` 从同步拼装改为异步混合拼装：

1. 先复用现有 `filterMessages()` 做消息清洗
2. 调用 LLM 摘要器生成 `summary / conclusions / followUps`
3. 用现有逻辑补齐 `背景 / 处理过程 / 来源`
4. 组装最终 Markdown
5. 如果 LLM 摘要失败，则自动回退到当前模板逻辑

建议接口变更为：

```ts
export async function buildKnowledgeDraft(
  messages: ExtractMessage[],
  options: BuildKnowledgeDraftOptions = {},
  identity?: OpenVikingIdentity,
): Promise<KnowledgeDraft>
```

对应地，`/api/kb/extract-draft` 路由改为 `await buildKnowledgeDraft(...)`。

## 6. Prompt 设计

## 6.1 参考来源

摘要 prompt 设计参考 `src-claude/claude-code-main` 的 compact 实现，借鉴以下原则：

- 强制纯文本输出
- 强制禁止工具调用
- 要求输出 `<analysis>` 和 `<summary>` 两段
- 运行后丢弃 `<analysis>`，只消费 `<summary>`
- 用固定结构降低漂移

## 6.2 不直接照搬 compact 的部分

不复用 compact 的 9 段业务结构，因为它面向“继续开发上下文压缩”，而不是“会话提炼成知识草稿”。

本项目需要的不是：

- 所有用户消息
- 代码文件清单
- 当前工作状态
- 下一步执行动作

本项目真正需要的是：

- 高质量摘要
- 明确结论
- 可执行后续建议

## 6.3 Prompt 结构

Prompt 分三段：

1. `NO_TOOLS_PREAMBLE`
2. `BASE_KB_DRAFT_PROMPT`
3. `NO_TOOLS_TRAILER`

示例结构：

```text
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool.
- You already have all the conversation content you need.
- Tool calls will be rejected.
- Your response must contain an <analysis> block and a <summary> block.

Your task is to summarize the conversation into a knowledge-base draft aid.

Before your final answer, use <analysis> to reason privately about:
- the user's real problem
- the key decisions
- the final conclusions
- the unresolved follow-up items

In <summary>, output exactly these sections:
## 摘要
## 关键结论
## 后续建议

Rules:
- `## 摘要` 用 1 段中文总结本次会话的核心问题、处理动作和最终结果
- `## 关键结论` 使用 3-6 条 bullet，必须是可以直接写入知识库的结论
- `## 后续建议` 使用 1-5 条 bullet，只保留真正需要后续处理或复核的事项
- 不要编造未在会话中出现的事实
- 不要输出工具调用
- 不要输出额外章节

REMINDER: Do NOT call any tools. Respond with plain text only.
```

## 6.4 输入内容

输入给模型的消息内容为清洗后的会话转录：

```text
[user] ...
[assistant] ...
[user] ...
```

附加元信息：

- 可选标题
- chatName
- chatJid

但不要求模型生成最终文件名或最终完整 Markdown。

## 6.5 模型调用协议

摘要调用使用 OpenAI-compatible HTTP API，而不是 agent IPC 或 OpenViking session 接口。

建议新增独立配置，避免与主对话模型或 OpenViking 配置混用：

- `KB_SUMMARY_LLM_API_URL`
- `KB_SUMMARY_LLM_API_KEY`
- `KB_SUMMARY_LLM_MODEL`
- `KB_SUMMARY_LLM_TIMEOUT`（可选）

建议首版走兼容性最好的 `POST {baseUrl}/chat/completions`：

```json
{
  "model": "gpt-4.1-mini",
  "messages": [
    {
      "role": "system",
      "content": "You are a careful assistant that writes structured knowledge-base summaries."
    },
    {
      "role": "user",
      "content": "{NO_TOOLS_PREAMBLE + BASE_KB_DRAFT_PROMPT + transcript + NO_TOOLS_TRAILER}"
    }
  ],
  "temperature": 0.2
}
```

理由：

- 比 `responses` 接口更容易兼容各类 OpenAI 风格网关
- 当前项目无现成 LLM SDK，引入原生 `fetch` 成本最低
- 便于在测试里直接 stub HTTP 返回

## 7. 结果解析

新增结果解析器，负责：

1. 删除 `<analysis>...</analysis>`
2. 提取 `<summary>...</summary>`
3. 从 `<summary>` 中解析：
   - `## 摘要`
   - `## 关键结论`
   - `## 后续建议`
4. 做格式归一化

建议规则：

- 缺少 `<summary>` 视为失败
- 缺少任一标题时视为失败
- `关键结论/后续建议` 允许 `- ` 或 `1. ` 两种列表格式，解析后统一为字符串数组
- 去掉空行、重复 bullet、重复标题

## 8. 草稿拼装规则

LLM 成功时：

```md
# {title}

## 摘要
{llm.summary}

## 背景
{structuredBackground}

## 处理过程
{structuredProcess}

## 关键结论
- ...

## 后续建议
- ...

## 来源
- 会话：...
- Chat JID：...
- 提取时间：...
```

LLM 失败时：

- 退回当前模板逻辑
- `warnings` 追加一条，例如：`LLM 摘要生成失败，当前草稿基于模板逻辑生成，请人工校对。`

## 9. 回退策略

选择自动回退，而不是直接报错。

原因：

- 草稿提取是高频操作，不能因为模型或上游接口短时异常而完全不可用
- 用户仍然可以先拿到可编辑草稿，再手工修正
- 当前模板逻辑已经是可用兜底路径

触发回退的场景：

- 模型调用失败
- LLM 配置缺失
- 返回为空
- 无 `<summary>` 块
- 关键段落缺失
- 解析异常

## 10. 输入裁剪与稳定性

为避免 prompt 过长和摘要漂移，保留以下约束：

1. 继续复用现有 `filterMessages()`
2. 限制单条消息长度
3. 限制参与摘要的消息总数和总字符数
4. 优先保留时间顺序
5. 对纯命令、纯标点、极短噪音消息继续过滤

建议初始策略：

- 最多使用 80 条清洗后消息
- 总字符数超过阈值时截断尾部消息内容
- 在 `warnings` 中提示“会话过长，摘要基于截断后的消息生成”

## 11. API 与前端影响

前端交互不变：

- `KBExtractDialog` 仍然调用 `POST /api/kb/extract-draft`
- 审核页仍允许用户编辑草稿
- 保存仍走 `POST /api/kb/save-draft`

接口契约尽量保持不变：

- `draftTitle`
- `suggestedUri`
- `content`
- `source`
- `warnings`

因此前端只会感知到草稿内容质量提升，不需要改交互。

## 12. 测试设计

## 12.1 单元测试

### Prompt 相关

- `getKnowledgeDraftPrompt()` 应包含 no-tools 前后约束
- 自定义附加指令可以正确拼接

### 解析相关

- 正常返回 `<analysis> + <summary>` 时可正确提取段落
- 缺少 `<analysis>` 但有 `<summary>` 仍可解析
- 缺少 `<summary>` 时失败
- 缺少 `## 关键结论` 或 `## 后续建议` 时失败
- 列表格式归一化正确

### 草稿拼装相关

- LLM 成功时，草稿使用 LLM 段落
- LLM 失败时，草稿回退到模板逻辑
- 回退时写入 warning

## 12.2 路由测试

- `POST /api/kb/extract-draft` 在摘要成功时返回正常草稿
- `POST /api/kb/extract-draft` 在摘要失败时仍返回 200 和模板草稿
- 仅在消息为空或无可提取内容时保持报错

## 13. 风险与权衡

1. **LLM 输出漂移**
   - 通过固定标题、严格解析和回退机制控制

2. **会话过长导致成本或超长**
   - 通过消息清洗、数量限制和字符预算控制

3. **OpenViking 上游能力变化**
   - 当前实现不依赖其内部未公开摘要接口，因此耦合较低

4. **OpenAI-compatible 网关差异**
   - 通过使用通用 `chat/completions` 协议降低兼容风险
   - 失败时自动回退到模板草稿

5. **同步接口耗时增加**
   - `extract-draft` 的响应时间会高于当前模板拼装
   - 但该操作本身就是显式用户动作，可接受

## 14. 实现摘要

本次设计的核心是：

- 在本项目内新增一个知识草稿 LLM 摘要器
- 该摘要器通过 OpenAI-compatible API 直接调用模型
- prompt 参考 compact 风格，但业务结构改为知识草稿场景
- 只让 LLM 负责语义最强的 3 段：摘要、关键结论、后续建议
- 背景、处理过程、来源继续保持结构化生成
- 任意异常自动回退到当前模板草稿，保证功能可用
