// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextType } from "@/contexts/AuthContext";

import { Users } from "./Users";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Users 页面比例", () => {
  let container: HTMLDivElement;
  let root: Root;

  const authValue: AuthContextType = {
    user: { id: "u-1", username: "admin", role: "admin", display_name: "Admin" },
    token: "test-token",
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(async () => {}),
    changePassword: vi.fn(),
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/users" && (!init || !init.method)) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "1",
                username: "alice",
                role: "admin",
                display_name: "Alice",
                created_at: "2026-04-10T08:00:00.000Z",
                updated_at: "2026-04-10T08:00:00.000Z",
                last_login: "2026-04-12T10:00:00.000Z",
              },
            ],
          } as Response;
        }

        throw new Error(`Unhandled fetch: ${String(input)}`);
      }),
    );

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

  it("提升标题、表格和 CRUD 入口的比例基线", async () => {
    await act(async () => {
      root.render(
        <AuthContext.Provider value={authValue}>
          <Users />
        </AuthContext.Provider>,
      );
    });
    await flush();

    const pageTitle = container.querySelector("h1");
    expect(pageTitle).not.toBeNull();
    expect(pageTitle?.textContent).toBe("User Management");
    expect(pageTitle?.className).toContain("text-2xl");
    expect(pageTitle?.className).not.toContain("text-lg");

    const primaryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add User"),
    );
    expect(primaryButton).not.toBeUndefined();
    expect(primaryButton?.className).toContain("h-10");
    expect(primaryButton?.className).toContain("text-sm");
    expect(primaryButton?.className).not.toContain("text-[13px]");

    const tableHeaders = Array.from(container.querySelectorAll("th"));
    expect(tableHeaders.map((header) => header.textContent?.trim())).toEqual([
      "Username",
      "Display Name",
      "Role",
      "Last Login",
      "Actions",
    ]);
    tableHeaders.forEach((header) => {
      expect(header.className).toContain("text-sm");
      expect(header.className).not.toContain("text-[12px]");
    });

    const roleBadge = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent?.trim() === "admin",
    );
    expect(roleBadge).not.toBeUndefined();
    expect(roleBadge?.className).toContain("text-xs");
    expect(roleBadge?.className).not.toContain("text-[11px]");

    const editButton = container.querySelector('button[title="Edit"]');
    const deleteButton = container.querySelector('button[title="Delete"]');
    expect(editButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();
    expect(editButton?.className).toContain("h-9");
    expect(deleteButton?.className).toContain("h-9");

    await act(async () => {
      primaryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const modalTitle = Array.from(container.querySelectorAll("h2")).find(
      (heading) => heading.textContent?.trim() === "Add User",
    );
    expect(modalTitle).not.toBeUndefined();
    expect(modalTitle?.className).toContain("text-2xl");

    const usernameLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent?.trim() === "Username",
    );
    expect(usernameLabel).not.toBeUndefined();
    expect(usernameLabel?.className).toContain("text-sm");

    const usernameInput = container.querySelector('input[type="text"]');
    expect(usernameInput).not.toBeNull();
    expect(usernameInput?.className).toContain("h-11");
    expect(usernameInput?.className).toContain("text-sm");

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Create",
    );
    expect(createButton).not.toBeUndefined();
    expect(createButton?.className).toContain("h-11");
    expect(createButton?.className).toContain("text-sm");
  });
});
