# 系统级设置页可视化配置设计

**日期：** 2026-04-13

**目标：** 为项目新增一个真实可用的“系统设置”子页面，让管理员可以通过 Web UI 可视化查看、修改、保存并重启系统级配置。

**范围：**
- 仅覆盖系统级配置
- 覆盖 `src/config.ts` 中定义的全部可输入型配置
- 配置真实来源保持为项目根目录 `.env`
- 支持管理员在设置页保存配置
- 支持管理员执行“保存并重启”
- 支持敏感字段默认掩码展示、按需显示原文、复制真实值

**非目标：**
- 不覆盖群组级配置
- 不覆盖会话级配置
- 不引入新的数据库配置真源
- 不支持配置历史版本、审计记录、回滚
- 不把派生常量或内部实现常量暴露为可编辑项

## 1. 背景与现状

当前项目已经有 `/settings` 路由和对应页面，但 `frontend/src/pages/Settings.tsx` 仍是静态原型：

- 页面中的服务分组、状态与字段均为硬编码示例
- 不读取后端真实配置
- 不保存任何内容
- 不具备权限控制之外的真实业务能力

另一方面，系统级配置目前主要集中在 `src/config.ts`：

- 值从 `process.env` 或 `.env` 中读取
- 启动时完成解析
- 大部分配置在进程启动后固定
- 真正生效仍依赖重启服务

因此，本次设计的核心不是“再做一个漂亮的设置页”，而是建立一条完整的系统配置管理链路：

1. 后端定义哪些系统配置允许通过 UI 编辑
2. 后端读取并校验 `.env`
3. 前端按真实 Schema 渲染设置页
4. 保存时安全写回 `.env`
5. 需要时触发平台相关的服务重启

## 2. 需求结论

经过确认，本次需求边界如下：

- 只做系统级配置，不碰群组/会话级配置
- 配置保存目标为项目根目录 `.env`
- 保存后支持“保存并重启”
- 覆盖 `src/config.ts` 中全部系统级可输入配置
- 敏感字段也允许修改
- 敏感字段默认掩码展示
- 管理员可以显式切换为明文查看
- 管理员可以复制敏感字段真实值
- 设置页只允许管理员访问和操作

## 3. 系统级配置清单

### 3.1 纳入设置页的配置

以下配置应纳入本期设置页管理：

#### Agent 基础

- `ASSISTANT_NAME`
- `ASSISTANT_HAS_OWN_NUMBER`
- `USE_LOCAL_AGENT`
- `DEFAULT_AGENT_TYPE`
- `DEEP_AGENT_MODEL`

#### DeepAgent 运行路径

- `DEEP_AGENT_RUNNER_PATH`
- `DEEP_AGENT_PYTHON`

#### 容器与运行时

- `CONTAINER_IMAGE`
- `CONTAINER_TIMEOUT`
- `CONTAINER_MAX_OUTPUT_SIZE`
- `IDLE_TIMEOUT`
- `MAX_CONCURRENT_CONTAINERS`
- `TIMEZONE`

#### 认证与安全

- `JWT_SECRET`
- `JWT_EXPIRES_IN`

#### 知识库

- `KB_API_URL`
- `KB_API_KEY`
- `KB_API_ACCOUNT`
- `KB_API_USER`
- `KB_API_AGENT_ID`
- `KB_ROOT_URI`
- `KB_INJECT_LIMIT`
- `KB_SEARCH_TIMEOUT`
- `KB_EXTRACT_TIMEOUT`

#### 草稿总结 LLM

- `KB_SUMMARY_LLM_API_URL`
- `KB_SUMMARY_LLM_API_KEY`
- `KB_SUMMARY_LLM_MODEL`
- `KB_SUMMARY_LLM_TIMEOUT`

### 3.2 不纳入设置页的项

以下内容不应作为 UI 可编辑配置暴露：

- `STORE_DIR`
- `GROUPS_DIR`
- `DATA_DIR`
- `SKILLS_DIR`
- `GLOBAL_SKILLS_DIR`
- `SESSION_SKILLS_DIR`
- `MAIN_GROUP_FOLDER`
- `TRIGGER_PATTERN`
- 轮询间隔、内部路径推导和其他派生常量

原因：

- 它们不是“用户输入型配置”
- 它们由代码推导或属于实现细节
- 暴露后会明显增加误配风险

## 4. 方案对比

### 4.1 方案 A：前后端手写表单与字段映射

做法：

- 前端手工写所有表单项
- 后端手工写读取和保存逻辑
- 字段定义在前后端分别维护

优点：

- 首版开发看起来最快

缺点：

- 字段数量多时容易漂移
- 校验、默认值、说明文案会重复维护
- 后续新增配置成本高

### 4.2 方案 B：后端 Schema 驱动设置页

做法：

- 后端集中维护系统配置元数据 Schema
- 前端通过接口拿到 Schema 和当前值后通用渲染
- `.env` 仍然是唯一真源

优点：

- 字段定义单点维护
- 最适合“全部系统级配置”的需求
- 后续扩展成本低
- 更容易做统一校验与风险提示

缺点：

- 首版需要补一层 Schema 抽象

### 4.3 方案 C：新增数据库配置表作为真源

做法：

- 前端写数据库
- 服务启动时从数据库读取
- 再决定是否回写 `.env`

优点：

- 后续容易扩展历史版本、审计和回滚

缺点：

- 与当前项目架构不匹配
- 容易形成数据库与 `.env` 双真源
- 明显超出本期需求

### 4.4 推荐方案

采用 **方案 B：后端 Schema 驱动设置页，`.env` 为唯一真源**。

原因：

- 与当前配置读取方式最一致
- 满足“全部系统级配置可视化”的需求
- 不引入额外状态源
- 可维护性明显优于纯手写表单方案

## 5. 总体架构

建议把能力拆分为三个后端模块和一组前端组件。

### 5.1 后端模块

#### System Config Schema

负责声明全部系统配置字段的元信息：

- 分组
- 标题
- 字段类型
- 默认值
- 是否敏感
- 是否需要重启
- 必填规则
- 枚举选项
- 帮助文案
- 风险提示

#### System Config Service

负责系统配置读写：

- 读取 `.env`
- 生成当前配置值
- 校验用户输入
- 保留未知行并回写 `.env`
- 计算变更字段与是否需要重启

#### Service Control

负责服务重启与状态管理：

- 检测当前服务管理方式
- 触发重启
- 写入重启状态
- 提供重启进度查询

### 5.2 前端模块

设置页改造成真实系统配置中心：

- 左侧按配置分组导航
- 右侧渲染当前分组表单
- 顶部展示服务状态与未生效提示
- 底部提供“保存”“保存并重启”“恢复”操作

## 6. 文件边界

### 6.1 后端

建议新增：

- `src/system-config-schema.ts`
- `src/system-config-service.ts`
- `src/service-control.ts`

建议修改：

- `src/server.ts`
- `src/env.ts`
- 视实现需要补充 `src/config.ts` 的元数据对齐说明

### 6.2 前端

建议新增：

- `frontend/src/components/settings/ConfigSectionNav.tsx`
- `frontend/src/components/settings/ConfigForm.tsx`
- `frontend/src/components/settings/ConfigField.tsx`
- `frontend/src/components/settings/SecretField.tsx`
- `frontend/src/components/settings/RestartBanner.tsx`

建议修改：

- `frontend/src/pages/Settings.tsx`

## 7. 后端数据模型

后端不新增系统配置数据库表。

### 7.1 真源

系统配置唯一真源仍为：

- 项目根目录 `.env`

### 7.2 原则

- 只允许白名单字段被读写
- 只允许 `src/config.ts` 已定义的系统级配置进入设置页
- 不允许任意键从前端写入 `.env`
- 未被本系统管理的 `.env` 行必须保留

## 8. 配置 Schema 设计

每个字段建议统一描述为如下结构：

```ts
type SystemConfigField = {
  key: string;
  section: string;
  label: string;
  description?: string;
  type: 'text' | 'number' | 'toggle' | 'select' | 'secret';
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  defaultValue?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  dangerLevel?: 'normal' | 'warning' | 'danger';
  dangerMessage?: string;
  validate?: (value: string) => string | null;
};
```

设计原则：

- 类型用于前端渲染
- 校验以服务端规则为准
- 敏感字段由 `secret` 标记控制默认展示方式
- 风险字段通过 `dangerLevel` 和 `dangerMessage` 提醒用户

## 9. API 设计

所有接口都应要求：

- `authenticateToken`
- `requireAdmin`

### 9.1 `GET /api/system-config`

用途：

- 返回设置页所需的全部元数据与当前值

返回内容：

- `sections`
- `values`
- `restart`
- `pendingRestart`

示例：

```json
{
  "sections": [
    {
      "id": "agent",
      "title": "Agent 基础",
      "fields": [
        {
          "key": "ASSISTANT_NAME",
          "label": "助手名称",
          "type": "text",
          "required": true,
          "secret": false,
          "restartRequired": true,
          "description": "用于触发词与界面展示"
        }
      ]
    }
  ],
  "values": {
    "ASSISTANT_NAME": "Assistant",
    "DEFAULT_AGENT_TYPE": "deepagent"
  },
  "restart": {
    "manager": "launchd",
    "status": "running",
    "canRestart": true
  },
  "pendingRestart": false
}
```

### 9.2 `PUT /api/system-config`

用途：

- 校验并写回 `.env`
- 不负责直接重启

请求体：

```json
{
  "values": {
    "ASSISTANT_NAME": "CNP-Bot",
    "DEFAULT_AGENT_TYPE": "deepagent"
  }
}
```

返回内容：

- `saved`
- `changedKeys`
- `restartRequired`
- `warnings`

### 9.3 `POST /api/system-config/restart`

用途：

- 异步触发服务重启

特点：

- 返回 `202 Accepted`
- 不要求 HTTP 请求等到服务完全重启完成

返回内容：

- `accepted`
- `manager`
- `message`

### 9.4 `GET /api/system-config/restart-status`

用途：

- 提供前端轮询重启过程的状态

状态建议：

- `idle`
- `requested`
- `stopping`
- `starting`
- `healthy`
- `failed`

## 10. `.env` 读写策略

### 10.1 读取

当前 `src/env.ts` 已提供按 key 读取 `.env` 的能力，但只适合读取值，不适合回写。

本期需要在 `system-config-service.ts` 中补充更完整的能力：

- 读取原始 `.env` 文本
- 解析每一行
- 识别注释、空行、键值对
- 仅更新白名单字段
- 保留未知字段、注释和大体顺序

### 10.2 写入

写入时遵循：

- 使用白名单更新
- 不删除未管理字段
- 值统一按文本写入
- 含空格或特殊字符时统一转义或加引号
- 完整写入失败时不覆盖原文件

建议采用：

1. 生成新内容
2. 写入临时文件
3. 原子替换 `.env`

### 10.3 空值处理

建议规则：

- 非必填字段可保存为空字符串
- 必填字段为空时拒绝保存
- 选择清空敏感字段时要显式保留为空，而不是因为掩码逻辑被忽略

## 11. 前端页面设计

### 11.1 页面结构

建议保留当前左侧导航 + 右侧内容的大框架，但改为真实配置分组：

- `Agent 基础`
- `DeepAgent`
- `运行时`
- `认证安全`
- `知识库`
- `草稿总结 LLM`

### 11.2 顶部状态区

顶部展示：

- 当前服务状态
- 服务管理器类型
- 是否支持自动重启
- 是否存在“已保存但未重启生效”的配置

### 11.3 表单区

每个字段展示：

- 标题
- 描述
- 输入控件
- 是否需要重启
- 风险提示
- 字段级错误

### 11.4 底部操作区

提供：

- `保存`
- `保存并重启`
- `恢复为已加载值`

## 12. 敏感字段交互

敏感字段包括但不限于：

- `JWT_SECRET`
- `KB_API_KEY`
- `KB_SUMMARY_LLM_API_KEY`

交互要求：

- 默认掩码展示
- 管理员可以点击“显示”切换为明文
- 管理员可以点击“复制”复制真实值
- 页面刷新或离开后恢复为掩码态
- 不记住“本次显示状态”

说明：

- 后端仍会向管理员返回真实值
- 掩码仅是前端显示层处理
- 否则前端无法正确处理“未修改”“修改为空”“复制真实值”等场景

## 13. 校验与风险提示

### 13.1 通用校验

- 必填项不得为空
- `number` 字段必须为合法数值
- `toggle` 字段必须为 `true` 或 `false`
- `select` 字段必须在允许选项内

### 13.2 业务校验

示例：

- `DEFAULT_AGENT_TYPE` 必须为 `claude` 或 `deepagent`
- 超时类字段必须大于 0
- 并发数必须大于等于 1
- URL 类字段应为合法 URL 或允许为空

### 13.3 风险字段

以下字段应给出更强提示：

- `JWT_SECRET`
- `DEEP_AGENT_PYTHON`
- `DEEP_AGENT_RUNNER_PATH`
- `CONTAINER_IMAGE`

其中 `JWT_SECRET` 需要额外危险提示：

- 修改后重启服务将导致现有登录 token 失效
- 当前管理员可能需要重新登录

## 14. 重启机制设计

### 14.1 原则

“保存”与“重启”职责分离：

- `PUT /api/system-config` 只负责保存
- `POST /api/system-config/restart` 只负责重启

前端“保存并重启”是一个组合动作：

1. 保存配置
2. 二次确认危险操作
3. 触发重启
4. 轮询重启状态

### 14.2 平台策略

#### launchd

优先使用：

- `launchctl kickstart -k gui/<uid>/com.cnp-bot`

必要时退化到：

- unload/load
- stop/start

#### systemd

- root：`systemctl restart cnp-bot`
- 非 root：`systemctl --user restart cnp-bot`

#### nohup

调用项目已有：

- `start-cnp-bot.sh`

该脚本已经包含停旧进程和启动新进程逻辑。

### 14.3 状态落盘

重启状态不应只存在内存中，否则新进程起来后状态丢失。

建议新增状态文件：

- `data/system-restart-status.json`

内容用于表达：

- 请求发起时间
- 当前阶段
- 失败信息
- 最近完成时间

## 15. 权限与安全

### 15.1 权限

- 设置页仅管理员可访问
- 后端接口仅管理员可调用

### 15.2 安全原则

- 仅允许白名单字段进入保存链路
- 不允许从前端提交任意 `.env` key
- 不允许通过设置页编辑内部派生路径常量
- 敏感字段仅对管理员返回真实值

### 15.3 日志

日志中不得打印敏感值原文。

允许记录：

- 哪些字段被修改
- 是否成功写入
- 是否触发重启

不允许记录：

- `JWT_SECRET`
- `KB_API_KEY`
- `KB_SUMMARY_LLM_API_KEY`

的真实内容。

## 16. 错误处理

### 16.1 保存失败

示例：

- `.env` 不可写
- 校验失败
- 请求体非法

前端应区分：

- 字段级错误
- 全局错误

### 16.2 重启失败

可能出现：

- 配置已保存但重启命令执行失败
- 平台不支持自动重启
- 服务重启后未恢复健康

前端提示应明确：

- 配置已写入 `.env`
- 但尚未成功重启
- 下次成功重启后配置才会生效

## 17. 测试策略

### 17.1 后端单测

新增：

- `src/system-config-service.test.ts`
- `src/service-control.test.ts`

覆盖：

- `.env` 解析与保留未知行
- 字段校验
- 空值处理
- 敏感字段保存
- 平台差异下的重启命令选择
- 重启状态读写

### 17.2 接口测试

在现有 `server` 测试模式下覆盖：

- 管理员读取配置成功
- 非管理员访问被拒绝
- 保存成功
- 保存校验失败
- 重启请求返回 `202`

### 17.3 前端测试

新增或扩展：

- `frontend/src/pages/Settings.test.tsx`

覆盖：

- 配置加载
- 分组切换
- 普通字段编辑保存
- 敏感字段显示/隐藏/复制
- `JWT_SECRET` 风险确认
- 保存并重启流程
- 离开页面未保存确认

## 18. 实施建议

建议按以下顺序实现：

1. 后端 Schema 与 `.env` 读写服务
2. 后端配置查询与保存接口
3. 后端服务重启与状态接口
4. 前端设置页真实化改造
5. 敏感字段交互与危险提示
6. 完整测试与回归

## 19. 最终结论

本期应实现一个由后端 Schema 驱动的系统设置页：

- 覆盖全部系统级可输入配置
- `.env` 是唯一真源
- 敏感字段默认掩码，但管理员可查看原文并复制
- 保存与重启分离，UI 提供“保存并重启”
- 重启采用异步状态机制，适配 `launchd`、`systemd` 与 `nohup`

该方案与现有项目结构最一致，能在控制复杂度的前提下，真正把当前静态设置页升级为可运维的系统配置中心。
