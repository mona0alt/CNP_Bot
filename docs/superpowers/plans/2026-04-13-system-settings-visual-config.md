# System Settings Visual Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为管理员实现一个真实可用的系统设置页，覆盖全部系统级配置的可视化查看、编辑、保存与服务重启。

**Architecture:** 后端新增基于 Schema 的系统配置模块，以 `.env` 为唯一真源，统一负责字段元数据、读取、校验、写回与重启状态管理；前端把现有静态 `Settings` 页面改造成由后端 Schema 驱动的通用配置页，并补齐敏感字段交互、危险确认与“保存并重启”流程。

**Tech Stack:** Node.js, Express, TypeScript, React 19, Vite, Vitest, Tailwind CSS, JWT auth, filesystem `.env` persistence

**Spec:** `docs/superpowers/specs/2026-04-13-system-settings-visual-config-design.md`

---

### Task 1: 建立系统配置 Schema 与后端字段类型

先把“哪些配置能编辑、如何渲染、如何校验、哪些是敏感项”收敛到单一来源，避免后续前后端重复维护字段定义。

**Files:**
- Create: `src/system-config-schema.ts`
- Test: `src/system-config-schema.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: 写失败测试，锁定字段范围与元数据结构**

在 `src/system-config-schema.test.ts` 新增用例，至少覆盖：

```ts
it('includes every editable system config key from config.ts', () => {
  expect(listSystemConfigFields().map(field => field.key)).toEqual([
    'ASSISTANT_NAME',
    'ASSISTANT_HAS_OWN_NUMBER',
    'USE_LOCAL_AGENT',
    'DEFAULT_AGENT_TYPE',
    'DEEP_AGENT_MODEL',
    'DEEP_AGENT_RUNNER_PATH',
    'DEEP_AGENT_PYTHON',
    'CONTAINER_IMAGE',
    'CONTAINER_TIMEOUT',
    'CONTAINER_MAX_OUTPUT_SIZE',
    'IDLE_TIMEOUT',
    'MAX_CONCURRENT_CONTAINERS',
    'TIMEZONE',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'KB_API_URL',
    'KB_API_KEY',
    'KB_API_ACCOUNT',
    'KB_API_USER',
    'KB_API_AGENT_ID',
    'KB_ROOT_URI',
    'KB_INJECT_LIMIT',
    'KB_SEARCH_TIMEOUT',
    'KB_EXTRACT_TIMEOUT',
    'KB_SUMMARY_LLM_API_URL',
    'KB_SUMMARY_LLM_API_KEY',
    'KB_SUMMARY_LLM_MODEL',
    'KB_SUMMARY_LLM_TIMEOUT',
  ]);
});

it('marks secret and danger fields correctly', () => {
  const jwt = getSystemConfigField('JWT_SECRET');
  expect(jwt.secret).toBe(true);
  expect(jwt.dangerLevel).toBe('danger');
});
```

- [ ] **Step 2: 运行单测确认失败**

Run: `npm test -- src/system-config-schema.test.ts`
Expected: FAIL，提示 `src/system-config-schema.ts` 或对应导出不存在。

- [ ] **Step 3: 创建系统配置 Schema 模块**

在 `src/system-config-schema.ts` 实现最小结构：

```ts
export type SystemConfigFieldType = 'text' | 'number' | 'toggle' | 'select' | 'secret';

export interface SystemConfigField {
  key: string;
  section: string;
  label: string;
  description?: string;
  type: SystemConfigFieldType;
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  defaultValue?: string;
  options?: Array<{ label: string; value: string }>;
  dangerLevel?: 'normal' | 'warning' | 'danger';
  dangerMessage?: string;
}

export function listSystemConfigFields(): SystemConfigField[] {}
export function getSystemConfigField(key: string): SystemConfigField | undefined {}
export function listSystemConfigSections(): Array<{ id: string; title: string }> {}
```

实现要求：
- 完整覆盖 spec 中定义的 28 个可编辑 key
- `JWT_SECRET`、`KB_API_KEY`、`KB_SUMMARY_LLM_API_KEY` 标记为 `secret`
- `JWT_SECRET` 标记为 `danger`
- `DEFAULT_AGENT_TYPE` 使用 `select`
- 布尔值使用 `toggle`
- 超时、并发、大小限制使用 `number`

- [ ] **Step 4: 对照 `src/config.ts` 做字段注释整理**

仅补充必要注释或导出说明，确保 `config.ts` 与 Schema 的语义一致，不在 `config.ts` 内复制一份元数据。

- [ ] **Step 5: 重新运行 Schema 单测**

Run: `npm test -- src/system-config-schema.test.ts`
Expected: PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add src/system-config-schema.ts src/system-config-schema.test.ts src/config.ts
git commit -m "feat: add system config schema metadata"
```

---

### Task 2: 实现 `.env` 读取、校验与原子写回服务

把系统配置值的加载、类型转换、字段校验、未知行保留和原子写回集中到单独服务，不把这些逻辑散落进 `server.ts`。

**Files:**
- Create: `src/system-config-service.ts`
- Test: `src/system-config-service.test.ts`
- Modify: `src/env.ts`

- [ ] **Step 1: 写失败测试覆盖 `.env` 读写与校验行为**

在 `src/system-config-service.test.ts` 写最小用例：

```ts
it('loads current values from .env using schema defaults', () => {});
it('preserves unknown env lines and comments when saving', () => {});
it('rejects missing required values', () => {});
it('rejects invalid numbers and invalid select values', () => {});
it('allows saving secret fields and empty optional values', () => {});
it('returns changed keys and restartRequired flag', () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/system-config-service.test.ts`
Expected: FAIL，提示服务文件不存在或导出不存在。

- [ ] **Step 3: 在 `src/env.ts` 提取通用 `.env` 文本读取能力**

增加只负责读取原始文本与路径的 helper，例如：

```ts
export function getEnvFilePath(): string {}
export function readEnvText(): string {}
```

要求：
- 保持现有 `readEnvFile()` 行为不变
- 新 helper 不直接写入 `process.env`

- [ ] **Step 4: 创建 `src/system-config-service.ts` 并实现核心接口**

建议提供：

```ts
export interface SystemConfigSnapshot {
  values: Record<string, string>;
  changedKeys: string[];
  restartRequired: boolean;
}

export function loadSystemConfigValues(): Record<string, string> {}
export function validateSystemConfigValues(values: Record<string, string>): void {}
export function saveSystemConfigValues(values: Record<string, string>): SystemConfigSnapshot {}
```

实现要求：
- 只接受 Schema 白名单字段
- 必填项为空时报错
- `number` 字段非法时报错
- `select` 字段值不在选项内时报错
- 保留 `.env` 中未知行与注释
- 使用临时文件 + 原子替换写回 `.env`
- 返回 `changedKeys` 与 `restartRequired`

- [ ] **Step 5: 跑服务单测修正实现**

Run: `npm test -- src/system-config-service.test.ts`
Expected: PASS

- [ ] **Step 6: 提交 `.env` 服务**

```bash
git add src/env.ts src/system-config-service.ts src/system-config-service.test.ts
git commit -m "feat: add system config env persistence service"
```

---

### Task 3: 实现服务管理探测、重启与重启状态落盘

把“当前用什么服务管理器、能否自动重启、如何异步重启、如何查询状态”从设置接口中分离出来，单独做一个服务控制模块。

**Files:**
- Create: `src/service-control.ts`
- Test: `src/service-control.test.ts`
- Modify: `setup/platform.ts`

- [ ] **Step 1: 写失败测试覆盖平台与重启状态**

在 `src/service-control.test.ts` 写用例，至少覆盖：

```ts
it('reports launchd, systemd-user, systemd-system and nohup restart modes', () => {});
it('writes restart status to disk before triggering restart', () => {});
it('returns canRestart false when platform is unsupported', () => {});
it('uses start-cnp-bot.sh for nohup restart mode', () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/service-control.test.ts`
Expected: FAIL，提示服务文件不存在或依赖未实现。

- [ ] **Step 3: 在 `src/service-control.ts` 实现状态文件与能力探测**

建议接口：

```ts
export type RestartStatus = 'idle' | 'requested' | 'stopping' | 'starting' | 'healthy' | 'failed';

export interface RestartRuntimeInfo {
  manager: 'launchd' | 'systemd-user' | 'systemd-system' | 'nohup' | 'unsupported';
  status: 'running' | 'stopped' | 'unknown';
  canRestart: boolean;
}

export function getRestartRuntimeInfo(): RestartRuntimeInfo {}
export function readRestartStatus(): { status: RestartStatus; message?: string | null } {}
export function requestServiceRestart(): RestartRuntimeInfo {}
```

实现要求：
- 状态文件落到 `data/system-restart-status.json`
- `requestServiceRestart()` 先写 `requested`
- `launchd`、`systemd`、`nohup` 采用 spec 中定义的命令路径
- 不同步等待服务重启完成

- [ ] **Step 4: 在服务启动路径补“健康状态回写”**

在当前后端启动链路中加入最小逻辑：服务正常启动后把状态文件标为 `healthy`，避免页面一直停留在重启中。

- [ ] **Step 5: 重新运行服务控制单测**

Run: `npm test -- src/service-control.test.ts`
Expected: PASS

- [ ] **Step 6: 提交重启控制模块**

```bash
git add src/service-control.ts src/service-control.test.ts setup/platform.ts src/index.ts
git commit -m "feat: add system config restart control"
```

---

### Task 4: 暴露系统设置后端 API

在现有鉴权和管理员权限体系下新增系统配置 API，让前端能真实读取、保存和触发重启。

**Files:**
- Modify: `src/server.ts`
- Test: `src/server-system-config.test.ts`

- [ ] **Step 1: 写失败测试覆盖管理员接口行为**

在 `src/server-system-config.test.ts` 写最小接口测试：

```ts
it('returns config schema and values for admins', async () => {});
it('rejects non-admin users', async () => {});
it('saves validated config values', async () => {});
it('returns 400 when validation fails', async () => {});
it('returns 202 when restart is accepted', async () => {});
```

- [ ] **Step 2: 运行接口测试确认失败**

Run: `npm test -- src/server-system-config.test.ts`
Expected: FAIL，提示路由不存在。

- [ ] **Step 3: 在 `src/server.ts` 新增系统配置接口**

新增：

```ts
app.get('/api/system-config', authenticateToken, requireAdmin, ...);
app.put('/api/system-config', authenticateToken, requireAdmin, ...);
app.post('/api/system-config/restart', authenticateToken, requireAdmin, ...);
app.get('/api/system-config/restart-status', authenticateToken, requireAdmin, ...);
```

实现要求：
- `GET` 返回 sections、values、restart、pendingRestart
- `PUT` 使用 `zod` 校验 body 结构，再调用服务层校验值
- `POST /restart` 返回 `202`
- 错误响应复用现有 `server.ts` 风格
- 日志不得打印敏感字段原文

- [ ] **Step 4: 重新运行接口测试**

Run: `npm test -- src/server-system-config.test.ts`
Expected: PASS

- [ ] **Step 5: 运行相关回归测试**

Run: `npm test -- src/server-system-config.test.ts src/server-skills.test.ts src/server-chat.test.ts`
Expected: PASS

- [ ] **Step 6: 提交系统配置 API**

```bash
git add src/server.ts src/server-system-config.test.ts
git commit -m "feat: add system config admin api"
```

---

### Task 5: 把设置页改造成 Schema 驱动的真实配置页

先完成页面骨架、加载态、分组导航、表单渲染和保存，不在这一步引入敏感字段增强与重启流程，保持实现节奏清晰。

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`
- Create: `frontend/src/components/settings/ConfigSectionNav.tsx`
- Create: `frontend/src/components/settings/ConfigForm.tsx`
- Create: `frontend/src/components/settings/ConfigField.tsx`
- Test: `frontend/src/pages/Settings.test.tsx`

- [ ] **Step 1: 写失败测试覆盖页面加载与保存**

在 `frontend/src/pages/Settings.test.tsx` 增加用例：

```tsx
it('loads sections and values from /api/system-config', async () => {});
it('renders grouped fields from schema metadata', async () => {});
it('saves edited values through PUT /api/system-config', async () => {});
it('shows validation error returned by backend', async () => {});
```

- [ ] **Step 2: 运行前端测试确认失败**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: FAIL，当前页面仍为静态原型。

- [ ] **Step 3: 创建设置页通用组件**

最小职责：
- `ConfigSectionNav.tsx` 渲染左侧分组切换
- `ConfigField.tsx` 处理 text/number/toggle/select
- `ConfigForm.tsx` 负责字段列表与错误展示

- [ ] **Step 4: 重写 `frontend/src/pages/Settings.tsx`**

实现要求：
- 页面加载时请求 `/api/system-config`
- 保存时调用 `PUT /api/system-config`
- 跟随现有 `useAuth()` token 鉴权模式
- 非法或未授权时复用现有登出/跳转策略
- 保留当前项目的后台页布局风格，不做额外视觉大改

- [ ] **Step 5: 重新运行设置页测试**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交前端设置页基础版**

```bash
git add frontend/src/pages/Settings.tsx frontend/src/components/settings/ConfigSectionNav.tsx frontend/src/components/settings/ConfigForm.tsx frontend/src/components/settings/ConfigField.tsx frontend/src/pages/Settings.test.tsx
git commit -m "feat: build schema driven system settings page"
```

---

### Task 6: 实现敏感字段显示、复制与危险确认

在页面基础版上补充 `secret` 字段体验和 `JWT_SECRET` 这类危险项确认，不把这部分逻辑揉进通用字段组件。

**Files:**
- Create: `frontend/src/components/settings/SecretField.tsx`
- Modify: `frontend/src/components/settings/ConfigField.tsx`
- Modify: `frontend/src/pages/Settings.tsx`
- Modify: `frontend/src/pages/Settings.test.tsx`

- [ ] **Step 1: 写失败测试覆盖敏感字段交互**

新增用例：

```tsx
it('masks secret fields by default and reveals them on demand', async () => {});
it('copies the real secret value for admins', async () => {});
it('requires a danger confirmation before saving JWT_SECRET changes', async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: FAIL，当前不支持 secret 交互。

- [ ] **Step 3: 创建 `SecretField.tsx`**

要求：
- 默认密码态
- 提供“显示/隐藏”按钮
- 提供“复制”按钮
- 重新加载页面后默认恢复为掩码态

- [ ] **Step 4: 在设置页接入危险确认**

实现要求：
- 检测 `JWT_SECRET` 是否变化
- 点击保存前弹 `ConfirmDialog`
- 文案明确说明“修改后重启将使当前登录会话失效”

- [ ] **Step 5: 重新运行敏感字段测试**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交敏感字段增强**

```bash
git add frontend/src/components/settings/SecretField.tsx frontend/src/components/settings/ConfigField.tsx frontend/src/pages/Settings.tsx frontend/src/pages/Settings.test.tsx
git commit -m "feat: add secret field controls for system settings"
```

---

### Task 7: 接入“保存并重启”与重启状态提示

在设置页基础保存流程之上，增加组合动作、状态轮询与服务重启中的 UI 反馈。

**Files:**
- Create: `frontend/src/components/settings/RestartBanner.tsx`
- Modify: `frontend/src/pages/Settings.tsx`
- Modify: `frontend/src/pages/Settings.test.tsx`

- [ ] **Step 1: 写失败测试覆盖保存并重启流程**

新增用例：

```tsx
it('calls save then restart when save and restart is clicked', async () => {});
it('polls restart status until healthy', async () => {});
it('shows that config is saved even when restart fails', async () => {});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: FAIL，当前不支持重启流。

- [ ] **Step 3: 创建 `RestartBanner.tsx`**

职责：
- 展示当前服务管理器类型
- 提示是否支持自动重启
- 展示 `pendingRestart` 或 `restart-status`
- 呈现“重启中”与“重启失败”文案

- [ ] **Step 4: 在 `Settings.tsx` 接入组合动作**

实现要求：
- `保存并重启` 按顺序执行 `PUT` 和 `POST /restart`
- 调用重启后轮询 `/api/system-config/restart-status`
- 页面断连后恢复时仍可重新拉取状态

- [ ] **Step 5: 重新运行前端重启流程测试**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交重启交互**

```bash
git add frontend/src/components/settings/RestartBanner.tsx frontend/src/pages/Settings.tsx frontend/src/pages/Settings.test.tsx
git commit -m "feat: add save and restart flow for system settings"
```

---

### Task 8: 端到端回归与文档收尾

在功能完成后集中跑后端、前端和关键回归测试，修正文案和边角问题，再做最终提交。

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/SPEC.md`
- Modify: 受回归影响的实现或测试文件

- [ ] **Step 1: 补充用户文档**

在文档中补充：
- 设置页仅管理员可用
- 系统配置存储于 `.env`
- 修改后可在设置页执行“保存并重启”
- 修改 `JWT_SECRET` 会导致重新登录

- [ ] **Step 2: 运行后端测试集**

Run: `npm test -- src/system-config-schema.test.ts src/system-config-service.test.ts src/service-control.test.ts src/server-system-config.test.ts`
Expected: PASS

- [ ] **Step 3: 运行前端测试集**

Run: `npm test -- frontend/src/pages/Settings.test.tsx`
Expected: PASS

- [ ] **Step 4: 运行现有关键回归测试**

Run: `npm test -- src/config.test.ts frontend/src/pages/Users.test.tsx frontend/src/pages/SkillsAdmin.test.tsx`
Expected: PASS

- [ ] **Step 5: 进行一次本地构建验证**

Run: `npm test`
Expected: PASS，或至少新增相关测试全部通过且失败项与本功能无关。

- [ ] **Step 6: 提交最终收尾**

```bash
git add README.md README_zh.md docs/SPEC.md src frontend
git commit -m "feat: add visual system settings management"
```
