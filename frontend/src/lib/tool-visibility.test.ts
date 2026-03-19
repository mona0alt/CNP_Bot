import { describe, expect, it } from "vitest";

import type { ContentBlock } from "./types";
import { shouldHideToolUseBlock } from "./tool-visibility";

describe("tool visibility", () => {
  it("隐藏 jumpserver 内部 tmux 工具卡片", () => {
    const block: ContentBlock = {
      type: "tool_use",
      name: "Bash",
      input: {
        command: 'tmux -S /tmp/cnpbot-tmux-sockets/cnpbot.sock capture-pane -p -J -t jumpserver:0.0 -S -200',
      },
      status: "executed",
    };

    expect(shouldHideToolUseBlock(block)).toBe(true);
  });

  it("保留 jumpserver 入口脚本卡片", () => {
    const block: ContentBlock = {
      type: "tool_use",
      name: "Bash",
      input: {
        command: "bash /home/node/.claude/skills/jumpserver/scripts/connect.sh",
      },
      status: "executed",
    };

    expect(shouldHideToolUseBlock(block)).toBe(false);
  });

  it("隐藏已结束但没有任何内容的空工具卡片", () => {
    const block: ContentBlock = {
      type: "tool_use",
      name: "Bash",
      input: {},
      status: "cancelled",
    };

    expect(shouldHideToolUseBlock(block)).toBe(true);
  });
});
