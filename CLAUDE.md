# CNP-Bot

智能运维代理（Intelligent DevOps Agent）。单 Node.js 进程，接入多种 IM 渠道，将消息路由至运行在容器（Linux VM）中的 Claude Agent SDK。每个会话组拥有独立的文件系统和记忆空间。

## 定位

CNP-Bot 是一个面向运维场景的智能体平台，核心能力：

- **多渠道接入**：WhatsApp、Web Chat，可扩展 Telegram / Discord
- **容器隔离**：每个对话组在独立 Linux 容器中运行，文件系统互不干扰
- **运维工具集成**：内置 Bash、浏览器自动化、Prometheus 监控等工具
- **定时任务**：支持 cron / interval / once 三种调度模式
- **安全挂载**：通过外部 allowlist 控制容器可访问的宿主机目录

## 关键文件

| 文件 | 用途 |
|------|------|
| `src/index.ts` | 编排核心：状态管理、消息循环、Agent 调用 |
| `src/channels/whatsapp.ts` | WhatsApp 连接、认证、收发消息 |
| `src/ipc.ts` | IPC 监听与任务处理 |
| `src/router.ts` | 消息格式化与出站路由 |
| `src/config.ts` | 触发词规则、路径、轮询间隔等配置 |
| `src/container-runner.ts` | 启动 Agent 容器并挂载目录 |
| `src/task-scheduler.ts` | 定时任务调度 |
| `src/db.ts` | SQLite 操作 |
| `src/server.ts` | HTTP + WebSocket 服务（Web Chat） |
| `groups/{name}/CLAUDE.md` | 每个会话组的独立记忆（隔离） |
| `container/skills/agent-browser.md` | 浏览器自动化工具（所有 Agent 可用） |

## Skills




## Docker 部署

修改前后端代码后，重新构建并重启服务：

```bash
./start_with_ip.sh --docker
```

该命令会构建 Docker 镜像并用最新前端重新启动容器。

## ⚠️ 开发规范：测试要求（强制）

**每次修改前端或后端代码后，必须执行测试用例，确保全部通过，再提交或部署。**

```bash
npm test
```

预期结果：所有测试文件通过，零失败。当前共 34 个测试文件、392 个测试用例。

测试覆盖范围：

| 测试文件 | 覆盖模块 |
|----------|----------|
| `src/db.test.ts` | SQLite CRUD、sessions、router state、registered groups、tasks |
| `src/server-chat.test.ts` | WebSocket 会话集成、tool card 流、跨 session 隔离 |
| `src/slash-commands.test.ts` | /clear、/compact、自定义命令路由 |
| `src/mount-security.test.ts` | 挂载安全校验、allowlist 逻辑 |
| `src/container-runtime.test.ts` | 容器运行时管理 |
| `src/group-folder.test.ts` | 会话组路径校验 |
| `src/routing.test.ts` | 消息路由逻辑 |
| `src/formatting.test.ts` | 消息格式化 |
| `src/ipc-auth.test.ts` | IPC 认证 |
| `src/group-queue.test.ts` | 并发队列管理 |
| `skills-engine/__tests__/*` | Skills 引擎（安装、更新、回滚） |
