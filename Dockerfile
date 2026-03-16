FROM m.daocloud.io/docker.io/debian:latest

# Set proxy for build


# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    git \
    build-essential \
    python3 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm config set registry https://registry.npmmirror.com \
    && npm install -g npm@latest

# Install global tools needed for the agent
RUN npm install -g agent-browser @anthropic-ai/claude-code

# Create app directory and user
RUN groupadd -r node && useradd -r -g node -G audio,video node \
    && mkdir -p /home/node && chown -R node:node /home/node \
    && mkdir -p /app && chown -R node:node /app

WORKDIR /app

# Copy package files for caching
COPY --chown=node:node package*.json ./
COPY --chown=node:node frontend/package*.json ./frontend/
COPY --chown=node:node container/agent-runner/package*.json ./container/agent-runner/

# Switch to node user
USER node

# Patch package-lock.json to use gitclone.com mirror for git dependencies (fixes connectivity issues)
RUN sed -i 's/git+ssh:\/\/git@github.com/git+https:\/\/gitclone.com\/github.com/g' package-lock.json && \
    sed -i 's/git+https:\/\/github.com/git+https:\/\/gitclone.com\/github.com/g' package-lock.json

# Install dependencies
RUN npm install
RUN cd frontend && npm install
RUN cd container/agent-runner && npm install

# Copy source code
COPY --chown=node:node . .

# Copy custom skills
RUN mkdir -p /home/node/.claude/skills/jumpserver
RUN mkdir -p /home/node/.claude/skills/prometheus
COPY --chown=node:node container/skills/jumpserver /home/node/.claude/skills/jumpserver
COPY --chown=node:node container/skills/prometheus /home/node/.claude/skills/prometheus

# Build Agent Runner
RUN cd container/agent-runner && npm run build

# Build Frontend
RUN cd frontend && npm run build

# Build Backend
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV USE_LOCAL_AGENT=true
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV HOME=/home/node

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
