# Skills 管理与会话绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为项目实现基于文件系统的全局 skills 库管理、普通用户只读技能目录浏览，以及 Web 会话级 skills 选择与同步。

**Architecture:** 后端以 `data/skills/global/` 作为全局库真源，新增文件系统服务负责目录浏览、文件编辑、zip 导入与路径安全校验；数据库只保存 `web:*` 会话与 skill 的绑定关系及同步状态。前端新增管理员技能管理页、普通用户只读目录页，并在聊天页扩展新建会话与会话设置的 skills 选择入口。

**Tech Stack:** Node.js, Express, better-sqlite3, TypeScript, React 19, Vite, Vitest, Tailwind CSS, `multer`, `unzipper`

**Spec:** `docs/superpowers/specs/2026-04-03-skills-management-design.md`

---

### Task 1: 建立数据库 schema 与后端类型

先把会话绑定与同步状态的持久化能力落到 `src/db.ts`，并用现有 `db.test.ts` 扩展覆盖 CRUD 与清理语义。

**Files:**
- Modify: `package.json`
- Modify: `src/db.ts`
- Modify: `src/types.ts`
- Modify: `src/db.test.ts`

- [ ] **Step 1: 写失败测试，覆盖会话 skill 绑定与同步状态**

在 `src/db.test.ts` 新增用例，最少覆盖：

```ts
it('stores and replaces session skill bindings', () => {
  replaceSessionSkillBindings('web:test', ['tmux', 'prometheus']);
  expect(getSessionSkillBindings('web:test')).toEqual(['prometheus', 'tmux']);
  replaceSessionSkillBindings('web:test', ['jumpserver']);
  expect(getSessionSkillBindings('web:test')).toEqual(['jumpserver']);
});

it('stores sync state and clears skill data when chat is deleted', () => {
  replaceSessionSkillBindings('web:test', ['tmux']);
  setSessionSkillSyncState('web:test', {
    status: 'failed',
    errorMessage: 'copy failed',
  });
  deleteSessionSkillData('web:test');
  expect(getSessionSkillBindings('web:test')).toEqual([]);
  expect(getSessionSkillSyncState('web:test')).toBeNull();
});
```

- [ ] **Step 2: 运行单测确认失败**

Run: `npm test -- src/db.test.ts`
Expected: FAIL，提示 `replaceSessionSkillBindings` / `getSessionSkillSyncState` 等接口不存在。

- [ ] **Step 3: 在 `src/types.ts` 增加同步状态类型**

加入最小类型定义：

```ts
export type SessionSkillSyncStatus = 'pending' | 'synced' | 'failed';

export interface SessionSkillSyncState {
  chat_jid: string;
  status: SessionSkillSyncStatus;
  last_synced_at: string | null;
  error_message: string | null;
  updated_at: string;
}
```

- [ ] **Step 4: 在 `src/db.ts` 增加表结构与访问器**

在 `createSchema()` 中新增两张表：

```sql
CREATE TABLE IF NOT EXISTS session_skill_bindings (
  chat_jid TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chat_jid, skill_name)
);

CREATE TABLE IF NOT EXISTS session_skill_sync_state (
  chat_jid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_synced_at TEXT,
  error_message TEXT,
  updated_at TEXT NOT NULL
);
```

并新增以下 helper：

```ts
export function getSessionSkillBindings(chatJid: string): string[];
export function replaceSessionSkillBindings(chatJid: string, skills: string[]): void;
export function getSessionSkillSyncState(chatJid: string): SessionSkillSyncState | null;
export function setSessionSkillSyncState(
  chatJid: string,
  input: { status: SessionSkillSyncStatus; lastSyncedAt?: string | null; errorMessage?: string | null },
): void;
export function deleteSessionSkillData(chatJid: string): void;
```

实现要求：
- `replaceSessionSkillBindings()` 先删后插，统一更新时间
- 返回的 skill 名称按字母序排序，避免测试不稳定
- `deleteSessionSkillData()` 同时清理 bindings 和 sync state

- [ ] **Step 5: 重新运行数据库单测**

Run: `npm test -- src/db.test.ts`
Expected: PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add package.json src/db.ts src/types.ts src/db.test.ts package-lock.json
git commit -m "feat: add session skill binding persistence"
```

---

### Task 2: 实现全局 skills 文件系统服务

把全局库路径、安全校验、目录树、文本文件读写、新建/删除/移动等能力集中到一个服务文件，避免这些逻辑散落到 `server.ts`。

**Files:**
- Create: `src/skills-store.ts`
- Create: `src/skills-store.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: 先写文件系统服务测试**

在 `src/skills-store.test.ts` 建临时目录，覆盖：

```ts
it('lists only top-level skill directories containing SKILL.md', () => {});
it('returns a tree for a specific skill', () => {});
it('reads and writes text files under the root', () => {});
it('creates files and directories', () => {});
it('renames and moves entries within the root', () => {});
it('rejects path traversal outside the skills root', () => {});
it('marks binary files as non-editable', () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/skills-store.test.ts`
Expected: FAIL，提示 `src/skills-store.ts` 不存在。

- [ ] **Step 3: 在 `src/config.ts` 暴露 skills 根目录常量**

加入：

```ts
export const SKILLS_DIR = path.join(DATA_DIR, 'skills');
export const GLOBAL_SKILLS_DIR = path.join(SKILLS_DIR, 'global');
export const SESSION_SKILLS_DIR = path.join(SKILLS_DIR, 'sessions');
```

- [ ] **Step 4: 创建 `src/skills-store.ts` 并实现公共接口**

最小接口建议：

```ts
export interface SkillListItem {
  name: string;
  hasSkillMd: boolean;
  updatedAt: string;
}

export interface SkillTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillTreeNode[];
  editable?: boolean;
}

export function listGlobalSkills(rootDir?: string): SkillListItem[];
export function getGlobalSkillTree(options?: { skill?: string; rootDir?: string }): SkillTreeNode[];
export function readGlobalSkillFile(relativePath: string, rootDir?: string): { path: string; content: string; editable: boolean };
export function writeGlobalSkillFile(relativePath: string, content: string, rootDir?: string): void;
export function createGlobalSkillEntry(input: { parentPath: string; name: string; type: 'file' | 'directory' }, rootDir?: string): string;
export function moveGlobalSkillEntry(fromPath: string, toPath: string, rootDir?: string): void;
export function deleteGlobalSkillEntry(relativePath: string, rootDir?: string): void;
```

实现要求：
- 统一使用 `resolve + relative` 做 containment 校验
- 文本/二进制判定用简单 buffer 检测，不新增额外依赖
- `listGlobalSkills()` 只返回顶层且包含 `SKILL.md` 的目录
- `moveGlobalSkillEntry()` 暂不负责顶层联动，留给上层 orchestrator

- [ ] **Step 5: 跑测试修正实现**

Run: `npm test -- src/skills-store.test.ts`
Expected: PASS

- [ ] **Step 6: 提交文件系统服务**

```bash
git add src/config.ts src/skills-store.ts src/skills-store.test.ts
git commit -m "feat: add global skills filesystem store"
```

---

### Task 3: 实现 zip 导入与顶层 skill 目录联动服务

把 zip 解压、结构校验、同名冲突，以及顶层 skill 重命名/删除后的绑定联动，收敛到单独服务，避免 `server.ts` 直接写复杂业务。

**Files:**
- Modify: `package.json`
- Create: `src/skills-admin-service.ts`
- Create: `src/skills-admin-service.test.ts`
- Modify: `src/db.ts`

- [ ] **Step 1: 加失败测试覆盖 zip 导入与顶层目录联动**

在 `src/skills-admin-service.test.ts` 写用例：

```ts
it('imports a zip containing one top-level skill with SKILL.md', async () => {});
it('rejects zips missing SKILL.md', async () => {});
it('rejects duplicate top-level skill names', async () => {});
it('renames a top-level skill and updates session bindings', () => {});
it('deletes a top-level skill and removes affected bindings', () => {});
```

- [ ] **Step 2: 安装 multipart 与 zip 依赖**

Add:

```json
"dependencies": {
  "multer": "^2.0.2",
  "unzipper": "^0.12.3"
},
"devDependencies": {
  "@types/multer": "^2.0.0"
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/skills-admin-service.test.ts`
Expected: FAIL，缺少服务文件或依赖。

- [ ] **Step 4: 创建 `src/skills-admin-service.ts`**

暴露的编排接口建议：

```ts
export async function importGlobalSkillZip(input: {
  zipPath: string;
  globalRootDir?: string;
}): Promise<{ skillName: string }>;

export function renameGlobalSkillAndRebind(input: {
  fromPath: string;
  toPath: string;
  globalRootDir?: string;
  isChatActive?: (chatJid: string) => boolean;
  syncChatSkills?: (chatJid: string) => Promise<void>;
}): Promise<void>;

export function deleteGlobalSkillAndRebind(input: {
  relativePath: string;
  globalRootDir?: string;
  isChatActive?: (chatJid: string) => boolean;
  syncChatSkills?: (chatJid: string) => Promise<void>;
}): Promise<void>;
```

实现要求：
- zip 先解到 `mkdtemp()` 临时目录
- 只接受“一个顶层 skill 目录 + 存在 `SKILL.md`”
- 命名冲突直接报错
- 顶层目录改名后要更新 `session_skill_bindings.skill_name`
- 顶层目录删除后要移除受影响绑定
- 联动失败时不要留下半完成状态

- [ ] **Step 5: 为 `src/db.ts` 补充按 skill 查询/批量更新 helper**

最少新增：

```ts
export function getChatJidsBoundToSkill(skillName: string): string[];
export function renameBoundSkill(oldName: string, newName: string): void;
export function removeSkillFromAllChats(skillName: string): string[];
```

- [ ] **Step 6: 跑服务层测试**

Run: `npm test -- src/skills-admin-service.test.ts`
Expected: PASS

- [ ] **Step 7: 提交 zip 与联动服务**

```bash
git add package.json package-lock.json src/db.ts src/skills-admin-service.ts src/skills-admin-service.test.ts
git commit -m "feat: add skill zip import and top-level rename orchestration"
```

---

### Task 4: 暴露后端 API，并补 server 级测试

把全局库管理、只读目录、会话绑定接口全部接到 `server.ts`，并用现有风格新增 API 集成测试。

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server-create-chat.test.ts`
- Create: `src/server-skills.test.ts`

- [ ] **Step 1: 先写 `server-skills.test.ts`**

覆盖以下路径：

```ts
it('allows admin to list skills', async () => {});
it('forbids non-admin from mutating global skills', async () => {});
it('returns file content for admin viewer', async () => {});
it('allows a user to read the catalog', async () => {});
it('allows a user to replace skills for an owned web chat', async () => {});
it('rejects replacing skills for another users chat', async () => {});
it('returns sync state with chat skill bindings', async () => {});
```

- [ ] **Step 2: 扩展 `ServerOpts`，给运行时同步留注入点**

在 `src/server.ts` 的 `ServerOpts` 增加：

```ts
onChatSkillsUpdated?: (jid: string) => Promise<{ status: 'pending' | 'synced' | 'failed'; errorMessage?: string }>;
```

这样 `server.ts` 不直接依赖 `index.ts` 的队列实现。

- [ ] **Step 3: 为 `/api/chats` 创建接口增加 `skills` 字段校验**

在 `POST /api/chats` 请求体验证中加入：

```ts
skills: z.array(z.string().min(1)).optional()
```

并在创建成功后：
- 调 `replaceSessionSkillBindings(jid, skills ?? [])`
- 默认写 `pending` 或在 `onCreateChat` 后触发首次同步

- [ ] **Step 4: 在 `server.ts` 增加 skills API**

按 spec 实现：
- `GET /api/skills`
- `GET /api/skills/tree`
- `GET /api/skills/file`
- `PUT /api/skills/file`
- `POST /api/skills/fs`
- `PATCH /api/skills/fs`
- `DELETE /api/skills/fs`
- `POST /api/skills/upload-zip`
- `GET /api/skills/catalog`
- `GET /api/chats/:jid/skills`
- `PUT /api/chats/:jid/skills`
- `POST /api/chats/:jid/skills/sync`

要求：
- 管理端全部 `requireAdmin`
- 用户端通过 `canAccessChat()` 校验
- 错误码区分 400 / 403 / 404 / 409

- [ ] **Step 5: 更新 `src/server-create-chat.test.ts`**

新增一个 case，确保初始创建会话时会透传 `skills`：

```ts
it('accepts initial skills during chat creation', async () => {
  const res = await fetch(..., {
    body: JSON.stringify({ agentType: 'deepagent', skills: ['tmux'] }),
  });
  expect(res.status).toBe(201);
  expect(getSessionSkillBindings(createdJid)).toEqual(['tmux']);
});
```

- [ ] **Step 6: 跑 server 相关测试**

Run: `npm test -- src/server-create-chat.test.ts src/server-skills.test.ts`
Expected: PASS

- [ ] **Step 7: 提交 API 层**

```bash
git add src/server.ts src/server-create-chat.test.ts src/server-skills.test.ts
git commit -m "feat: add skills management and chat binding api"
```

---

### Task 5: 接入运行时同步与会话删除清理

把 API 层保存的绑定关系真正接到 Web 会话生命周期里：创建、运行中保存、启动时补同步、删除时清理目录。

**Files:**
- Create: `src/chat-skills-sync.ts`
- Create: `src/chat-skills-sync.test.ts`
- Modify: `src/index.ts`
- Modify: `src/db.ts`

- [ ] **Step 1: 为同步编排先写测试**

在 `src/chat-skills-sync.test.ts` 覆盖：

```ts
it('copies all selected global skills into the session active directory', async () => {});
it('marks sync failed when a selected skill is missing', async () => {});
it('clears old active files before re-sync', async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/chat-skills-sync.test.ts`
Expected: FAIL，缺少同步服务文件。

- [ ] **Step 3: 创建 `src/chat-skills-sync.ts`**

最小接口建议：

```ts
export async function syncChatSkills(input: {
  chatJid: string;
  globalRootDir?: string;
  sessionRootDir?: string;
}): Promise<{ status: 'synced' | 'failed'; errorMessage?: string }>;

export function getChatActiveSkillsDir(chatJid: string, sessionRootDir?: string): string;
export function deleteChatSkillsDir(chatJid: string, sessionRootDir?: string): void;
```

实现要求：
- 从 `getSessionSkillBindings(chatJid)` 取绑定列表
- 先删除 `active/` 再整目录复制
- 成功写 `synced`，失败写 `failed`

- [ ] **Step 4: 在 `src/index.ts` 注入同步时机**

接入点：
- `onCreateChat`: 如果传入初始 skills，则创建后写 `pending`
- `onChatSkillsUpdated`: 若 `queue.isGroupBusy(jid)` 为真，立即 `await syncChatSkills`
- Web 会话启动前或首次处理消息前：若状态是 `pending`，先执行一次同步
- `onDeleteChat`: 增加 `deleteSessionSkillData(jid)` 和 `deleteChatSkillsDir(jid)`

可以在 `index.ts` 新建一个局部 helper：

```ts
async function syncChatSkillsIfNeeded(jid: string): Promise<{ status: 'pending' | 'synced' | 'failed'; errorMessage?: string }> { ... }
```

- [ ] **Step 5: 为 `onDeleteChat` 清理链路补测试**

在现有 `src/db.test.ts` 或新增 `src/index` 侧测试中确认：
- 删除聊天后 DB 绑定关系被清理
- 对应会话目录被删除

- [ ] **Step 6: 跑同步相关测试**

Run: `npm test -- src/chat-skills-sync.test.ts src/db.test.ts`
Expected: PASS

- [ ] **Step 7: 提交运行时同步**

```bash
git add src/chat-skills-sync.ts src/chat-skills-sync.test.ts src/index.ts src/db.ts src/db.test.ts
git commit -m "feat: sync selected skills into active web chat sessions"
```

---

### Task 6: 建立前端类型、路由与导航骨架

先把前端的类型、路由、侧边栏入口和 API 读取类型铺好，再分管理员页和聊天页分别实现。

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/pages/SkillsAdmin.tsx`
- Create: `frontend/src/pages/SkillsCatalog.tsx`

- [ ] **Step 1: 先写轻量路由渲染测试**

可在新的前端测试里断言：

```ts
it('shows the admin skills route in sidebar for admins', () => {});
it('hides the admin skills route for normal users', () => {});
```

如果没有合适现成文件，放到后续 `frontend/src/pages/SkillsAdmin.test.tsx` 一起覆盖。

- [ ] **Step 2: 扩展 `frontend/src/lib/types.ts`**

新增：

```ts
export interface SkillCatalogItem {
  name: string;
  has_skill_md: boolean;
  updated_at: string;
}

export interface SkillTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillTreeNode[];
  editable?: boolean;
}

export interface ChatSkillSelectionResponse {
  selectedSkills: string[];
  syncStatus: 'pending' | 'synced' | 'failed';
  lastSyncedAt: string | null;
  errorMessage: string | null;
}
```

- [ ] **Step 3: 在 `App.tsx` 增加路由**

增加：
- 管理员页 `/skills`
- 只读页 `/skills/catalog`

并让 `/skills` 走 `AdminRoute`，`/skills/catalog` 走 `ProtectedRoute`。

- [ ] **Step 4: 为两个新页面加入最小占位组件，确保中间态可编译**

在 `frontend/src/pages/SkillsAdmin.tsx` 和 `frontend/src/pages/SkillsCatalog.tsx` 先放最小可渲染占位实现：

```tsx
export function SkillsAdmin() {
  return <div className="p-6">Skills 管理页建设中</div>;
}

export function SkillsCatalog() {
  return <div className="p-6">Skills 目录页建设中</div>;
}
```

- [ ] **Step 5: 在 `Sidebar.tsx` 与 `Dashboard.tsx` 增加入口**

侧边栏：
- `admin` 用户看到“技能管理”链接 `/skills`
- 所有用户看到“技能目录”链接 `/skills/catalog`

Dashboard：
- 保持风格一致，加一个跳转到只读目录或技能管理的快捷入口

- [ ] **Step 6: 运行前端类型检查**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 7: 提交路由骨架**

```bash
git add frontend/src/lib/types.ts frontend/src/App.tsx frontend/src/components/Sidebar.tsx frontend/src/pages/Dashboard.tsx frontend/src/pages/SkillsAdmin.tsx frontend/src/pages/SkillsCatalog.tsx
git commit -m "feat: add frontend routes and nav entries for skills"
```

---

### Task 7: 实现管理员技能管理页与用户只读目录页

这一任务负责两个页面，但共享大部分只读浏览逻辑与目录树状态，可一起落地。

**Files:**
- Modify: `frontend/src/pages/SkillsAdmin.tsx`
- Modify: `frontend/src/pages/SkillsCatalog.tsx`
- Create: `frontend/src/pages/SkillsAdmin.test.tsx`
- Create: `frontend/src/components/skills/SkillTree.tsx`
- Create: `frontend/src/components/skills/SkillFileEditor.tsx`
- Create: `frontend/src/components/skills/ZipUploadDialog.tsx`
- Create: `frontend/src/components/skills/SkillMarkdownPreview.tsx`

- [ ] **Step 1: 先写页面测试**

在 `frontend/src/pages/SkillsAdmin.test.tsx` 覆盖：

```tsx
it('loads and renders the admin skills tree', async () => {});
it('opens a text file and saves edits', async () => {});
it('shows upload validation errors from the api', async () => {});
it('renders a read-only catalog preview for normal users', async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/pages/SkillsAdmin.test.tsx`
Expected: FAIL，组件不存在。

- [ ] **Step 3: 先搭共用组件**

建议组件职责：
- `SkillTree.tsx`: 目录树展示与节点选择
- `SkillFileEditor.tsx`: 文本文件编辑、保存、未保存提示
- `SkillMarkdownPreview.tsx`: 渲染 `SKILL.md`
- `ZipUploadDialog.tsx`: 上传 zip 并显示失败原因

- [ ] **Step 4: 实现 `SkillsAdmin.tsx`**

要求：
- 首屏拉取 `/api/skills` 与 `/api/skills/tree`
- 选中文本文件时调用 `/api/skills/file`
- 保存调用 `PUT /api/skills/file`
- 新建/移动/删除调用 `/api/skills/fs`
- zip 上传使用 `FormData` 提交到 `/api/skills/upload-zip`
- 切换未保存节点前弹确认

- [ ] **Step 5: 实现 `SkillsCatalog.tsx`**

要求：
- 只调用只读接口 `/api/skills/catalog`
- 卡片展示 name、更新时间、`SKILL.md` 预览
- 不出现任何编辑按钮或文件操作入口

- [ ] **Step 6: 跑前端页面测试**

Run: `cd frontend && npx vitest run src/pages/SkillsAdmin.test.tsx`
Expected: PASS

- [ ] **Step 7: 跑前端构建**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 8: 提交页面实现**

```bash
git add frontend/src/pages/SkillsAdmin.tsx frontend/src/pages/SkillsCatalog.tsx frontend/src/pages/SkillsAdmin.test.tsx frontend/src/components/skills
git commit -m "feat: add admin and catalog skills pages"
```

---

### Task 8: 在聊天页实现新建会话初始选择与会话设置修改

这一步把用户主流程接起来：创建会话时选 skills，创建后还能在聊天页继续改。

**Files:**
- Modify: `frontend/src/pages/Chat.tsx`
- Modify: `frontend/src/components/Chat/ChatSidebar.tsx`
- Create: `frontend/src/components/skills/ChatSkillsDialog.tsx`
- Modify: `frontend/src/pages/Chat.integration.test.tsx`

- [ ] **Step 1: 先在集成测试里写用户流**

在 `frontend/src/pages/Chat.integration.test.tsx` 新增：

```tsx
it('creates a chat with initial selected skills', async () => {});
it('loads current chat skills and saves updated selections', async () => {});
it('shows sync status after saving chat skills', async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/pages/Chat.integration.test.tsx`
Expected: FAIL，缺少 UI 与 fetch mocks 适配。

- [ ] **Step 3: 新建 `ChatSkillsDialog.tsx`**

职责：
- 拉取 `/api/skills/catalog`
- 拉取 `/api/chats/:jid/skills`
- 多选技能
- 显示选中 skill 的 `SKILL.md` 预览
- 保存到 `PUT /api/chats/:jid/skills`

- [ ] **Step 4: 扩展 `ChatSidebar.tsx` 的新建会话入口**

把现有 “选择 Agent 类型” 流程扩展为：
- 先选 Agent 类型
- 再打开 skills 选择弹窗
- 允许“无 skills”直接创建

`onCreateChat` 签名改为：

```ts
onCreateChat: (input?: {
  agentType?: 'claude' | 'deepagent';
  skills?: string[];
}) => void;
```

- [ ] **Step 5: 在 `Chat.tsx` 接入创建与编辑逻辑**

最小改动：
- `createChatSession()` body 改为 `{ agentType, skills }`
- 新增当前会话 skills dialog 打开状态
- 在聊天顶部或状态按钮附近增加 “Skills” 入口
- 保存后显示 `pending / synced / failed` 状态文案

- [ ] **Step 6: 重跑聊天集成测试**

Run: `cd frontend && npx vitest run src/pages/Chat.integration.test.tsx`
Expected: PASS

- [ ] **Step 7: 跑完整前端构建**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 8: 提交聊天集成**

```bash
git add frontend/src/pages/Chat.tsx frontend/src/components/Chat/ChatSidebar.tsx frontend/src/components/skills/ChatSkillsDialog.tsx frontend/src/pages/Chat.integration.test.tsx
git commit -m "feat: add chat-level skill selection and sync status ui"
```

---

### Task 9: 全量验证与收尾

最后把后端、前端和关键测试一起跑通，确认没有遗漏文档或依赖问题。

**Files:**
- Modify: `README.md`（如需补充）
- Modify: `README_zh.md`（如需补充）

- [ ] **Step 1: 跑后端定向测试**

Run:

```bash
npm test -- src/db.test.ts src/skills-store.test.ts src/skills-admin-service.test.ts src/chat-skills-sync.test.ts src/server-create-chat.test.ts src/server-skills.test.ts
```

Expected: PASS

- [ ] **Step 2: 跑前端测试**

Run:

```bash
cd frontend && npx vitest run src/pages/SkillsAdmin.test.tsx src/pages/Chat.integration.test.tsx
```

Expected: PASS

- [ ] **Step 3: 跑类型与构建验证**

Run:

```bash
npm run typecheck
cd frontend && npm run build
```

Expected: PASS

- [ ] **Step 4: 补 README 中的最小使用说明**

如果本项目 README 已记录主要 Web 能力，补充：
- 管理员如何上传与管理全局 skills
- 用户如何在 Web 会话中启用 skills

- [ ] **Step 5: 提交收尾**

```bash
git add README.md README_zh.md
git commit -m "docs: document skills management workflow"
```
