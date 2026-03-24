const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUTPUT_START_MARKER = '---CNP_BOT_OUTPUT_START---';
const OUTPUT_END_MARKER = '---CNP_BOT_OUTPUT_END---';
const DEFAULT_BASE_URL = 'http://192.168.231.128:30080';
const DEFAULT_MODEL = readEnvFileValue('MODEL')
  || readEnvFileValue('ANTHROPIC_MODEL')
  || process.env.MODEL
  || process.env.ANTHROPIC_MODEL
  || '/model/MiniMax-M2___5';
const DEFAULT_BASH_COMMAND = "printf 'tool-503-probe\\n'";

function readEnvFileValue(key) {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return undefined;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim();
  }
  return undefined;
}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function getIntArg(flag, fallback) {
  const raw = getArg(flag);
  if (!raw) return fallback;
  const num = Number.parseInt(raw, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function extractOutputs(buffer) {
  const objects = [];
  let rest = buffer;

  while (true) {
    const start = rest.indexOf(OUTPUT_START_MARKER);
    if (start === -1) break;
    const end = rest.indexOf(OUTPUT_END_MARKER, start);
    if (end === -1) break;

    const payload = rest
      .slice(start + OUTPUT_START_MARKER.length, end)
      .trim();
    try {
      objects.push(JSON.parse(payload));
    } catch (err) {
      objects.push({
        __parseError: err instanceof Error ? err.message : String(err),
        __raw: payload,
      });
    }
    rest = rest.slice(end + OUTPUT_END_MARKER.length);
  }

  return { objects, rest };
}

function formatMs(ms) {
  return ms == null ? '-' : `${ms}ms`;
}

async function runOnce(runId, baseUrl, model, options = {}) {
  const bashCommand = options.bashCommand || DEFAULT_BASH_COMMAND;
  const workerId = options.workerId || 1;
  const roundId = options.roundId || runId;
  const runner = path.resolve('container/agent-runner/dist/index.js');
  const runRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `cnp-tool-503-tooluse-${Date.now()}-${workerId}-${roundId}-`),
  );
  const workspaceRoot = path.join(runRoot, 'workspace');
  const ipcDir = path.join(workspaceRoot, 'ipc');
  const ipcInputDir = path.join(ipcDir, 'input');
  const groupDir = path.join(workspaceRoot, 'group');
  const globalDir = path.join(workspaceRoot, 'global');
  const homeDir = path.join(runRoot, 'home');

  fs.mkdirSync(ipcDir, { recursive: true });
  fs.mkdirSync(groupDir, { recursive: true });
  fs.mkdirSync(globalDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  const input = {
    prompt: [
      '你必须调用一次 Bash 工具。',
      `请执行命令：${bashCommand}`,
      '除了这一次 Bash，不要调用其他工具。',
      '拿到结果后只回复：DONE',
    ].join('\n'),
    groupFolder: 'main',
    chatJid: `web:tool-use-repro-${Date.now()}-${workerId}-${roundId}`,
    isMain: true,
    secrets: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy',
      CLAUDE_CODE_OAUTH_TOKEN:
        process.env.CLAUDE_CODE_OAUTH_TOKEN || 'dummy-token',
      ANTHROPIC_BASE_URL: baseUrl,
      CLAUDE_BASE_URL: baseUrl,
      MODEL: model,
    },
  };

  const startedAt = Date.now();
  let toolUseAtMs = null;
  let toolResultAtMs = null;
  let sawToolUse = false;
  let sawToolResult = false;
  let saw503 = false;
  let http503Count = 0;
  let agentError = null;
  let finalResultPreview = null;
  let stdoutBuffer = '';
  let stderrPreview = '';
  let closeSent = false;
  let sdkDebugLogPath = null;

  const signalClose = () => {
    if (closeSent) return;
    fs.mkdirSync(ipcInputDir, { recursive: true });
    fs.writeFileSync(path.join(ipcInputDir, '_close'), '');
    closeSent = true;
  };

  const handleParsedObject = (obj) => {
    if (obj && obj.status === 'error' && obj.error) {
      agentError = String(obj.error);
      signalClose();
    }

    if (obj && typeof obj.result === 'string' && obj.result) {
      finalResultPreview = obj.result.slice(0, 200);
      signalClose();
    }

    const event = obj && obj.streamEvent && obj.streamEvent.event;
    if (
      event
      && event.type === 'content_block_start'
      && event.content_block
      && event.content_block.type === 'tool_use'
    ) {
      sawToolUse = true;
      if (toolUseAtMs === null) {
        toolUseAtMs = Date.now() - startedAt;
        console.log(
          `[run ${runId}] 捕获 tool_use: name=${event.content_block.name} at=${toolUseAtMs}ms`,
        );
      }
    }

    if (event && (event.type === 'tool_result' || event.type === 'tool_result_delta')) {
      sawToolResult = true;
      if (toolResultAtMs === null) {
        toolResultAtMs = Date.now() - startedAt;
        console.log(`[run ${runId}] 捕获 tool_result at=${toolResultAtMs}ms`);
      }
    }

    const nestedEvent = obj && obj.streamEvent;
    if (nestedEvent && nestedEvent.event && nestedEvent.event.type === 'tool_result') {
      sawToolResult = true;
      if (toolResultAtMs === null) {
        toolResultAtMs = Date.now() - startedAt;
        console.log(`[run ${runId}] 捕获 tool_result at=${toolResultAtMs}ms`);
      }
    }
  };

  console.log(
    `[run ${runId}] 启动: worker=${workerId} round=${roundId} baseUrl=${baseUrl} model=${model} bash=${JSON.stringify(bashCommand)} workspace=${workspaceRoot}`,
  );

  const proc = spawn('node', [runner], {
    cwd: path.resolve('.'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WORKSPACE_ROOT: workspaceRoot,
      IPC_DIR: ipcDir,
      HOME: homeDir,
      LOG_LEVEL: 'debug',
      CLAUDE_LOG_LEVEL: 'debug',
      DEBUG_CLAUDE_AGENT_SDK: '1',
    },
  });

  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();

  proc.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const { objects, rest } = extractOutputs(stdoutBuffer);
    stdoutBuffer = rest;

    for (const obj of objects) {
      handleParsedObject(obj);
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[run ${runId}][stderr] ${text}`);
    if (stderrPreview.length < 2000) {
      stderrPreview += text.slice(0, 2000 - stderrPreview.length);
    }

    const match = text.match(/SDK debug logs: ([^\n]+)/);
    if (match) {
      sdkDebugLogPath = match[1].trim();
    }

    const matches = text.match(/503 upstream connect error or disconnect\/reset before headers/g);
    if (matches && matches.length > 0) {
      saw503 = true;
      http503Count += matches.length;
    }
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });

  if (stdoutBuffer.includes(OUTPUT_START_MARKER)) {
    const { objects } = extractOutputs(stdoutBuffer + OUTPUT_END_MARKER);
    for (const obj of objects) {
      handleParsedObject(obj);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const toolUseToResultMs =
    toolUseAtMs !== null && toolResultAtMs !== null
      ? toolResultAtMs - toolUseAtMs
      : null;

  if (sdkDebugLogPath && fs.existsSync(sdkDebugLogPath)) {
    const sdkLogText = fs.readFileSync(sdkDebugLogPath, 'utf8');
    const matches = sdkLogText.match(/503 upstream connect error or disconnect\/reset before headers/g);
    if (matches && matches.length > 0) {
      saw503 = true;
      http503Count = Math.max(http503Count, matches.length);
    }
  }

  console.log(
    `[run ${runId}] 完成: exit=${String(exitCode)} elapsed=${elapsedMs}ms tool_use=${formatMs(toolUseAtMs)} tool_result=${formatMs(toolResultAtMs)} tool_use->tool_result=${formatMs(toolUseToResultMs)} 503=${http503Count}`,
  );

  return {
    runId,
    workerId,
    roundId,
    bashCommand,
    exitCode,
    elapsedMs,
    toolUseAtMs,
    toolResultAtMs,
    toolUseToResultMs,
    sawToolUse,
    sawToolResult,
    saw503,
    http503Count,
    agentError,
    finalResultPreview,
    stderrPreview,
    sdkDebugLogPath,
    workspaceRoot,
  };
}

async function runWorker(workerId, iterations, baseUrl, model, bashCommand) {
  const results = [];
  for (let roundId = 1; roundId <= iterations; roundId += 1) {
    const runId = ((workerId - 1) * iterations) + roundId;
    results.push(await runOnce(runId, baseUrl, model, {
      workerId,
      roundId,
      bashCommand,
    }));
  }
  return results;
}

function formatRatio(numerator, denominator) {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

async function main() {
  const iterations = getIntArg('--iterations', 1);
  const concurrency = getIntArg('--concurrency', 1);
  const baseUrl = getArg('--url', DEFAULT_BASE_URL) || DEFAULT_BASE_URL;
  const model = getArg('--model', DEFAULT_MODEL) || DEFAULT_MODEL;
  const bashCommand = getArg('--bash-command', DEFAULT_BASH_COMMAND) || DEFAULT_BASH_COMMAND;

  console.log(`tool_use 压测配置: concurrency=${concurrency} iterations=${iterations} baseUrl=${baseUrl} model=${model} bash=${JSON.stringify(bashCommand)}`);
  const workerResults = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      runWorker(index + 1, iterations, baseUrl, model, bashCommand)),
  );
  const results = workerResults.flat();

  const reproduced = results.filter((item) => item.saw503).length;
  const withToolUse = results.filter((item) => item.sawToolUse).length;
  const withToolResult = results.filter((item) => item.sawToolResult).length;
  const withErrors = results.filter((item) => item.agentError).length;
  const toolUseToResult = results
    .map((item) => item.toolUseToResultMs)
    .filter((value) => value !== null);
  const totalElapsed = results
    .map((item) => item.elapsedMs)
    .filter((value) => value !== null);
  const total503 = results.reduce((sum, item) => sum + item.http503Count, 0);

  const avgToolUseToResult = toolUseToResult.length > 0
    ? Math.round(toolUseToResult.reduce((sum, n) => sum + n, 0) / toolUseToResult.length)
    : null;
  const maxToolUseToResult = toolUseToResult.length > 0
    ? Math.max(...toolUseToResult)
    : null;
  const avgElapsed = totalElapsed.length > 0
    ? Math.round(totalElapsed.reduce((sum, n) => sum + n, 0) / totalElapsed.length)
    : null;
  const maxElapsed = totalElapsed.length > 0
    ? Math.max(...totalElapsed)
    : null;

  console.log('\n=== 汇总 ===');
  console.log(`总轮次: ${results.length}`);
  console.log(`触发 tool_use: ${withToolUse}/${results.length} (${formatRatio(withToolUse, results.length)})`);
  console.log(`收到 tool_result: ${withToolResult}/${results.length} (${formatRatio(withToolResult, results.length)})`);
  console.log(`复现 503: ${reproduced}/${results.length} (${formatRatio(reproduced, results.length)})`);
  console.log(`agent error: ${withErrors}/${results.length}`);
  console.log(`503 总次数: ${total503}`);
  console.log(`总耗时 平均: ${formatMs(avgElapsed)}`);
  console.log(`总耗时 最大: ${formatMs(maxElapsed)}`);
  console.log(`tool_use->tool_result 平均: ${formatMs(avgToolUseToResult)}`);
  console.log(`tool_use->tool_result 最大: ${formatMs(maxToolUseToResult)}`);
  console.log('\n=== 明细(简表) ===');
  for (const item of results) {
    console.log(
      `worker=${item.workerId} round=${item.roundId} exit=${item.exitCode} tool_use=${item.sawToolUse ? 'Y' : 'N'} tool_result=${item.sawToolResult ? 'Y' : 'N'} 503=${item.http503Count} elapsed=${formatMs(item.elapsedMs)} tool_use->tool_result=${formatMs(item.toolUseToResultMs)}`,
    );
  }
  console.log('\n=== 明细(JSON) ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
