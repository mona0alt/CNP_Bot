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

## 连接流程

1. **SSH 连接到 JumpServer**
   ```bash
   ssh "${JUMPSERVER_USER}@${JUMPSERVER_HOST}" -p"${JUMPSERVER_PORT}"
   ```

2. **首次连接需确认密钥** - 输入 `yes`

3. **输入密码** - `$JUMPSERVER_PASS`

4. **登录成功后，搜索目标 IP** - 直接输入 IP 地址（如 `10.246.104.45`）并回车

5. **再次输入目标机器密码** - 根据实际情况输入

## 使用 tmux 会话连接

不要手工拆着执行多条 `tmux -S ...` 命令。请优先直接运行脚本：

```bash
bash /home/node/.claude/skills/jumpserver/scripts/connect.sh
```

这个脚本会：

- 使用固定 socket：`/tmp/cnpbot-tmux-sockets/cnpbot.sock`
- 幂等创建 tmux session：`jumpserver`
- 如果当前 pane 不是 ssh，会自动发起到 JumpServer 的 SSH 连接
- 输出当前 pane 内容，方便你判断下一步是否需要输入 `yes` 或密码

如果你需要再次查看输出，可执行：

```bash
tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200
```

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
