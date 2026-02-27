
import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = 3001;
const TARGET_HOST = 'llmproxy.gwm.cn';
const TARGET_PATH = '/v1/messages';
const LOG_FILE = path.join(process.cwd(), 'llm-proxy.log');

function logToFile(msg: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
}

app.use(express.json({ limit: '50mb' }));

const REAL_API_KEY = 'BIxGVuCDi8CFldOYiGkLfUzb0soXscOOYEG7n8unjLLMzfihOEHKDEWLe1dfxMqzvdW1DHrJs9fz';

app.post('/v1/messages', (req, res) => {
  const logMsg = 'Proxy received request for /v1/messages';
  console.log(logMsg);
  logToFile(logMsg);
  
  if (!req.body || !req.body.model) {
      const errMsg = `Invalid body: ${JSON.stringify(req.body)}`;
      console.error(errMsg);
      logToFile(errMsg);
      return res.status(400).send('Invalid request body');
  }

  // Rewrite model
  const originalModel = req.body.model;
  req.body.model = 'default/minimax-m2-5';
  const rewriteMsg = `Rewrote model: ${originalModel} -> ${req.body.model}`;
  console.log(rewriteMsg);
  logToFile(rewriteMsg);

  const bodyString = JSON.stringify(req.body);

  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: TARGET_PATH,
    method: 'POST',
    headers: {
      ...req.headers,
      'host': TARGET_HOST,
      'content-length': Buffer.byteLength(bodyString),
      'x-api-key': REAL_API_KEY, // Inject real key
    },
  };
  
  // Remove headers that might cause issues if copied directly
  delete options.headers['connection'];
  delete options.headers['transfer-encoding'];

  const proxyReq = https.request(options, (proxyRes) => {
    const statusMsg = `Proxy response status: ${proxyRes.statusCode}`;
    console.log(statusMsg);
    logToFile(statusMsg);
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    const errorMsg = `Proxy error: ${err}`;
    console.error(errorMsg);
    logToFile(errorMsg);
    if (!res.headersSent) {
        res.status(500).send(err.message);
    }
  });

  proxyReq.write(bodyString);
  proxyReq.end();
});

app.post('/v1/messages/count_tokens', (req, res) => {
    console.log('Serving mocked /v1/messages/count_tokens');
    // Mock response for count_tokens
    // { "input_tokens": 123 }
    // We can try to be smart or just return a dummy value.
    // If we return dummy, context management might be off, but it should work.
    res.json({ input_tokens: 100 });
});

app.get('/v1/models', (req, res) => {
    console.log('Serving mocked /v1/models');
    res.json({
        object: "list",
        data: [
            {
                type: "model",
                id: "claude-3-5-sonnet-20241022",
                display_name: "Claude 3.5 Sonnet",
                created_at: "2024-10-22T00:00:00Z"
            }
        ],
        has_more: false,
        first_id: "claude-3-5-sonnet-20241022",
        last_id: "claude-3-5-sonnet-20241022"
    });
});

app.all('/', (req, res) => {
    console.log(`Serving root request: ${req.method}`);
    res.status(200).json({ status: "ok" });
});

// Handle other routes (like /v1/models) just in case
app.use((req, res) => {
    console.log(`Proxying ${req.method} ${req.url}`);
    // Naive proxy for other endpoints
    // But we might need to rewrite response for /v1/models to trick claude
    // For now, let's hope it only calls /v1/messages
    res.status(404).send('Not found in local proxy');
});

app.listen(PORT, () => {
  console.log(`Local LLM Proxy running on port ${PORT}`);
  console.log(`Target: https://${TARGET_HOST}${TARGET_PATH}`);
});
