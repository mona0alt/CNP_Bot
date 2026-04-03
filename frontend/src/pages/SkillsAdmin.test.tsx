// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SkillsAdmin } from "./SkillsAdmin";
import { SkillsCatalog } from "./SkillsCatalog";

let currentRole: "admin" | "user" = "admin";
const logoutMock = vi.fn(async () => {});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { id: "u1", username: "tester", role: currentRole, display_name: "Tester" },
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

describe("Skills pages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    currentRole = "admin";
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads and renders the admin skills tree", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/skills")) {
        return createJsonResponse([
          { name: "tmux", has_skill_md: true, updated_at: "2026-04-03T09:00:00.000Z" },
        ]);
      }
      if (url.endsWith("/api/skills/tree")) {
        return createJsonResponse([
          {
            name: "tmux",
            path: "tmux",
            type: "directory",
            children: [{ name: "SKILL.md", path: "tmux/SKILL.md", type: "file", editable: true }],
          },
        ]);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SkillsAdmin />);
    });
    await flush();

    expect(container.textContent).toContain("tmux");
    expect(container.textContent).toContain("SKILL.md");
  });

  it("opens a text file and saves edits", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/skills")) {
        return createJsonResponse([
          { name: "tmux", has_skill_md: true, updated_at: "2026-04-03T09:00:00.000Z" },
        ]);
      }
      if (url.endsWith("/api/skills/tree")) {
        return createJsonResponse([
          {
            name: "tmux",
            path: "tmux",
            type: "directory",
            children: [{ name: "SKILL.md", path: "tmux/SKILL.md", type: "file", editable: true }],
          },
        ]);
      }
      if (url.includes("/api/skills/file?path=tmux%2FSKILL.md")) {
        return createJsonResponse({
          path: "tmux/SKILL.md",
          content: "# old content",
          editable: true,
        });
      }
      if (url.endsWith("/api/skills/file") && method === "PUT") {
        return createJsonResponse({ success: true });
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SkillsAdmin />);
    });
    await flush();

    const fileButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("SKILL.md"),
    );
    expect(fileButton).not.toBeNull();

    await act(async () => {
      fileButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const editor = container.querySelector("textarea");
    expect(editor).not.toBeNull();
    await act(async () => {
      editor!.value = "# new content";
      editor!.dispatchEvent(new Event("input", { bubbles: true }));
      editor!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存"),
    );
    expect(saveButton).not.toBeNull();
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/api/skills/file") && init?.method === "PUT",
    );
    expect(saveCall).toBeTruthy();
    const body = JSON.parse(String(saveCall?.[1]?.body));
    expect(body.path).toBe("tmux/SKILL.md");
    expect(body.content).toBe("# new content");
  });

  it("shows upload validation errors from the api", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/skills")) {
        return createJsonResponse([]);
      }
      if (url.endsWith("/api/skills/tree")) {
        return createJsonResponse([]);
      }
      if (url.endsWith("/api/skills/upload-zip") && method === "POST") {
        return createJsonResponse({ error: "zip 缺少 SKILL.md" }, 400);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SkillsAdmin />);
    });
    await flush();

    const openUploadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("上传 ZIP"),
    );
    expect(openUploadButton).not.toBeNull();
    await act(async () => {
      openUploadButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const zipFile = new File(["test"], "skill.zip", { type: "application/zip" });
    Object.defineProperty(fileInput!, "files", {
      value: [zipFile],
      configurable: true,
    });
    await act(async () => {
      fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const uploadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("确认上传"),
    );
    expect(uploadButton).not.toBeNull();
    await act(async () => {
      uploadButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("zip 缺少 SKILL.md");
  });

  it("renders a read-only catalog preview for normal users", async () => {
    currentRole = "user";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/skills/catalog")) {
        return createJsonResponse([
          { name: "prometheus", has_skill_md: true, updated_at: "2026-04-03T09:00:00.000Z" },
        ]);
      }
      throw new Error(`Unhandled fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SkillsCatalog />);
    });
    await flush();

    expect(container.textContent).toContain("prometheus");
    expect(container.textContent).not.toContain("上传 ZIP");
    expect(container.textContent).not.toContain("保存");
  });
});
