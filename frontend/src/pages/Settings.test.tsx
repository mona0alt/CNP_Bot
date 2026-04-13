// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Settings } from "./Settings";

const logoutMock = vi.fn(async () => {});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { id: "u1", username: "tester", role: "admin", display_name: "Tester" },
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
  };

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
