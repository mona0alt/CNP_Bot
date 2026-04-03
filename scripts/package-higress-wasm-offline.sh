#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  package-higress-wasm-offline.sh [--host HOST] [--port PORT] [--output DIR]

说明:
  从本机 Higress gateway 的 Wasm 缓存中收集以下插件并打包成离线部署包:
  - model-mapper
  - ai-proxy
  - ai-statistics

参数:
  --host HOST    目标机上供 Higress gateway 访问 Wasm 的地址，默认 10.245.16.32
  --port PORT    目标机上本地 HTTP 服务端口，默认 18080
  --output DIR   输出目录，默认 <repo>/dist
  -h, --help     显示帮助

环境变量:
  HIGRESS_WASM_CACHE_BASE  覆盖本机 Wasm 缓存目录
  HIGRESS_WASMPLUGIN_DIR   覆盖 WasmPlugin YAML 源目录
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET_HOST="10.245.16.32"
TARGET_PORT="18080"
OUTPUT_DIR="${REPO_ROOT}/dist"
CACHE_BASE="${HIGRESS_WASM_CACHE_BASE:-/root/project/higress/higress/compose/volumes/gateway/istio/data}"
PLUGIN_YAML_DIR="${HIGRESS_WASMPLUGIN_DIR:-/root/project/higress/wasmplugins}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      TARGET_HOST="$2"
      shift 2
      ;;
    --port)
      TARGET_PORT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "缺少文件: $path" >&2
    exit 1
  fi
}

require_dir() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    echo "缺少目录: $path" >&2
    exit 1
  fi
}

classify_wasm() {
  local wasm_file="$1"
  if strings "$wasm_file" | grep -q "extensions/model-mapper"; then
    printf '%s\n' "model-mapper"
    return 0
  fi
  if strings "$wasm_file" | grep -q "extensions/ai-proxy"; then
    printf '%s\n' "ai-proxy"
    return 0
  fi
  if strings "$wasm_file" | grep -q "ai-statistics"; then
    printf '%s\n' "ai-statistics"
    return 0
  fi
  return 1
}

find_wasm_for_plugin() {
  local plugin_name="$1"
  local wasm_file
  while IFS= read -r wasm_file; do
    if [[ "$(classify_wasm "$wasm_file" || true)" == "$plugin_name" ]]; then
      printf '%s\n' "$wasm_file"
      return 0
    fi
  done < <(find "$CACHE_BASE" -maxdepth 2 -type f -name '*.wasm' | sort)
  return 1
}

rewrite_wasmplugin_url() {
  local source_yaml="$1"
  local target_yaml="$2"
  local wasm_name="$3"
  sed -E "s#url: .*#url: http://${TARGET_HOST}:${TARGET_PORT}/${wasm_name}.wasm#g" \
    "$source_yaml" > "$target_yaml"
}

require_dir "$CACHE_BASE"
require_dir "$PLUGIN_YAML_DIR"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

PACKAGE_NAME="higress-wasm-offline-$(date +%Y%m%d-%H%M%S)"
PACKAGE_ROOT="${TMP_ROOT}/${PACKAGE_NAME}"
WASM_DIR="${PACKAGE_ROOT}/wasm"
YAML_DIR="${PACKAGE_ROOT}/wasmplugins"
mkdir -p "$WASM_DIR" "$YAML_DIR"

MODEL_MAPPER_WASM="$(find_wasm_for_plugin model-mapper || true)"
AI_PROXY_WASM="$(find_wasm_for_plugin ai-proxy || true)"
AI_STATISTICS_WASM="$(find_wasm_for_plugin ai-statistics || true)"

if [[ -z "$MODEL_MAPPER_WASM" || -z "$AI_PROXY_WASM" || -z "$AI_STATISTICS_WASM" ]]; then
  echo "无法从缓存目录识别全部 3 个 Wasm 插件。" >&2
  echo "CACHE_BASE=${CACHE_BASE}" >&2
  echo "model-mapper=${MODEL_MAPPER_WASM:-<missing>}" >&2
  echo "ai-proxy=${AI_PROXY_WASM:-<missing>}" >&2
  echo "ai-statistics=${AI_STATISTICS_WASM:-<missing>}" >&2
  exit 1
fi

cp "$MODEL_MAPPER_WASM" "${WASM_DIR}/model-mapper.wasm"
cp "$AI_PROXY_WASM" "${WASM_DIR}/ai-proxy.wasm"
cp "$AI_STATISTICS_WASM" "${WASM_DIR}/ai-statistics.wasm"

MODEL_MAPPER_YAML="${PLUGIN_YAML_DIR}/model-mapper.internal.yaml"
AI_PROXY_YAML="${PLUGIN_YAML_DIR}/ai-proxy.internal.yaml"
AI_STATISTICS_YAML="${PLUGIN_YAML_DIR}/ai-statistics-1.0.0.yaml"
require_file "$MODEL_MAPPER_YAML"
require_file "$AI_PROXY_YAML"
require_file "$AI_STATISTICS_YAML"

rewrite_wasmplugin_url "$MODEL_MAPPER_YAML" "${YAML_DIR}/model-mapper.internal.yaml" "model-mapper"
rewrite_wasmplugin_url "$AI_PROXY_YAML" "${YAML_DIR}/ai-proxy.internal.yaml" "ai-proxy"
rewrite_wasmplugin_url "$AI_STATISTICS_YAML" "${YAML_DIR}/ai-statistics-1.0.0.yaml" "ai-statistics"

cat > "${PACKAGE_ROOT}/serve-wasm.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "\${SCRIPT_DIR}/wasm"
echo "Serving Wasm files at http://0.0.0.0:${TARGET_PORT}"
python3 -m http.server "${TARGET_PORT}" --bind 0.0.0.0
EOF
chmod +x "${PACKAGE_ROOT}/serve-wasm.sh"

cat > "${PACKAGE_ROOT}/README.md" <<EOF
# Higress Wasm 离线部署包

这个离线包包含以下插件:

- model-mapper
- ai-proxy
- ai-statistics

## 1. 在目标机解压

\`\`\`bash
tar -xzf ${PACKAGE_NAME}.tar.gz
cd ${PACKAGE_NAME}
\`\`\`

## 2. 启动本地 Wasm 文件服务

\`\`\`bash
./serve-wasm.sh
\`\`\`

默认监听:

- http://${TARGET_HOST}:${TARGET_PORT}

如果 Higress gateway 容器不能访问该地址，请把 \`wasmplugins/*.yaml\` 里的地址改成目标机上对 gateway 可达的地址。

## 3. 应用 WasmPlugin 配置

\`\`\`bash
kubectl apply -f wasmplugins/model-mapper.internal.yaml
kubectl apply -f wasmplugins/ai-proxy.internal.yaml
kubectl apply -f wasmplugins/ai-statistics-1.0.0.yaml
\`\`\`

如果是 docker compose 本地部署而不是 k8s，请将对应配置文件中的 \`url\` 替换到你实际使用的 WasmPlugin 资源里。

## 4. 验证

- 确认 \`curl http://${TARGET_HOST}:${TARGET_PORT}/model-mapper.wasm\` 可访问
- 查看 gateway 日志，不应再出现公网 OCI 拉取失败
- 再测 \`/v1/messages\` 是否恢复 \`thinking\`

## 包内文件

- \`wasm/model-mapper.wasm\`
- \`wasm/ai-proxy.wasm\`
- \`wasm/ai-statistics.wasm\`
- \`wasmplugins/*.yaml\`
- \`serve-wasm.sh\`
EOF

cat > "${PACKAGE_ROOT}/checksums.txt" <<EOF
$(sha256sum "${WASM_DIR}/model-mapper.wasm")
$(sha256sum "${WASM_DIR}/ai-proxy.wasm")
$(sha256sum "${WASM_DIR}/ai-statistics.wasm")
EOF

mkdir -p "$OUTPUT_DIR"
TARBALL_PATH="${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz"
tar -C "$TMP_ROOT" -czf "$TARBALL_PATH" "$PACKAGE_NAME"

cat <<EOF
离线包已生成:
${TARBALL_PATH}

使用的缓存目录:
${CACHE_BASE}

识别到的源文件:
model-mapper: ${MODEL_MAPPER_WASM}
ai-proxy: ${AI_PROXY_WASM}
ai-statistics: ${AI_STATISTICS_WASM}
EOF
