// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout } from "./Layout";

let currentTheme: "light" | "dark" = "light";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "tester", role: "admin", display_name: "测试用户" },
    logout: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: currentTheme,
    toggleTheme: vi.fn(),
  }),
}));

describe("Layout topbar", () => {
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
    vi.clearAllMocks();
    currentTheme = "light";
  });

  it("renders a global topbar and moves the user entry to the top-right area", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<div data-testid="page-content">page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    const sidebar = container.querySelector("[data-sidebar-size='wide']");
    expect(sidebar).not.toBeNull();
    expect(sidebar?.textContent).toContain("控制台");
    expect(sidebar?.textContent).not.toContain("测试用户");
    expect(sidebar?.textContent).not.toContain("浅色模式");

    const topbar = container.querySelector("header");
    expect(topbar).not.toBeNull();
    expect(topbar?.className).toContain("h-16");
    expect(topbar?.className).toContain("z-");
    expect(topbar?.textContent).toContain("测试用户");
    expect(topbar?.textContent).not.toContain("深色模式");
    expect(topbar?.textContent).not.toContain("Workspace");

    const pageContent = container.querySelector("[data-testid='page-content']");
    expect(pageContent).not.toBeNull();
  });

  it("uses an icon-only dark mode toggle and a visible user dropdown on chat pages", async () => {
    currentTheme = "dark";

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/chats"]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="chats" element={<div data-testid="page-content">chat</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    const topbar = container.querySelector("header");
    expect(topbar?.textContent).toContain("会话");
    expect(topbar?.textContent).not.toContain("Workspace");
    expect(topbar?.textContent).not.toContain("统一管理智能会话与运行状态");
    expect(topbar?.className).toContain("relative");

    const themeButton = container.querySelector('button[aria-label="切换到浅色模式"]');
    expect(themeButton).not.toBeNull();
    expect(themeButton?.className).toContain("w-10");
    expect(themeButton?.textContent?.trim()).toBe("");

    const userButton = container.querySelector('button[aria-label="打开用户菜单"]');
    expect(userButton).not.toBeNull();

    await act(async () => {
      userButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dropdown = container.querySelector('[data-testid="topbar-user-menu"]');
    expect(dropdown).not.toBeNull();
    expect(dropdown?.className).toContain("z-50");
  });
});
