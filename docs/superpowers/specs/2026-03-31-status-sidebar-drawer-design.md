# Status Sidebar Drawer Design

## Summary

将右侧固定的 StatusSidebar 改为抽屉式（Drawer）交互，默认收起不占用聊天区宽度，点击按钮后从右侧滑出覆盖在聊天区上方。

## Current State

- `StatusSidebar.tsx`：固定 w-72 (288px) 右侧栏，始终渲染
- `Chat.tsx`：三栏布局 `ChatSidebar | ChatArea | StatusSidebar`
- StatusSidebar 在无选中会话时返回 null，有会话时始终占位
- `Chat.tsx` 中 `syncGeneratingState` 已经每 3 秒轮询 `/api/groups/:jid/status` 获取 `isActive` 状态

## Design

### Interaction Model

- **Default (closed):** 右侧栏完全隐藏，聊天区顶栏右侧显示一个状态指示按钮（带颜色点表示运行中/空闲/初始化）
- **Open:** 点击按钮后，抽屉从右侧滑出，Overlay 模式覆盖在聊天区上方
- **Close triggers:** 点击遮罩层 / 抽屉内关闭按钮 / Esc 键

### Animation

- 抽屉: `translateX(100%)` → `translateX(0)`，`300ms ease-out` transition（与 ChatSidebar 折叠动画一致）
- 遮罩层: `opacity: 0` → `opacity: 1`，同步过渡
- 使用 CSS transition（非 JS 动画），保持轻量

### Z-Index Strategy

| Element | z-index | Note |
|---------|---------|------|
| 抽屉遮罩层 | `z-30` | 覆盖聊天区但低于对话框 |
| 抽屉面板 | `z-40` | 在遮罩层之上 |
| ConfirmDialog | `z-50` | 已有，保持不变，始终最上层 |

### Overlay Scope

使用 **`absolute` 定位**，作用域限定在聊天区的 `flex-1` 容器内（Chat.tsx 中间列）。不覆盖左侧 ChatSidebar。聊天区容器需添加 `relative` 定位作为抽屉的定位上下文。

### Component Changes

#### StatusSidebar.tsx

新增 props：
```typescript
interface StatusSidebarProps {
  jid: string | null;
  apiBase: string;
  token: string | null;
  open: boolean;        // NEW
  onClose: () => void;  // NEW
}
```

结构变更：
- 外层包裹 overlay 容器（`absolute inset-0`，相对于聊天区）
- 遮罩层 `bg-black/30` 半透明，点击触发 onClose
- 抽屉面板 `absolute right-0 top-0 bottom-0 w-72`，带阴影
- **关闭时：** `translateX(100%)` + `pointer-events: none`（确保不阻挡底层点击）
- **打开时：** `translateX(0)` + `pointer-events: auto`
- 组件始终渲染（不 unmount），关闭时仅通过 CSS 隐藏
- **移除现有的 early return `if (!jid || !status) return null`**，改为始终渲染外壳容器，内部内容区域条件渲染（status 为 null 时显示加载占位或空状态）
- Esc 键：在 `document` 上监听 `keydown`，`open` 为 true 时调用 onClose（与 ConfirmDialog 模式一致）
- 添加 `role="dialog"` 和 `aria-modal="true"` 到抽屉面板
- 内部内容卡片不变

#### Chat.tsx

- 新增 `statusOpen` state（默认 false）
- 移除 StatusSidebar 的直接渲染位置（原三栏布局第三列），改为放在聊天区 `flex-1` 容器内部
- 聊天区顶栏右侧添加状态触发按钮
- StatusSidebar 接收 `open={statusOpen}` 和 `onClose`

### Deduplicating Status Polling

当前存在两处轮询同一端点的问题：
- `syncGeneratingState`（Chat.tsx）：每 3 秒轮询 `/api/groups/:jid/status`，仅使用 `isActive` 字段
- `StatusSidebar` 内部：每 10 秒轮询同一端点，使用完整状态数据

**方案：不新建 hook，保持简单。**

- `syncGeneratingState` 已返回完整的 status 响应（含 `isActive`, `processReady` 等），目前只用了 `isActive`
- 扩展 `syncGeneratingState`：除了更新 `generatingJids`，同时将完整 status 对象存入新的 `groupStatusMap` state（`Map<jid, GroupStatus>`）
- 触发按钮从 `groupStatusMap` 读取当前 jid 的状态颜色（无需额外请求）
- StatusSidebar 接收 status 作为 prop，移除内部独立轮询
- 这样只有一处轮询（3 秒），消除重复请求

### Status Indicator Button

位置：聊天区顶栏右侧（与删除按钮同行）

样式：
- 一个小型图标按钮，含 Activity icon
- 旁边带 2.5px 圆点指示当前状态颜色（蓝=运行中 / 绿=空闲 / 黄=初始化）
- **加载中（status 尚未获取时）：** 灰色圆点
- hover 时有浅色背景

### Data Flow

```
Chat.tsx
  ├── statusOpen state (boolean)
  ├── groupStatusMap state (Map<jid, GroupStatus>)
  ├── syncGeneratingState → 更新 generatingJids + groupStatusMap
  ├── Status trigger button → 读取 groupStatusMap[jid] 颜色 → onClick: setStatusOpen(true)
  └── StatusSidebar
        ├── open={statusOpen}
        ├── onClose={() => setStatusOpen(false)}
        └── status={groupStatusMap.get(selectedJid)} (从 prop 获取，不再自己轮询)
```

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/StatusSidebar.tsx` | 添加 open/onClose/status props，包裹 overlay + 抽屉动画，移除内部轮询 |
| `frontend/src/pages/Chat.tsx` | 添加 statusOpen + groupStatusMap state，扩展 syncGeneratingState，添加触发按钮 |

不新建文件，改动集中在两个已有文件。

### Edge Cases

- 切换会话时自动收起抽屉（selectedJid 变化 → setStatusOpen(false)）
- 无选中会话时触发按钮不显示
- status 为 null（首次加载）：触发按钮显示灰色点，抽屉内显示加载占位
- 移动端/窄屏：抽屉宽度不变，遮罩确保不影响操作

## Out of Scope

- 抽屉拖拽调整宽度
- 抽屉内容的增减或重新排列
- WebSocket 替代轮询
- Focus trap（当前 ConfirmDialog 也未实现，保持一致）
