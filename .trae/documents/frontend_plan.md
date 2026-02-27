# NanoClaw 前端功能设计与实施计划

## 1. 项目概况与目标
NanoClaw 目前是一个纯后端运行的 AI 助手，主要通过 WhatsApp 进行交互。
本计划旨在为 NanoClaw 添加一个现代化的 Web 前端界面，提供可视化监控、管理以及直接的网页聊天能力。

## 2. 设计哲学
- **极简主义 (Minimalism)**: 保持界面简洁，无干扰，符合 "Nano" 的轻量化定位。
- **黑客风格 (Hacker/Terminal Aesthetic)**: 采用深色模式，使用等宽字体，致敬终端界面。
- **功能至上 (Functionality First)**: 优先展示系统状态、日志和核心交互功能。
- **单进程 (Single Process)**: 前端构建后由现有的 Node.js 进程托管，不增加额外的部署复杂性。

## 3. 功能模块设计

### 3.1 仪表盘 (Dashboard)
- **系统状态**: 显示 NanoClaw 运行时间、WhatsApp 连接状态、内存占用。
- **活跃智能体**: 显示当前正在运行的容器智能体 (Agent Containers) 及其所属群组。
- **最近活动**: 实时滚动的系统日志摘要。

### 3.2 群组管理 (Group Management)
- **群组列表**: 列出所有已注册的群组 (WhatsApp Chats)。
- **状态概览**: 显示每个群组的最后消息时间、当前模式（自动/手动触发）。
- **记忆查看**: (高级功能) 查看或编辑群组的 `CLAUDE.md` 记忆文件。

### 3.3 网页聊天 (Web Chat)
- **直接交互**: 提供一个基于 Web 的聊天窗口，允许用户直接与 Claude 对话，无需通过 WhatsApp。
- **历史记录**: 查看选定群组的历史消息记录。
- **实时更新**: 消息实时上屏。

## 4. 技术栈选择

### 后端 (Backend)
- **Server**: Express (轻量级，易于集成到现有 `src/index.ts`)。
- **API**: RESTful API (用于获取状态、列表、历史)。
- **WebSocket (可选)**: 用于实时日志和消息推送（第一版可先用轮询）。

### 前端 (Frontend)
- **框架**: React (主流、生态丰富)。
- **构建工具**: Vite (极速构建)。
- **样式**: Tailwind CSS (原子化 CSS，开发效率高)。
- **组件库**: shadcn/ui (基于 Radix UI，美观且高度可定制，适合黑客风格)。
- **图标**: Lucide React。

## 5. 实施路线图

### 第一阶段：后端 API 基础 (Backend Foundation)
1.  **引入 Express**: 在 `package.json` 中添加 `express`, `@types/express`, `cors`。
2.  **创建 Server 模块**: 新建 `src/server.ts`，封装 HTTP 服务启动逻辑。
3.  **实现核心 API**:
    - `GET /api/status`: 返回系统健康状态。
    - `GET /api/groups`: 返回群组列表。
    - `GET /api/groups/:jid/messages`: 返回群组历史消息。
    - `GET /api/logs`: 返回最近日志。
4.  **集成启动**: 在 `src/index.ts` 的 `main()` 函数中启动 Web Server。

### 第二阶段：前端工程搭建 (Frontend Setup)
1.  **初始化项目**: 在 `frontend/` 目录下初始化 Vite + React + TypeScript 项目。
2.  **配置代理**: 配置 Vite 开发服务器代理到后端 API。
3.  **安装依赖**: 安装 Tailwind, shadcn/ui 等 UI 库。

### 第三阶段：功能开发 (Feature Development)
1.  **布局开发**: 侧边栏导航 + 顶部状态栏。
2.  **仪表盘页面**: 实现状态卡片和日志视图。
3.  **聊天页面**: 实现左侧会话列表，右侧聊天窗口。
4.  **联调**: 对接后端 API，展示真实数据。

### 第四阶段：构建与部署 (Build & Serve)
1.  **构建脚本**: 配置 `npm run build` 自动构建前端。
2.  **静态托管**: 配置 Express 托管 `frontend/dist` 目录。
3.  **统一启动**: 确保 `npm start` 同时启动后端服务和前端页面。

## 6. 待办事项 (Todo List)
- [ ] 后端：安装 Express 及相关依赖
- [ ] 后端：创建 `src/server.ts` 并实现基础 API
- [ ] 后端：在 `src/index.ts` 中集成 Web Server
- [ ] 前端：初始化 Vite 项目
- [ ] 前端：安装 UI 组件库 (Tailwind/shadcn)
- [ ] 前端：实现仪表盘页面
- [ ] 前端：实现聊天/群组列表页面
- [ ] 系统：配置静态文件托管与统一启动
