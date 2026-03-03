#!/bin/bash

# Get the directory where the script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "==========================================="
echo "   NanoClaw Local IP Access Startup Script"
echo "==========================================="

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Configuration Check & Creation

# Check .env
if [ ! -f .env ]; then
    echo "Creating .env configuration..."
    cat > .env <<EOL
USE_LOCAL_AGENT=true
ASSISTANT_NAME=Andy
HOST=0.0.0.0
EOL
else
    echo "✓ .env found"
    # Ensure USE_LOCAL_AGENT=true is present
    if ! grep -q "USE_LOCAL_AGENT=true" .env; then
        echo "USE_LOCAL_AGENT=true" >> .env
        echo "  Added USE_LOCAL_AGENT=true to .env"
    fi
    # Ensure HOST=0.0.0.0 is present
    if ! grep -q "HOST=0.0.0.0" .env; then
        echo "HOST=0.0.0.0" >> .env
        echo "  Added HOST=0.0.0.0 to .env"
    fi
fi

# Check frontend/vite.config.ts
# We create a vite.config.ts that binds to 0.0.0.0 but DOES NOT rely on proxy for API calls
# because the frontend code has been modified to use direct API calls to port 3000
if [ ! -f frontend/vite.config.ts ]; then
    echo "Creating frontend/vite.config.ts..."
    cat > frontend/vite.config.ts <<EOL
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0',
    // Proxy is kept as fallback, but frontend code uses direct port 3000 in development
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
EOL
else
    echo "✓ frontend/vite.config.ts found"
fi

# 2. Dependency Check

if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
else
    echo "✓ Backend dependencies found"
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd frontend
    npm install
    cd ..
else
    echo "✓ Frontend dependencies found"
fi

# Check container agent runner (required for local agent execution)
if [ ! -f "container/agent-runner/dist/index.js" ]; then
    echo "Building container agent runner..."
    cd container/agent-runner
    npm install && npm run build
    cd ../..
else
    echo "✓ Container agent runner built"
fi

# 3. Start Services

echo ""
echo "Starting services..."

# Cleanup function to kill background processes on exit
cleanup() {
    echo ""
    echo "Stopping services..."
    # Kill process group to ensure child processes (like tsx watch) are also killed
    if [ -n "$BACKEND_PID" ]; then
        kill -TERM -$BACKEND_PID 2>/dev/null || kill $BACKEND_PID 2>/dev/null
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill -TERM -$FRONTEND_PID 2>/dev/null || kill $FRONTEND_PID 2>/dev/null
    fi
    exit
}

# Trap SIGINT (Ctrl+C)
trap cleanup SIGINT

# Start Backend
echo "Starting Backend (Port 3000)..."
# Use setsid to create a new process group so we can kill the whole tree later
setsid npm run dev > /dev/null 2>&1 &
BACKEND_PID=$!

# Wait a moment for backend to initialize
sleep 3

# Start Frontend
echo "Starting Frontend (Port 5173/5174)..."
cd frontend
# Force host 0.0.0.0
setsid npm run dev -- --host 0.0.0.0 > /dev/null 2>&1 &
FRONTEND_PID=$!
cd ..

# Get IP Address
IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "==========================================="
echo "   Services are running!"
echo "==========================================="
echo "Access the application at:"
echo "   http://$IP_ADDR:5173/"
echo "   (If 5173 is busy, try 5174)"
echo ""
echo "Backend API is at:"
echo "   http://$IP_ADDR:3000/api/status"
echo ""
echo "Press Ctrl+C to stop all services."
echo "==========================================="

# Wait for processes to finish (this keeps the script running)
wait $BACKEND_PID $FRONTEND_PID
