// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SkillTreeNode } from "@/lib/types";
import { SkillTree } from "./SkillTree";

describe("SkillTree interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  const nodes: SkillTreeNode[] = [
    {
      name: "tmux",
      path: "tmux",
      type: "directory",
      children: [
        { name: "SKILL.md", path: "tmux/SKILL.md", type: "file", editable: true },
        {
          name: "scripts",
          path: "tmux/scripts",
          type: "directory",
          children: [
            { name: "run.sh", path: "tmux/scripts/run.sh", type: "file", editable: true },
          ],
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens node detail by double-click", async () => {
    const onOpen = vi.fn(async () => {});

    await act(async () => {
      root.render(
        <SkillTree
          nodes={nodes}
          selectedPath={null}
          onSelect={vi.fn()}
          onOpen={onOpen}
          editable={true}
          onRename={vi.fn()}
          onCreate={vi.fn()}
          onMove={vi.fn()}
        />,
      );
    });

    const fileNode = container.querySelector('[data-node-path="tmux/SKILL.md"]') as HTMLDivElement | null;
    expect(fileNode).not.toBeNull();

    await act(async () => {
      fileNode!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ path: "tmux/SKILL.md" }),
    );
  });

  it("creates node from context menu", async () => {
    const onCreate = vi.fn(async () => {});
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("new-script.sh");

    await act(async () => {
      root.render(
        <SkillTree
          nodes={nodes}
          selectedPath={null}
          onSelect={vi.fn()}
          onOpen={vi.fn()}
          editable={true}
          onRename={vi.fn()}
          onCreate={onCreate}
          onMove={vi.fn()}
        />,
      );
    });

    const scriptsNode = container.querySelector('[data-node-path="tmux/scripts"]') as HTMLDivElement | null;
    expect(scriptsNode).not.toBeNull();

    await act(async () => {
      scriptsNode!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    });

    const createFileAction = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("新建文件"),
    ) as HTMLButtonElement | undefined;
    expect(createFileAction).toBeDefined();
    await act(async () => {
      createFileAction!.click();
    });

    expect(promptSpy).toHaveBeenCalled();
    expect(onCreate).toHaveBeenCalledWith("tmux/scripts", "file", "new-script.sh");
  });

  it("moves node by drag and drop", async () => {
    const onMove = vi.fn(async () => {});

    await act(async () => {
      root.render(
        <SkillTree
          nodes={nodes}
          selectedPath={null}
          onSelect={vi.fn()}
          onOpen={vi.fn()}
          editable={true}
          onRename={vi.fn()}
          onCreate={vi.fn()}
          onMove={onMove}
        />,
      );
    });

    const skillMd = container.querySelector('[data-node-path="tmux/SKILL.md"]') as HTMLDivElement | null;
    const scripts = container.querySelector('[data-node-path="tmux/scripts"]') as HTMLDivElement | null;
    expect(skillMd).not.toBeNull();
    expect(scripts).not.toBeNull();

    await act(async () => {
      skillMd!.dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    await act(async () => {
      scripts!.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      scripts!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });

    expect(onMove).toHaveBeenCalledWith("tmux/SKILL.md", "tmux/scripts/SKILL.md");
  });
});
