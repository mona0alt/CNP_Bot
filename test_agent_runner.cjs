const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Read .env manually
const envPath = path.join(__dirname, '.env');
let env = {};
try {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) env[key.trim()] = val.trim();
  });
} catch (e) {
  console.log('No .env file found');
}

// Mock Workspace
const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-workspace-test-'));
const groupDir = path.join(__dirname, 'groups/main');
const groupLink = path.join(tempWorkspace, 'group');

if (!fs.existsSync(groupDir)) {
    fs.mkdirSync(groupDir, { recursive: true });
}
// Symlink group dir
try {
    fs.symlinkSync(groupDir, groupLink);
} catch (e) {
    console.log('Symlink failed, copying instead');
    fs.mkdirSync(groupLink, { recursive: true });
}

// Also need ipc dir
const ipcDir = path.join(__dirname, 'data/ipc/main');
const ipcLink = path.join(tempWorkspace, 'ipc');
if (!fs.existsSync(ipcDir)) {
    fs.mkdirSync(ipcDir, { recursive: true });
}
try {
    fs.symlinkSync(ipcDir, ipcLink);
} catch (e) {
    fs.mkdirSync(ipcLink, { recursive: true });
}


const input = {
  prompt: "Hello",
  groupFolder: "main",
  chatJid: "web:default",
  isMain: true,
  assistantName: "Andy",
  secrets: {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    CLAUDE_BASE_URL: env.CLAUDE_BASE_URL,
    MODEL: env.MODEL
  }
};

const agentRunnerPath = path.join(__dirname, 'container/agent-runner/dist/index.js');
console.log(`Running agent runner at: ${agentRunnerPath}`);
console.log(`Workspace root: ${tempWorkspace}`);

const child = spawn('node', [agentRunnerPath], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { 
      ...process.env, 
      ...env, 
      ...input.secrets,
      WORKSPACE_ROOT: tempWorkspace
  }
});

child.stdin.write(JSON.stringify(input));
child.stdin.end();

child.on('close', (code) => {
  console.log(`Child exited with code ${code}`);
  // Cleanup
  // fs.rmSync(tempWorkspace, { recursive: true, force: true });
});

child.on('error', (err) => {
  console.error('Failed to start child process:', err);
});
