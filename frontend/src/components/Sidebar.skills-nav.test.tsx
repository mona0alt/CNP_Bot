// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

type UserRole = "admin" | "user";

let currentRole: UserRole = "user";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "tester", role: currentRole, display_name: "Tester" },
    logout: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: "light",
    toggleTheme: vi.fn(),
  }),
}));

describe("Sidebar skills links", () => {
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
    currentRole = "user";
  });

  it("shows unified skills route in sidebar for admins", async () => {
    currentRole = "admin";

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("技能");
    expect(container.textContent).not.toContain("技能管理");
    expect(container.textContent).not.toContain("技能目录");
  });

  it("shows unified skills route for normal users", async () => {
    currentRole = "user";

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Sidebar />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("技能");
    expect(container.textContent).not.toContain("技能管理");
    expect(container.textContent).not.toContain("技能目录");
  });
});
