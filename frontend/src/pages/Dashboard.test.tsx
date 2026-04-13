// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dashboard } from "./Dashboard";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function findElementByText(root: HTMLElement, text: string): HTMLElement {
  const match = Array.from(root.querySelectorAll<HTMLElement>("*")).find(
    (element) => element.textContent?.trim() === text,
  );

  if (!match) {
    throw new Error(`Could not find element with text: ${text}`);
  }

  return match;
}

describe("Dashboard page proportions", () => {
  let container: HTMLDivElement;
  let root: Root;

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
  });

  it("elevates the main title and avoids overusing tiny typography", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
      );
    });
    await flush();

    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading?.className).toContain("text-2xl");
    expect(heading?.className).not.toContain("text-xl");

    const description = Array.from(container.querySelectorAll("p")).find((node) =>
      node.textContent?.includes("聚合任务、资源与协作态势"),
    );
    expect(description).not.toBeNull();
    expect(description?.className).toContain("text-sm");
    expect(description?.className).toContain("leading-6");

    const tokenMetric = findElementByText(container, "近 24 小时 Token").parentElement;
    expect(tokenMetric).not.toBeNull();
    const tokenLabel = tokenMetric?.querySelector("span:first-child");
    const tokenValue = tokenMetric?.querySelector("span:last-child");
    expect(tokenLabel?.className).toContain("text-xs");
    expect(tokenValue?.className).toContain("text-sm");

    const agentMetric = findElementByText(container, "活跃 Agent").parentElement;
    expect(agentMetric).not.toBeNull();
    const agentLabel = agentMetric?.querySelector("span:first-child");
    const agentValue = agentMetric?.querySelector("span:last-child");
    expect(agentLabel?.className).toContain("text-xs");
    expect(agentValue?.className).toContain("text-sm");

    const taskHeading = findElementByText(container, "核心任务列表");
    const taskPanel = taskHeading.closest("article");
    const taskTable = taskPanel?.querySelector("table");
    expect(taskTable).not.toBeNull();
    expect(taskTable?.className).toContain("text-sm");

    const statusBadge = Array.from(taskPanel?.querySelectorAll("span") ?? []).find(
      (node) => node.textContent?.trim() === "运行中",
    );
    expect(statusBadge).not.toBeNull();
    expect(statusBadge?.className).toContain("text-xs");

    const tinyTextNodes = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const className = node.className;
      return typeof className === "string" && /text-\[(10|11)px\]/.test(className);
    });

    expect(tinyTextNodes.length).toBe(0);
  });
});
