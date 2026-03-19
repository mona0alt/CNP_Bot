---
name: jumpserver
description: 通过 JumpServer 堡垒机连接远程服务器。用于任何需要 SSH 连接到内网服务器的的场景，例如：(1) 用户要求连接某台服务器 (2) 用户要求查看某台服务器的详情 (3) 用户要求 SSH 到某台机器 (4) 用户提供 IP 地址需要远程连接
---

# JumpServer 堡垒机连接

## 连接信息

- **JumpServer 地址**: `$JUMPSERVER_HOST`
- **SSH 端口**: `$JUMPSERVER_PORT`
- **用户名**: `$JUMPSERVER_USER`
- **密码**: `$JUMPSERVER_PASS`

## 加速登录：安装 sshpass（推荐）

在容器中安装 sshpass 可自动输入密码，避免交互式输入：

```bash
apt-get update && apt-get install -y sshpass
```

安装后，`connect.sh` 会自动使用 sshpass 加速登录。

## 连接复用机制（重要）

脚本使用固定的 tmux 会话和 socket，**会自动复用已有连接**：

- **Socket**: `/tmp/cnpbot-tmux-sockets/cnpbot.sock`
- **Session**: `jumpserver`
- **复用逻辑**: 如果当前 pane 已经在运行 SSH，会跳过连接步骤，直接使用现有会话

因此，**无需每次都新建连接**，Agent 只需调用一次脚本即可继续操作。

## 使用方法

直接运行脚本（推荐）：

```bash
bash /home/node/.claude/skills/jumpserver/scripts/connect.sh
```

这个脚本会：

1. 幂等创建 tmux session：`jumpserver`（已存在则跳过）
2. 检查当前 pane 是否已是 SSH 连接
3. 如果是 SSH，直接使用；否则建立新连接
4. 输出当前 pane 内容

## 查看目标机器详情

连接成功后执行：
```bash
echo "=== 系统信息 ===" && uname -a
echo -e "\n=== 主机名 ===" && hostname
echo -e "\n=== 操作系统 ===" && cat /etc/os-release
echo -e "\n=== CPU 信息 ===" && lscpu | grep -E "Model name|CPU\(s\)|Thread|Core|Socket"
echo -e "\n=== 内存信息 ===" && free -h
echo -e "\n=== 磁盘信息 ===" && df -h | grep -E "^/dev|^Filesystem"
```

## 手动操作 tmux 会话

查看当前 pane 内容：
```bash
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200
```

查看会话状态：
```bash
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock list-sessions
```

进入会话交互模式：
```bash
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock attach -t jumpserver
```

## 连接 JumpServer 后的步骤

1. 搜索目标 IP - 直接输入 IP 地址（如 `10.246.104.45`）并回车
2. 输入目标机器密码
