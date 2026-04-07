# Skills 技能卡片优化设计

**日期：** 2026-04-07

**目标：** 优化 Skills 管理页面技能卡片的展示与交互

**范围：**
- `SkillsAdmin` 页面（`/skills`）
- `SkillsCatalog` 页面（`/skills/catalog`）

**非目标：**
- 不改后端 API
- 不改详情侧栏交互逻辑

## 1. 需求

1. **技能概要展示**：卡片下方显示该技能的 SKILL.md 内容预览（前 3 行，最多 150 字符）
2. **单击打开详情**：将原来的双击交互改为单击即打开技能详情侧栏

## 2. 方案

### 2.1 数据层

`SkillCatalogItem` 类型扩展，新增 `summary` 字段：

```typescript
export interface SkillCatalogItem {
  name: string;
  has_skill_md: boolean;
  updated_at: string;
  summary?: string; // 新增：SKILL.md 前 3 行预览
}
```

### 2.2 SkillsAdmin 页面

**辅助函数：**

```typescript
function extractSummary(content: string | null | undefined): string {
  if (!content) return '';
  const lines = content.split('\n').filter(l => l.trim().length > 0).slice(0, 3);
  const text = lines.join(' ').trim();
  return text.length > 150 ? text.slice(0, 147) + '...' : text;
}
```

**列表加载时并行预抓取：**

```typescript
// 加载技能列表后，为每个 skill 并行获取 SKILL.md 前 3 行
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

**卡片渲染：**

```tsx
<button
  key={skill.name}
  type="button"
  onClick={() => void handleOpenSkill(skill.name)}
  className="..."
>
  <div className="flex items-center justify-between gap-2">
    <span className="font-semibold">{skill.name}</span>
    <span className="text-xs text-muted-foreground">
      {new Date(skill.updated_at).toLocaleDateString()}
    </span>
  </div>
  <p className="mt-2 text-xs text-muted-foreground line-clamp-3">
    {skill.summary || '暂无概要'}
  </p>
</button>
```

**Accessibility：** 按钮支持键盘操作（Enter/Space），单 click 打开详情无障碍。

### 2.3 SkillsCatalog 页面

同样优化，`onClick` 打开详情（只读模式）。

## 3. UI 变更

| 元素 | 变更前 | 变更后 |
|------|--------|--------|
| 卡片底部文字 | "双击进入技能详情" | SKILL.md 预览（line-clamp-3，最多 150 字符） |
| 触发方式 | onDoubleClick | onClick |
| 提示文字 | 移至悬停 tooltip | 无需额外提示 |

## 4. 错误处理

- 获取 SKILL.md 失败时：`summary` 为空字符串，卡片显示"暂无概要"，页面不崩溃
- 技能无 SKILL.md 时：`summary` 为空，显示"暂无概要"

## 5. 测试要点

1. 列表正常加载且每个卡片显示 summary
2. 单击卡片打开详情侧栏
3. 获取 SKILL.md 失败时页面不崩溃
4. SkillsCatalog 页面同样正常
