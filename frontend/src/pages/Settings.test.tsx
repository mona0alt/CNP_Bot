// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Settings } from "./Settings";

const logoutMock = vi.fn(async () => {});
const clipboardWriteTextMock = vi.fn(async () => {});
let mockUser = { id: "u1", username: "tester", role: "admin", display_name: "Tester" };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    user: mockUser,
    logout: logoutMock,
  }),
}));

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function flushWithFakeTimers(ms = 0): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setNativeInputValue(element: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeSelectValue(element: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function createLocationMock() {
  let href = "http://localhost/settings";
  return {
    get href() {
      return href;
    },
    set href(next: string) {
      href = next;
    },
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
  } as unknown as Location;
}

function getSecretField(rootContainer: HTMLElement) {
  return rootContainer.querySelector('[data-testid="config-field-JWT_SECRET"]') as HTMLDivElement | null;
}

describe("Settings page", () => {
  let container: HTMLDivElement;
  let root: Root;

  const systemConfigPayload = {
    sections: [
      {
        id: "agent",
        title: "Agent 基础",
        fields: [
          {
            key: "ASSISTANT_NAME",
            section: "agent",
            label: "助手名称",
            type: "text",
            required: true,
            secret: false,
            restartRequired: true,
          },
          {
            key: "DEFAULT_AGENT_TYPE",
            section: "agent",
            label: "默认 Agent 类型",
            type: "select",
            required: true,
            secret: false,
            restartRequired: true,
            options: [
              { label: "Claude", value: "claude" },
              { label: "Deep Agent", value: "deepagent" },
            ],
          },
        ],
      },
      {
        id: "security",
        title: "认证安全",
        fields: [
          {
            key: "JWT_SECRET",
            section: "security",
            label: "JWT 密钥",
            type: "secret",
            required: true,
            secret: true,
            restartRequired: true,
          },
        ],
      },
    ],
    values: {
      ASSISTANT_NAME: "CNP Bot",
      DEFAULT_AGENT_TYPE: "claude",
      JWT_SECRET: "secret-1",
    },
    restart: {
      manager: "systemd-user",
      status: "running",
      canRestart: true,
    },
    pendingRestart: false,
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockUser = { id: "u1", username: "tester", role: "admin", display_name: "Tester" };
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardWriteTextMock,
      },
      configurable: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("masks secret fields by default, supports show/hide, and resets on remount", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse(systemConfigPayload);
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const secretField = getSecretField(container);
    expect(secretField).not.toBeNull();

    const secretInput = secretField?.querySelector("input") as HTMLInputElement | null;
    expect(secretInput).not.toBeNull();
    expect(secretInput?.type).toBe("password");

    const showButton = Array.from(secretField?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("显示"),
    );
    expect(showButton).not.toBeNull();

    await act(async () => {
      showButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(secretInput?.type).toBe("text");

    const hideButton = Array.from(getSecretField(container)?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("隐藏"),
    );
    expect(hideButton).not.toBeNull();

    await act(async () => {
      hideButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(secretInput?.type).toBe("password");

    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<Settings />);
    });
    await flush();

    const remountedSecretInput = getSecretField(container)?.querySelector("input") as HTMLInputElement | null;
    expect(remountedSecretInput?.type).toBe("password");
  });

  it("copies the real secret value for admins", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse(systemConfigPayload);
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const secretField = getSecretField(container);
    expect(secretField).not.toBeNull();

    const copyButton = Array.from(secretField?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("复制"),
    );
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("secret-1");
  });

  it("does not expose secret copying to non-admin users", async () => {
    mockUser = { id: "u2", username: "viewer", role: "user", display_name: "Viewer" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse(systemConfigPayload);
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const secretField = getSecretField(container);
    expect(secretField).not.toBeNull();

    const copyButton = Array.from(secretField?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("复制"),
    );
    expect(copyButton).toBeUndefined();

    const secretInput = secretField?.querySelector("input") as HTMLInputElement | null;
    expect(secretInput).not.toBeNull();

    await act(async () => {
      secretInput?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });

  it("shows a dangerous confirmation before saving when JWT_SECRET changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({
          sections: systemConfigPayload.sections,
          values: {
            ASSISTANT_NAME: "CNP Bot",
            DEFAULT_AGENT_TYPE: "claude",
            JWT_SECRET: "secret-2",
          },
        });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const secretField = getSecretField(container);
    const showButton = Array.from(secretField?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("显示"),
    );
    await act(async () => {
      showButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const secretInput = secretField?.querySelector("input") as HTMLInputElement | null;
    expect(secretInput).not.toBeNull();
    await act(async () => {
      setNativeInputValue(secretInput!, "secret-2");
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存配置"),
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("修改 JWT_SECRET 后，重启会导致现有登录失效并需要重新登录");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/api/system-config") && init?.method === "PUT")).toBe(false);

    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("继续保存"),
    );
    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/api/system-config") && init?.method === "PUT")).toBe(true);
  });

  it("loads sections and values from /api/system-config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse(systemConfigPayload);
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/system-config",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(container.textContent).toContain("Agent 基础");
    expect(container.textContent).toContain("认证安全");
    expect(container.textContent).toContain("助手名称");
    expect(container.textContent).toContain("JWT 密钥");

    const textInput = container.querySelector('input[value="CNP Bot"]') as HTMLInputElement | null;
    expect(textInput).not.toBeNull();
    expect(textInput?.value).toBe("CNP Bot");

    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("claude");
  });

  it("prefers a visible agent section as the default subpage when security appears first", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse({
          sections: [
            systemConfigPayload.sections[1],
            systemConfigPayload.sections[0],
          ],
          values: systemConfigPayload.values,
          restart: systemConfigPayload.restart,
          pendingRestart: false,
        });
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const agentSection = container.querySelector('[data-testid="config-section-agent"]') as HTMLElement | null;
    const securitySection = container.querySelector('[data-testid="config-section-security"]') as HTMLElement | null;
    expect(agentSection).not.toBeNull();
    expect(securitySection).not.toBeNull();

    expect(agentSection?.hidden).toBe(false);
    expect(securitySection?.hidden).toBe(true);
    expect(container.textContent).toContain("当前 Agent 基础");
    expect(container.querySelector('input[value="CNP Bot"]')).not.toBeNull();
  });

  it("logs out and redirects when loading system config receives 401", async () => {
    const locationMock = createLocationMock();
    vi.stubGlobal("location", locationMock);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse({ error: "Unauthorized" }, 401);
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(locationMock.href).toBe("/login");
  });

  it("groups fields by schema and saves edits through PUT /api/system-config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({
          sections: systemConfigPayload.sections,
          values: {
            ASSISTANT_NAME: "New Bot",
            DEFAULT_AGENT_TYPE: "deepagent",
            JWT_SECRET: "secret-1",
          },
        });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const sectionNavButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("Agent 基础") || button.textContent?.includes("认证安全"),
    );
    expect(sectionNavButtons.length).toBeGreaterThan(0);

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (input) => (input as HTMLInputElement).value === "CNP Bot",
    ) as HTMLInputElement | undefined;
    expect(nameInput).toBeDefined();
    await act(async () => {
      setNativeInputValue(nameInput!, "New Bot");
    });
    await flush();

    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    await act(async () => {
      setNativeSelectValue(select!, "deepagent");
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存配置"),
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/api/system-config") && init?.method === "PUT",
    );
    expect(saveCall).toBeTruthy();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      values: {
        ASSISTANT_NAME: "New Bot",
        DEFAULT_AGENT_TYPE: "deepagent",
        JWT_SECRET: "secret-1",
      },
    });
  });

  it("shows only the active section content and preserves current values when switching sections", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/system-config")) {
        return createJsonResponse(systemConfigPayload);
      }
      throw new Error(`Unhandled fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const agentSection = container.querySelector('[data-testid="config-section-agent"]') as HTMLElement | null;
    const securitySection = container.querySelector('[data-testid="config-section-security"]') as HTMLElement | null;
    expect(agentSection).not.toBeNull();
    expect(securitySection).not.toBeNull();

    expect(agentSection?.hidden).toBe(false);
    expect(securitySection?.hidden).toBe(true);
    expect(agentSection?.textContent).toContain("助手名称");
    expect(securitySection?.textContent).toContain("JWT 密钥");

    const securityNavButton = container.querySelector(
      '[data-testid="config-section-nav-security"]',
    ) as HTMLButtonElement | null;
    expect(securityNavButton).not.toBeNull();

    await act(async () => {
      securityNavButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(agentSection?.hidden).toBe(true);
    expect(securitySection?.hidden).toBe(false);

    const secretInput = securitySection?.querySelector("input") as HTMLInputElement | null;
    expect(secretInput).not.toBeNull();
    expect(secretInput?.value).toBe("secret-1");
  });

  it("shows backend errors returned by PUT /api/system-config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({ error: "保存失败：JWT 密钥格式不正确" }, 400);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存配置"),
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("保存失败：JWT 密钥格式不正确");
  });

  it("calls save then restart when save and restart is clicked", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({
          sections: systemConfigPayload.sections,
          values: {
            ASSISTANT_NAME: "Restart Bot",
            DEFAULT_AGENT_TYPE: "claude",
            JWT_SECRET: "secret-1",
          },
          restart: systemConfigPayload.restart,
          pendingRestart: false,
        });
      }
      if (url.endsWith("/api/system-config/restart") && method === "POST") {
        return createJsonResponse(
          {
            success: true,
            restart: {
              manager: "systemd-user",
              status: "running",
              canRestart: true,
            },
            pendingRestart: true,
          },
          202,
        );
      }
      if (url.endsWith("/api/system-config/restart-status") && method === "GET") {
        return createJsonResponse({ status: "healthy", message: null });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (input) => (input as HTMLInputElement).value === "CNP Bot",
    ) as HTMLInputElement | undefined;
    expect(nameInput).toBeDefined();

    await act(async () => {
      setNativeInputValue(nameInput!, "Restart Bot");
    });
    await flush();

    const saveAndRestartButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存并重启"),
    );
    expect(saveAndRestartButton).not.toBeNull();

    await act(async () => {
      saveAndRestartButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const methods = fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET");
    expect(methods).toContain("PUT");
    expect(methods).toContain("POST");

    const putIndex = fetchMock.mock.calls.findIndex(
      ([input, init]) => String(input).endsWith("/api/system-config") && (init?.method ?? "GET") === "PUT",
    );
    const postIndex = fetchMock.mock.calls.findIndex(
      ([input, init]) => String(input).endsWith("/api/system-config/restart") && init?.method === "POST",
    );
    expect(putIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(putIndex);
  });

  it("polls restart status until healthy", async () => {
    vi.useFakeTimers();
    let restartStatusCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse({
          ...systemConfigPayload,
          pendingRestart: true,
        });
      }
      if (url.endsWith("/api/system-config/restart-status") && method === "GET") {
        restartStatusCalls += 1;
        if (restartStatusCalls < 2) {
          return createJsonResponse({ status: "starting", message: null });
        }
        return createJsonResponse({ status: "healthy", message: null });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flushWithFakeTimers();

    await flushWithFakeTimers(2000);
    await flushWithFakeTimers(2000);

    expect(restartStatusCalls).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("服务已恢复");
  });

  it("shows that config is saved even when restart fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({
          sections: systemConfigPayload.sections,
          values: {
            ASSISTANT_NAME: "Saved Bot",
            DEFAULT_AGENT_TYPE: "claude",
            JWT_SECRET: "secret-1",
          },
          restart: systemConfigPayload.restart,
          pendingRestart: false,
        });
      }
      if (url.endsWith("/api/system-config/restart") && method === "POST") {
        return createJsonResponse({ error: "restart_command_failed" }, 500);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (input) => (input as HTMLInputElement).value === "CNP Bot",
    ) as HTMLInputElement | undefined;
    expect(nameInput).toBeDefined();

    await act(async () => {
      setNativeInputValue(nameInput!, "Saved Bot");
    });
    await flush();

    const saveAndRestartButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存并重启"),
    );
    expect(saveAndRestartButton).not.toBeNull();

    await act(async () => {
      saveAndRestartButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("配置已保存，但服务重启失败");
    expect(container.querySelector('input[value="Saved Bot"]')).not.toBeNull();
  });

  it("saves edited values from the active section subpage", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({
          sections: systemConfigPayload.sections,
          values: {
            ASSISTANT_NAME: "CNP Bot",
            DEFAULT_AGENT_TYPE: "claude",
            JWT_SECRET: "secret-2",
          },
          restart: systemConfigPayload.restart,
          pendingRestart: false,
        });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const securityNavButton = container.querySelector(
      '[data-testid="config-section-nav-security"]',
    ) as HTMLButtonElement | null;
    expect(securityNavButton).not.toBeNull();

    await act(async () => {
      securityNavButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const securitySection = container.querySelector('[data-testid="config-section-security"]') as HTMLElement | null;
    expect(securitySection).not.toBeNull();
    expect(securitySection?.hidden).toBe(false);

    const showButton = Array.from(securitySection?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("显示"),
    );
    expect(showButton).not.toBeNull();

    await act(async () => {
      showButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const secretInput = securitySection?.querySelector("input") as HTMLInputElement | null;
    expect(secretInput).not.toBeNull();

    await act(async () => {
      setNativeInputValue(secretInput!, "secret-2");
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存配置"),
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("修改 JWT_SECRET 后，重启会导致现有登录失效并需要重新登录");

    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("继续保存"),
    );
    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/api/system-config") && init?.method === "PUT",
    );
    expect(saveCall).toBeTruthy();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      values: {
        ASSISTANT_NAME: "CNP Bot",
        DEFAULT_AGENT_TYPE: "claude",
        JWT_SECRET: "secret-2",
      },
    });
  });

  it("logs out and redirects when saving system config receives 403", async () => {
    const locationMock = createLocationMock();
    vi.stubGlobal("location", locationMock);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/system-config") && method === "GET") {
        return createJsonResponse(systemConfigPayload);
      }
      if (url.endsWith("/api/system-config") && method === "PUT") {
        return createJsonResponse({ error: "Forbidden" }, 403);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Settings />);
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("保存配置"),
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(locationMock.href).toBe("/login");
  });
});
