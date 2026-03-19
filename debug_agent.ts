
import { spawn } from 'child_process';
import path from 'path';

const runner = path.resolve('container/agent-runner/dist/index.js');

const input = {
  prompt: 'Hello',
  groupFolder: 'test',
  chatJid: 'test@g.us',
  isMain: false,
  secrets: {
    ANTHROPIC_API_KEY: 'sk-ant-dummy',
    CLAUDE_CODE_OAUTH_TOKEN: 'dummy-token',
    ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
    MODEL: 'MiniMax-M2.5'
  }
};

const proc = spawn('node', [runner], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: {
    ...process.env,
    WORKSPACE_ROOT: '/tmp/test-workspace',
    IPC_DIR: '/tmp/test-workspace/ipc',
    LOG_LEVEL: 'debug',
    CLAUDE_LOG_LEVEL: 'debug'
  }
});

proc.stdin.write(JSON.stringify(input));
proc.stdin.end();

proc.on('close', (code) => {
  console.log(`Exited with code ${code}`);
});
