#!/bin/bash

set -euo pipefail

# Get the directory where the script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "==========================================="
echo "   CNP-Bot Local IP Access Startup Script"
echo "==========================================="

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for Docker mode argument
if [ "$1" == "--docker" ]; then
    echo "Running in Docker mode..."
    
    # Check if docker is installed
    if ! command_exists docker; then
        echo "Error: Docker is not installed."
        exit 1
    fi

    # Check if .env exists
    if [ ! -f .env ]; then
        echo "Error: .env file not found. Please ensure it exists before running in Docker mode."
        exit 1
    fi

    set -a
    . .env
    set +a

    missing_vars=()
    [ -z "$JUMPSERVER_HOST" ] && missing_vars+=("JUMPSERVER_HOST")
    [ -z "$JUMPSERVER_USER" ] && missing_vars+=("JUMPSERVER_USER")
    [ -z "$JUMPSERVER_PASS" ] && missing_vars+=("JUMPSERVER_PASS")

    if [ ${#missing_vars[@]} -ne 0 ]; then
        echo "Error: Missing required env vars in .env: ${missing_vars[*]}"
        exit 1
    fi

    echo "Building Docker image..."
    docker build -t cnp-bot .

    # Stop existing container if running
    if [ "$(docker ps -a -q -f name=cnp-bot)" ]; then
        echo "Stopping existing container..."
        docker rm -f cnp-bot
    fi

    echo "Starting Docker container..."
    
    # Create directories for persistence
    mkdir -p store data groups
    
    # Ensure directories are writable by the container user (node, uid 1000)
    # This avoids permission errors when mounting host directories created by root
    chown -R 1000:1000 store data groups || true
    # The settings page edits /app/.env inside the container, so the host .env
    # must be mounted and writable by the node user as well.
    chown 1000:1000 .env || true
    chmod u+rw .env || true
    
    # Run container with environment variables from .env
    # We use --env-file to pass all variables from .env directly
    # We also mount the same .env file so the admin settings page can read/write it.
    if [ -f .env ]; then
        docker run -d \
          -p 3000:3000 \
          --name cnp-bot \
          -e JUMPSERVER_DEBUG=1 \
          --env-file .env \
          -v "$DIR/.env:/app/.env" \
          cnp-bot
    else
        echo "Warning: .env file not found. Running with default environment."
        docker run -d \
          -p 3000:3000 \
          --name cnp-bot \
          -e JUMPSERVER_DEBUG=1 \
          cnp-bot
    fi

    echo "Container started. Logs:"
    docker logs -f cnp-bot
    exit 0
fi

# 1. Configuration Check & Creation

# Check .env
if [ ! -f .env ]; then
    echo "Creating .env configuration..."
    cat > .env <<EOL
USE_LOCAL_AGENT=true
ASSISTANT_NAME=Assistant
HOST=0.0.0.0
EOL
else
    echo "✓ .env found"
    # Ensure USE_LOCAL_AGENT is present (don't overwrite if exists)
    if ! grep -q "^USE_LOCAL_AGENT=" .env; then
        echo "USE_LOCAL_AGENT=true" >> .env
        echo "  Added USE_LOCAL_AGENT=true to .env"
    fi
    # Ensure HOST is present
    if ! grep -q "^HOST=" .env; then
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
echo "Checking container agent runner..."
cd container/agent-runner
if [ ! -d "node_modules" ]; then
    echo "Installing agent-runner dependencies..."
    npm install
fi
echo "Building agent-runner..."
npm run build
cd ../..

# 3. Start Services

echo ""
echo "Starting services..."

# Check if ports are in use (simple check using lsof if available)
if command_exists lsof; then
    if lsof -i :3000 >/dev/null; then
        echo "Warning: Port 3000 seems to be in use. The backend might fail to start."
    fi
    if lsof -i :5173 >/dev/null; then
        echo "Note: Port 5173 seems to be in use. The frontend will try the next available port."
    fi
fi

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
