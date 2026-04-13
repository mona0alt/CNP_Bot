// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextType } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

import { Login } from "./Login";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Login 页面比例", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
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
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("保持登录页标题、说明、控件和提示区的统一比例", async () => {
    const login: AuthContextType["login"] = async (username, password) => {
      void username;
      void password;
      throw new Error("Invalid credentials");
    };

    const authValue: AuthContextType = {
      user: null,
      token: null,
      isLoading: false,
      login,
      logout: vi.fn(async () => {}),
      changePassword: vi.fn(),
    };

    await act(async () => {
      root.render(
        <MemoryRouter>
          <AuthContext.Provider value={authValue}>
            <ThemeProvider>
              <Login />
            </ThemeProvider>
          </AuthContext.Provider>
        </MemoryRouter>,
      );
    });
    await flush();

    const heroTitle = container.querySelector("main h1");
    expect(heroTitle).not.toBeNull();
    expect(heroTitle?.className).toContain("text-4xl");
    expect(heroTitle?.className).toContain("sm:text-5xl");

    const heroDescription = Array.from(container.querySelectorAll("p")).find((node) =>
      node.textContent?.includes("container-native AI operations"),
    );
    expect(heroDescription).not.toBeUndefined();
    expect(heroDescription?.className).toContain("text-lg");
    expect(heroDescription?.className).toContain("leading-8");

    const themeToggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.getAttribute("aria-label")?.includes("mode"),
    );
    expect(themeToggle).not.toBeUndefined();
    expect(themeToggle?.className).toContain("h-10");
    expect(themeToggle?.className).toContain("text-sm");

    const cardTitle = Array.from(container.querySelectorAll("h2")).find((node) =>
      node.textContent?.includes("Sign in to CNP-Bot"),
    );
    expect(cardTitle).not.toBeUndefined();
    expect(cardTitle?.className).toContain("text-3xl");

    const cardDescription = Array.from(container.querySelectorAll("p")).find((node) =>
      node.textContent?.includes("Continue to your operational workspace."),
    );
    expect(cardDescription).not.toBeUndefined();
    expect(cardDescription?.className).toContain("text-base");
    expect(cardDescription?.className).toContain("leading-7");

    const usernameInput = container.querySelector("#username") as HTMLInputElement | null;
    const passwordInput = container.querySelector("#password") as HTMLInputElement | null;
    expect(usernameInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(usernameInput?.className).toContain("h-14");
    expect(usernameInput?.className).toContain("text-base");
    expect(passwordInput?.className).toContain("h-14");
    expect(passwordInput?.className).toContain("text-base");

    await act(async () => {
      usernameInput!.value = "ops";
      usernameInput!.dispatchEvent(new Event("input", { bubbles: true }));
      usernameInput!.dispatchEvent(new Event("change", { bubbles: true }));

      passwordInput!.value = "bad-password";
      passwordInput!.dispatchEvent(new Event("input", { bubbles: true }));
      passwordInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Enter Workspace"),
    );
    expect(submitButton).not.toBeUndefined();
    expect(submitButton?.className).toContain("h-14");
    expect(submitButton?.className).toContain("text-base");

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Invalid credentials");
    expect(alert?.className).toContain("px-4");
    expect(alert?.className).toContain("py-3");
    expect(alert?.className).toContain("text-sm");
  });
});
