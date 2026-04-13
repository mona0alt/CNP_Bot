# Frontend UI Proportion Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `1920x1080` 与浏览器 `100%` 缩放下重建前端后台页面的尺寸基线，使管理页不再依赖 `75%` 缩放获得合适观感，同时保留聊天页消息正文的中性阅读尺度。

**Architecture:** 先在全局样式和框架层建立统一的字号、间距、侧栏宽度和控件高度基线，再按页面分批收口。`Dashboard`、`KnowledgeBase`、`Skills*`、`Users`、`Login` 统一向后台工作区基线靠拢，`Chat` 则作为特例，仅调整列表、输入区和辅助信息，不放大消息正文。

**Tech Stack:** React 19、TypeScript、Vite、Tailwind CSS、Vitest、jsdom

---

## File Map

### Global Frame And Shared Styling

- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/components/Sidebar.skills-nav.test.tsx`

### Dashboard

- Modify: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/pages/Dashboard.test.tsx`

### Workspace Pages

- Modify: `frontend/src/pages/KnowledgeBase.tsx`
- Modify: `frontend/src/pages/SkillsAdmin.tsx`
- Modify: `frontend/src/pages/SkillsCatalog.tsx`
- Modify: `frontend/src/pages/Users.tsx`
- Modify: `frontend/src/pages/Login.tsx`
- Modify: `frontend/src/pages/SkillsAdmin.test.tsx`
- Create: `frontend/src/pages/Users.test.tsx`
- Create: `frontend/src/pages/Login.test.tsx`

### Chat Page

- Modify: `frontend/src/pages/Chat.tsx`
- Modify: `frontend/src/components/Chat/ChatSidebar.tsx`
- Modify: `frontend/src/components/Chat/MessageInput.tsx`
- Modify: `frontend/src/components/Chat/MessageItem.tsx`
- Modify: `frontend/src/pages/Chat.status-drawer.test.tsx`
- Modify: `frontend/src/components/Chat/MessageItem.test.tsx`

## Task 1: 建立全局后台尺寸基线

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/components/Sidebar.skills-nav.test.tsx`

- [ ] **Step 1: 写一个失败的侧栏比例测试**

在 `frontend/src/components/Sidebar.skills-nav.test.tsx` 增加对侧栏根节点类名的断言，先固定“侧栏宽度要比当前更宽、导航文字不再是过小字号”。

```tsx
const sidebar = container.firstElementChild as HTMLDivElement | null;
expect(sidebar?.className).toContain("w-56");
expect(container.textContent).toContain("技能");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- frontend/src/components/Sidebar.skills-nav.test.tsx`
Expected: FAIL，当前侧栏仍是 `w-48`，类名断言不成立。

- [ ] **Step 3: 最小实现全局尺寸基线**

在 `frontend/src/index.css` 定义少量后台尺寸变量或组件层通用类，至少覆盖：

- 页面正文基线 `14px`
- 次级说明 `12px-13px`
- 标准控件高度
- 标准卡片内边距

在 `frontend/src/components/Layout.tsx` 和 `frontend/src/components/Sidebar.tsx` 完成：

- 侧栏宽度由 `w-48` 提升到更稳定的一档
- 顶部 Logo 区、导航项、主题按钮、用户区高度统一
- 导航文案不再依赖 `text-[13px]` 以下的小字号

```tsx
<div className="w-56 border-r border-border h-screen flex flex-col bg-card">
  ...
  <Link className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium">
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- frontend/src/components/Sidebar.skills-nav.test.tsx`
Expected: PASS，且原有技能入口行为断言仍然成立。

- [ ] **Step 5: 构建前端确认全局样式无编译错误**

Run: `npm run build --prefix frontend`
Expected: exit 0，无 Tailwind 或 TypeScript 编译错误。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/index.css frontend/src/components/Layout.tsx frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.skills-nav.test.tsx
git commit -m "feat: establish frontend admin sizing baseline"
```

## Task 2: 收口 Dashboard 的标题、卡片和表格比例

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/pages/Dashboard.test.tsx`

- [ ] **Step 1: 写一个失败的首页比例测试**

创建 `frontend/src/pages/Dashboard.test.tsx`，渲染首页后断言主标题、说明文字和任务表格不再使用过小字号类。

```tsx
expect(container.querySelector("h1")?.className).toContain("text-2xl");
expect(container.textContent).toContain("AI Agent 控制台");
expect(container.innerHTML).not.toContain("text-[10px]");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- frontend/src/pages/Dashboard.test.tsx`
Expected: FAIL，当前实现里仍有大量 `text-[10px]` 与 `text-[11px]`。

- [ ] **Step 3: 最小实现 Dashboard 尺寸修正**

在 `frontend/src/pages/Dashboard.tsx` 完成：

- 页面容器、section 间距与卡片 padding 上调一档
- 顶部标题区改为清晰的 `标题 / 说明 / 顶部指标` 层级
- 统计卡片中的说明和数值拉开层级
- 任务表格表头、单元格、状态标签统一到可读但紧凑的字号区间

```tsx
<h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
  AI Agent 控制台
</h1>
<p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
  聚合任务、资源与协作态势，强化默认 100% 缩放下的信息可读性。
</p>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- frontend/src/pages/Dashboard.test.tsx`
Expected: PASS，首页标题和密度相关断言通过。

- [ ] **Step 5: 执行前端构建**

Run: `npm run build --prefix frontend`
Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/pages/Dashboard.test.tsx
git commit -m "feat: rebalance dashboard typography and spacing"
```

## Task 3: 统一 KnowledgeBase 与 Skills 工作区比例

**Files:**
- Modify: `frontend/src/pages/KnowledgeBase.tsx`
- Modify: `frontend/src/pages/SkillsAdmin.tsx`
- Modify: `frontend/src/pages/SkillsCatalog.tsx`
- Modify: `frontend/src/pages/SkillsAdmin.test.tsx`

- [ ] **Step 1: 写失败测试锁定 Skills 工作区的新基线**

在 `frontend/src/pages/SkillsAdmin.test.tsx` 补充断言，固定：

- 技能卡片仍可点击
- 卡片摘要与标题采用更合理的字号
- 抽屉或树节点不会回退到过小字号

```tsx
const skillCard = container.querySelector('[data-testid="skill-card-tmux"]');
expect(skillCard?.className).toContain("rounded-2xl");
expect(container.innerHTML).not.toContain("text-[10px]");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- frontend/src/pages/SkillsAdmin.test.tsx`
Expected: FAIL，当前卡片与工作区仍使用偏小字号与偏紧 spacing。

- [ ] **Step 3: 最小实现 KnowledgeBase 与 Skills 页面收口**

在 `frontend/src/pages/KnowledgeBase.tsx`、`frontend/src/pages/SkillsAdmin.tsx`、`frontend/src/pages/SkillsCatalog.tsx` 中统一：

- 页面标题与说明的字号层级
- 搜索框、工具按钮、树节点、列表项的标准高度
- 编辑区、预览区、抽屉区的 padding 节奏
- 卡片摘要、更新时间与正文预览的字号关系

保持原有功能、交互和数据请求不变，只改比例。

```tsx
<div className="space-y-4 p-5 lg:p-6">
  <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
  <p className="text-sm text-muted-foreground">...</p>
</div>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- frontend/src/pages/SkillsAdmin.test.tsx`
Expected: PASS，现有技能管理行为仍正常，新增比例断言通过。

- [ ] **Step 5: 构建前端确认工作区页面编译正常**

Run: `npm run build --prefix frontend`
Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/KnowledgeBase.tsx frontend/src/pages/SkillsAdmin.tsx frontend/src/pages/SkillsCatalog.tsx frontend/src/pages/SkillsAdmin.test.tsx
git commit -m "feat: align workspace page proportions"
```

## Task 4: 统一 Users 与 Login 的表单和表格比例

**Files:**
- Modify: `frontend/src/pages/Users.tsx`
- Modify: `frontend/src/pages/Login.tsx`
- Create: `frontend/src/pages/Users.test.tsx`
- Create: `frontend/src/pages/Login.test.tsx`

- [ ] **Step 1: 先写 Users 页失败测试**

创建 `frontend/src/pages/Users.test.tsx`，断言用户管理页标题、主按钮、表头和标签不再停留在过小字号，并保持 CRUD 入口可见。

```tsx
expect(container.textContent).toContain("User Management");
expect(container.querySelector("button")?.className).toContain("h-10");
expect(container.innerHTML).not.toContain("text-[11px]");
```

- [ ] **Step 2: 运行 Users 测试确认失败**

Run: `npm test -- frontend/src/pages/Users.test.tsx`
Expected: FAIL，当前按钮、标签、表格字号仍过小。

- [ ] **Step 3: 最小实现 Users 比例修正**

在 `frontend/src/pages/Users.tsx` 中调整：

- 页面标题与主按钮
- 错误提示和表格表头
- 行内按钮与角色标签
- 弹窗表单控件高度与标题层级

```tsx
<button className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium">
```

- [ ] **Step 4: 再写 Login 页失败测试**

创建 `frontend/src/pages/Login.test.tsx`，锁定登录页标题、说明、输入框和按钮的尺寸关系，避免后续回退。

```tsx
expect(container.textContent).toContain("Sign in to CNP-Bot");
expect(container.querySelector('input#username')?.className).toContain("h-14");
expect(container.querySelector("h2")?.className).toContain("text-3xl");
```

- [ ] **Step 5: 运行 Login 测试确认失败**

Run: `npm test -- frontend/src/pages/Login.test.tsx`
Expected: FAIL，如果当前实现未明确锁定目标比例；若已部分满足，则补充更能体现“统一后台基线”的断言后重跑直到失败。

- [ ] **Step 6: 最小实现 Login 比例校正**

在 `frontend/src/pages/Login.tsx` 中只做比例统一，不改页面风格：

- 标题和说明与后台主站基线对齐
- 主题切换按钮、输入框、提交按钮和提示区节奏统一
- 避免形成与主站完全脱节的尺寸语言

- [ ] **Step 7: 运行 Users 和 Login 测试确认通过**

Run: `npm test -- frontend/src/pages/Users.test.tsx frontend/src/pages/Login.test.tsx`
Expected: PASS。

- [ ] **Step 8: 构建前端**

Run: `npm run build --prefix frontend`
Expected: exit 0。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/pages/Users.tsx frontend/src/pages/Login.tsx frontend/src/pages/Users.test.tsx frontend/src/pages/Login.test.tsx
git commit -m "feat: standardize users and login sizing"
```

## Task 5: 单独收口 Chat，避免误放大消息正文

**Files:**
- Modify: `frontend/src/pages/Chat.tsx`
- Modify: `frontend/src/components/Chat/ChatSidebar.tsx`
- Modify: `frontend/src/components/Chat/MessageInput.tsx`
- Modify: `frontend/src/components/Chat/MessageItem.tsx`
- Modify: `frontend/src/pages/Chat.status-drawer.test.tsx`
- Modify: `frontend/src/components/Chat/MessageItem.test.tsx`

- [ ] **Step 1: 写聊天页失败测试，锁定“消息正文不放大”**

在 `frontend/src/components/Chat/MessageItem.test.tsx` 增加对消息气泡类名和时间戳类名的断言，确保消息正文保持中性尺寸，辅助字段可以更小，但不能继续放大。

```tsx
expect(container.innerHTML).toContain("text-[11px]");
expect(container.innerHTML).toContain("text-[9px]");
```

在 `frontend/src/pages/Chat.status-drawer.test.tsx` 增加对聊天页输入区或侧栏按钮高度的断言，锁定“外圈可调、正文不动”的要求。

```tsx
const trigger = container.querySelector('button[aria-label="查看状态"]');
expect(trigger?.className ?? "").toContain("h-9");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- frontend/src/components/Chat/MessageItem.test.tsx frontend/src/pages/Chat.status-drawer.test.tsx`
Expected: FAIL，当前聊天页还未明确区分“消息正文”和“外围控件”的比例规则。

- [ ] **Step 3: 最小实现 Chat 的例外规则**

在 `frontend/src/components/Chat/ChatSidebar.tsx`、`frontend/src/components/Chat/MessageInput.tsx`、`frontend/src/pages/Chat.tsx` 中调整：

- 会话列表宽度、标题、副标题、按钮与输入框高度
- 顶部状态按钮、抽屉触发器和底部输入栏的视觉比例

在 `frontend/src/components/Chat/MessageItem.tsx` 中保持：

- 消息正文维持原有中性字号，不跟全局正文基线一起上调
- 仅优化气泡 padding、圆角、头像与时间戳的视觉关系

```tsx
<div className="p-2.5 rounded-xl text-[11px] leading-snug ...">
...
<div className="text-[9px] opacity-50 mt-1 text-right">
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- frontend/src/components/Chat/MessageItem.test.tsx frontend/src/pages/Chat.status-drawer.test.tsx`
Expected: PASS，消息正文仍为中性尺寸，外围控件比例完成修正。

- [ ] **Step 5: 构建前端**

Run: `npm run build --prefix frontend`
Expected: exit 0。

- [ ] **Step 6: 执行针对前端相关用例的回归**

Run: `npm test -- frontend/src/components/Sidebar.skills-nav.test.tsx frontend/src/pages/SkillsAdmin.test.tsx frontend/src/pages/Chat.status-drawer.test.tsx frontend/src/components/Chat/MessageItem.test.tsx frontend/src/pages/Dashboard.test.tsx frontend/src/pages/Users.test.tsx frontend/src/pages/Login.test.tsx`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/Chat.tsx frontend/src/components/Chat/ChatSidebar.tsx frontend/src/components/Chat/MessageInput.tsx frontend/src/components/Chat/MessageItem.tsx frontend/src/pages/Chat.status-drawer.test.tsx frontend/src/components/Chat/MessageItem.test.tsx
git commit -m "feat: refine chat proportions without enlarging message body"
```

## Task 6: 最终验收与手动视觉检查

**Files:**
- Modify: `docs/superpowers/specs/2026-04-13-frontend-ui-proportion-design.md`（仅当实现偏离设计时回填）
- Modify: `docs/superpowers/plans/2026-04-13-frontend-ui-proportion.md`（仅勾选与补充执行备注）

- [x] **Step 1: 执行完整前端构建**

Run: `npm run build --prefix frontend`
Expected: exit 0。

执行备注（2026-04-13）：
已执行 `npm run build --prefix frontend`，退出码 `0`。`tsc -b` 与 `vite build` 均通过，仅保留 Vite 的大包体积 warning，无编译阻塞。

- [x] **Step 2: 执行完整前端相关测试**

Run: `npm test -- frontend/src/components/Sidebar.skills-nav.test.tsx frontend/src/pages/SkillsAdmin.test.tsx frontend/src/pages/Chat.status-drawer.test.tsx frontend/src/components/Chat/MessageItem.test.tsx frontend/src/pages/Dashboard.test.tsx frontend/src/pages/Users.test.tsx frontend/src/pages/Login.test.tsx`
Expected: PASS。

执行备注（2026-04-13）：
首次回归时 `frontend/src/components/Chat/MessageItem.test.tsx` 有 4 个失败用例，根因是 `MessageItem` 未给已完成 thinking 卡片传入 `autoCollapse`，导致测试中的点击操作实际变成折叠。已在 `frontend/src/components/Chat/MessageItem.tsx` 做最小修复并复跑，最终结果为 `7` 个测试文件、`20` 个测试全部通过。

- [x] **Step 3: 启动本地前端进行人工验收**

Run: `npm run dev --prefix frontend`
Expected: 本地可打开页面并检查以下场景：

- `1920x1080 + 100%` 下首页不再偏小
- 知识库、技能、用户页在默认缩放下更稳
- 登录页尺寸与主站协调
- 聊天消息正文未变得臃肿

执行备注（2026-04-13）：
沙箱内直接监听端口会触发 `EPERM`，提权后执行 `timeout 20s npm run dev --prefix frontend -- --host 127.0.0.1 --port 4173`，Vite 成功启动并输出本地地址 `http://127.0.0.1:4173/`。

- [ ] **Step 4: 记录人工验收结论**

在执行记录中明确写明是否满足：

- 管理页已不依赖 `75%` 缩放
- 聊天区消息正文保持中性阅读尺寸
- 无新增水平滚动和主题切换退化

执行备注（2026-04-13）：
当前终端环境只能完成构建、自动化测试和 dev server 启动验证，不能替代浏览器中的肉眼视觉验收。因此以上三项尚待人工打开 `http://127.0.0.1:4173/` 后逐页确认，本步骤暂不勾选。

- [x] **Step 5: 最终提交**

```bash
git add frontend/src docs/superpowers/plans/2026-04-13-frontend-ui-proportion.md
git commit -m "feat: optimize frontend ui proportions for 100 percent zoom"
```

执行备注（2026-04-13）：
最终提交仅暂存并提交本任务明确相关的页面、聊天比例修正文件、对应测试文件与本计划文档，避免把当前工作区中其他未完成前端改动一并打包。Step 4 的人工视觉结论仍需后续浏览器验收补录。
