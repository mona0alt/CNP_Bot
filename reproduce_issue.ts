
import { spawn } from 'child_process';
import path from 'path';

// Point to the compiled agent-runner
const runner = path.resolve('container/agent-runner/dist/index.js');

const input = {
  prompt: 'Hello',
  groupFolder: 'main', // Use 'main' to match the failing case
  chatJid: 'web:default',
  isMain: true,
  secrets: {
    ANTHROPIC_API_KEY: 'sk-ant-dummy',
    CLAUDE_CODE_OAUTH_TOKEN: 'dummy-token',
    ANTHROPIC_BASE_URL: 'http://localhost:3001',
    CLAUDE_BASE_URL: 'http://localhost:3001',
    MODEL: 'claude-3-5-sonnet-20241022'
  }
};

console.log('Spawning runner:', runner);
console.log('PATH:', process.env.PATH);
console.log('Input:', JSON.stringify(input, null, 2));

import fs from 'fs';

const WORKSPACE_ROOT = '/tmp/test-workspace-repro';
const IPC_DIR = path.join(WORKSPACE_ROOT, 'ipc');
const GROUP_DIR = path.join(WORKSPACE_ROOT, 'group');
const FAKE_HOME = '/tmp/test-home';

fs.mkdirSync(IPC_DIR, { recursive: true });
fs.mkdirSync(GROUP_DIR, { recursive: true });
fs.mkdirSync(FAKE_HOME, { recursive: true });

const proc = spawn('node', [runner], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: {
    ...process.env,
    WORKSPACE_ROOT,
    IPC_DIR,
    HOME: FAKE_HOME,
    // Enable verbose logging in agent-runner if it supports it
    LOG_LEVEL: 'debug',
    CLAUDE_LOG_LEVEL: 'debug',
    DEBUG_CLAUDE_AGENT_SDK: '1'
  }
});

proc.stdin.write(JSON.stringify(input));
proc.stdin.end();

proc.on('close', (code) => {
  console.log(`Exited with code ${code}`);
});
