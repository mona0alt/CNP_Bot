import { describe, expect, it } from "vitest";

import { redactSensitiveToolText } from "./tool-redaction";

describe("tool redaction", () => {
  it("会隐藏 sshpass 明文密码", () => {
    expect(
      redactSensitiveToolText(
        "sshpass -p 'super-secret' ssh user@example.com",
      ),
    ).toBe("sshpass -p '***' ssh user@example.com");
  });

  it("不会修改普通命令", () => {
    expect(redactSensitiveToolText("bash /tmp/test.sh")).toBe(
      "bash /tmp/test.sh",
    );
  });
});
