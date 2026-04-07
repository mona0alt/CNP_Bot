# Skills 技能卡片优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 Skills 管理页面技能卡片：下方显示 SKILL.md 摘要，单击即打开详情侧栏

**Architecture:** 前端改动，不涉及后端 API。在列表加载时并行预抓取每个 skill 的 SKILL.md 内容，提取前 3 行（最多 150 字符）作为 summary 字段。

**Tech Stack:** React + TypeScript + Tailwind CSS (line-clamp-3)

---

## 文件清单

| 文件 | 动作 | 改动内容 |
|------|------|----------|
| `frontend/src/lib/types.ts` | 修改 | `SkillCatalogItem` 新增 `summary?: string` |
| `frontend/src/pages/SkillsAdmin.tsx` | 修改 | `extractSummary` 函数、`loadSkillsList` 并行预抓取、`onDoubleClick`→`onClick`、卡片渲染 summary |
| `frontend/src/pages/SkillsAdmin.test.tsx` | 修改 | `dblclick` → `click`，新增 SKILL.md fetch mock |
| `frontend/src/pages/SkillsCatalog.tsx` | 修改 | 同上（仅摘要展示，无详情抽屉）|

---

## Task 1: 更新 SkillCatalogItem 类型

**Files:**
- Modify: `frontend/src/lib/types.ts:95-99`

- [ ] **Step 1: 添加 summary 字段**

```typescript
export interface SkillCatalogItem {
  name: string;
  has_skill_md: boolean;
  updated_at: string;
  summary?: string;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat(skills): add optional summary field to SkillCatalogItem"
```

---

## Task 2: 修改 SkillsAdmin 页面

**Files:**
- Modify: `frontend/src/pages/SkillsAdmin.tsx`

### 2.1 添加 extractSummary 辅助函数

在组件外部（file scope）添加：

```typescript
function extractSummary(content: string | null | undefined): string {
  if (!content) return '';
  const lines = content.split('\n').filter(l => l.trim().length > 0).slice(0, 3);
  const text = lines.join(' ').trim();
  return text.length > 150 ? text.slice(0, 147) + '...' : text;
}
```

### 2.2 修改 loadSkillsList 函数

将 `loadSkillsList` 中的 `setSkills(rawSkills)` 改为并行预抓取：

```typescript
const loadSkillsList = useCallback(async () => {
  if (!token) return;
  const endpoint = isAdmin ? "/api/skills" : "/api/skills/catalog";
  const res = await fetch(endpoint, { headers: authHeaders });
  if (res.status === 401 || res.status === 403) {
    await handleUnauthorized();
    return;
  }
  if (!res.ok) {
    throw new Error("加载技能列表失败");
  }
  const data = await res.json();
  const rawSkills: SkillCatalogItem[] = Array.isArray(data) ? data : [];

  // 并行预抓取每个 skill 的 SKILL.md 概要
  const summaryPromises = rawSkills.map(skill =>
    fetch(`${isAdmin ? "/api/skills/file" : "/api/skills/catalog/file"}?path=${encodeURIComponent(skill.name + '/SKILL.md')}`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(data => ({
        name: skill.name,
        has_skill_md: skill.has_skill_md,
        updated_at: skill.updated_at,
        summary: extractSummary(data?.content)
      }))
      .catch(() => ({ ...skill, summary: '' }))
  );
  const skillsWithSummary = await Promise.all(summaryPromises);
  setSkills(skillsWithSummary);
}, [authHeaders, handleUnauthorized, isAdmin, token]);
```

### 2.3 修改卡片渲染

将 `onDoubleClick={() => void handleOpenSkill(skill.name)}` 改为 `onClick={() => void handleOpenSkill(skill.name)}`

将卡片底部文字从：
```tsx
<p className="mt-2 text-xs text-muted-foreground">
  双击进入技能详情
</p>
```
改为：
```tsx
<p className="mt-2 text-xs text-muted-foreground line-clamp-3">
  {skill.summary || '暂无概要'}
</p>
```

### 2.4 修改页面描述文字

将 "双击技能进入详情侧栏" 改为 "单击技能卡片进入详情侧栏"

- [ ] **Step 1: 添加 extractSummary 函数**

在 `SkillsAdmin.tsx` 组件上方添加 `extractSummary` 函数。

- [ ] **Step 2: 修改 loadSkillsList 并行预抓取**

修改 `loadSkillsList` 函数，用 `Promise.all` 并行预抓取所有 summary。

- [ ] **Step 3: 修改卡片 onDoubleClick → onClick**

在卡片 button 元素上，将 `onDoubleClick` 改为 `onClick`。

- [ ] **Step 4: 修改卡片底部文字**

将 "双击进入技能详情" 替换为 `{skill.summary || '暂无概要'}`，并添加 `line-clamp-3` class。

- [ ] **Step 5: 更新页面描述**

将 `p` 文字 "双击技能进入详情侧栏" 改为 "单击技能卡片进入详情侧栏"。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/SkillsAdmin.tsx
git commit -m "feat(skills): show SKILL.md summary on cards and use single-click to open detail"
```

---

## Task 3: 修改 SkillsAdmin 测试文件

**Files:**
- Modify: `frontend/src/pages/SkillsAdmin.test.tsx`

测试文件中所有 `new MouseEvent("dblclick", ...)` 需改为 `new MouseEvent("click", ...)`，共 5 处（lines 89, 138, 276, 331, 362）。

同时，每个测试的 fetch mock 需要新增对 `GET /api/skills/file?path=<name>%2FSKILL.md` 的处理，返回 `{ path, content, editable }` 格式（summary 预抓取需要）。

示例新增 mock 条目（admin 场景）：
```typescript
if (url.includes(`/api/skills/file?path=${encodeURIComponent(skillName + '/SKILL.md')}`)) {
  return createJsonResponse({
    path: `${skillName}/SKILL.md`,
    content: "# Skill Summary\n\nLine 2\nLine 3",
    editable: true,
  });
}
```

user 场景测试同理，新增 `/api/skills/catalog/file?path=prometheus%2FSKILL.md` 的 mock 返回。

- [ ] **Step 1: 将所有 dblclick 事件改为 click**

将 lines 89, 138, 276, 331, 362 的 `new MouseEvent("dblclick", { bubbles: true })` 改为 `new MouseEvent("click", { bubbles: true })`。

- [ ] **Step 2: 为每个测试的 fetch mock 添加 SKILL.md 文件返回**

每个测试的 fetch mock 函数中，在现有 URL 判断之后、throw 之前，新增对 SKILL.md 文件的 mock 返回。

- [ ] **Step 3: 运行测试验证**

```bash
npm test -- --run frontend/src/pages/SkillsAdmin.test.tsx 2>&1
```

预期：所有 SkillsAdmin 测试通过。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/SkillsAdmin.test.tsx
git commit -m "test(skills): update dblclick to click in SkillsAdmin tests"
```

---

## Task 4: 修改 SkillsCatalog 页面

**Scope：** SkillsCatalog 为只读浏览页，仅优化卡片摘要展示，不添加单击打开详情侧栏功能。

**Files:**
- Modify: `frontend/src/pages/SkillsCatalog.tsx`

### 4.1 添加 extractSummary 函数（与 Task 2 相同）

### 4.2 修改 loadCatalog 函数

将 `setSkills(Array.isArray(data) ? data : [])` 改为并行预抓取：

```typescript
const loadCatalog = useCallback(async () => {
  if (!token) return;

  setError("");
  try {
    const res = await fetch("/api/skills/catalog", { headers: authHeaders });
    if (res.status === 401 || res.status === 403) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      throw new Error("加载技能目录失败");
    }
    const data = await res.json();
    const rawSkills: SkillCatalogItem[] = Array.isArray(data) ? data : [];

    // 并行预抓取每个 skill 的 SKILL.md 概要
    const summaryPromises = rawSkills.map(skill =>
      fetch(`/api/skills/catalog/file?path=${encodeURIComponent(skill.name + '/SKILL.md')}`, { headers: authHeaders })
        .then(r => r.ok ? r.json() : null)
        .then(data => ({
          name: skill.name,
          has_skill_md: skill.has_skill_md,
          updated_at: skill.updated_at,
          summary: extractSummary(data?.content)
        }))
        .catch(() => ({ ...skill, summary: '' }))
    );
    const skillsWithSummary = await Promise.all(summaryPromises);
    setSkills(skillsWithSummary);
  } catch (err) {
    setError(err instanceof Error ? err.message : "加载技能目录失败");
  } finally {
    setIsLoading(false);
  }
}, [authHeaders, handleUnauthorized, token]);
```

### 4.3 修改 SkillMarkdownPreview 调用

将 `content` prop 从：
```tsx
content={`# ${skill.name}\n\n- 包含 SKILL.md: ${skill.has_skill_md ? "是" : "否"}\n- 仅支持只读浏览\n- 可在会话创建和会话设置中启用`}
```
改为使用 summary：
```tsx
content={skill.summary ? `# ${skill.name}\n\n${skill.summary}` : `# ${skill.name}\n\n暂无概要`}
```

- [ ] **Step 1: 添加 extractSummary 函数**

- [ ] **Step 2: 修改 loadCatalog 并行预抓取**

- [ ] **Step 3: 修改 SkillMarkdownPreview 的 content prop**

- [ ] **Step 4: 运行测试验证**

```bash
npm test -- --run 2>&1 | grep -E "(PASS|FAIL|skips)"
```

预期：所有测试通过（SkillsCatalog 无独立测试文件）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/SkillsCatalog.tsx
git commit -m "feat(skills catalog): show SKILL.md summary on cards"
```

---

## 验证步骤

完成所有 Task 后，运行以下验证：

```bash
npm test 2>&1 | tail -20
```

预期：所有测试通过。
