#!/usr/bin/env bash
set -euo pipefail

URL="${URL:-http://192.168.231.128:30080}"
ENDPOINT="${ENDPOINT:-/v1/messages}"
MODEL="${MODEL:-${ANTHROPIC_MODEL:-/model/MiniMax-M2___5}}"
API_KEY="${API_KEY:-${ANTHROPIC_API_KEY:-sk-ant-dummy}}"
CONCURRENCY="${CONCURRENCY:-3}"
ROUNDS="${ROUNDS:-1}"
MAX_RETRIES="${MAX_RETRIES:-11}"
MAX_TOKENS="${MAX_TOKENS:-64}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-10}"
MAX_TIME="${MAX_TIME:-90}"
PROMPT="${PROMPT:-Reply with OK only.}"
KEEP_TMP="${KEEP_TMP:-1}"

usage() {
  cat <<'EOF'
用法:
  bash scripts/repro-503-curl.sh [选项]

选项:
  --url <url>               上游地址，默认 http://192.168.231.128:30080
  --endpoint <path>         默认 /v1/messages
  --model <model>           默认取 ANTHROPIC_MODEL
  --api-key <key>           默认取 ANTHROPIC_API_KEY，没有则用 sk-ant-dummy
  --concurrency <n>         并发数，默认 3
  --rounds <n>              每个 worker 的轮数，默认 1
  --retries <n>             每轮最多重试次数，默认 11
  --max-tokens <n>          默认 64
  --connect-timeout <sec>   默认 10
  --max-time <sec>          默认 90
  --prompt <text>           默认 "Reply with OK only."
  --keep-tmp <0|1>          默认 1，保留明细文件

示例:
  bash scripts/repro-503-curl.sh --concurrency 3 --rounds 2 --retries 11
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    --retries) MAX_RETRIES="$2"; shift 2 ;;
    --max-tokens) MAX_TOKENS="$2"; shift 2 ;;
    --connect-timeout) CONNECT_TIMEOUT="$2"; shift 2 ;;
    --max-time) MAX_TIME="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --keep-tmp) KEEP_TMP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "缺少 curl" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/cnp-curl-503.XXXXXX)"
SUMMARY_FILE="$TMP_DIR/summary.tsv"
if [[ "$KEEP_TMP" != "1" ]]; then
  trap 'rm -rf "$TMP_DIR"' EXIT
fi

join_url() {
  local base="$1"
  local path="$2"
  if [[ "$base" == */ && "$path" == /* ]]; then
    printf '%s%s' "${base%/}" "$path"
  elif [[ "$base" != */ && "$path" != /* ]]; then
    printf '%s/%s' "$base" "$path"
  else
    printf '%s%s' "$base" "$path"
  fi
}

BACKOFFS=(1 2 4 8 15 30 30 30 30 30)

request_once() {
  local worker="$1"
  local round="$2"
  local attempt="$3"
  local prefix="$TMP_DIR/w${worker}-r${round}-a${attempt}"
  local payload_file="${prefix}.json"
  local headers_file="${prefix}.headers"
  local body_file="${prefix}.body"
  local meta_file="${prefix}.meta"
  local now
  now="$(date -Iseconds)"

  cat >"$payload_file" <<EOF
{"model":"$MODEL","max_tokens":$MAX_TOKENS,"messages":[{"role":"user","content":"$PROMPT"}]}
EOF

  curl -sS \
    -o "$body_file" \
    -D "$headers_file" \
    -w 'http_code=%{http_code} time_total=%{time_total} remote_ip=%{remote_ip}\n' \
    -X POST "$(join_url "$URL" "$ENDPOINT")" \
    -H 'content-type: application/json' \
    -H "x-api-key: $API_KEY" \
    -H 'anthropic-version: 2023-06-01' \
    --connect-timeout "$CONNECT_TIMEOUT" \
    --max-time "$MAX_TIME" \
    --data @"$payload_file" \
    >"$meta_file" 2>&1 || true

  local meta http_code time_total upstream_ms req_cost resp_start body_snippet
  meta="$(cat "$meta_file")"
  http_code="$(sed -n 's/.*http_code=\([0-9][0-9][0-9]\).*/\1/p' "$meta_file" | tail -n1)"
  time_total="$(sed -n 's/.*time_total=\([0-9.][0-9.]*\).*/\1/p' "$meta_file" | tail -n1)"
  upstream_ms="$(awk -F': ' 'BEGIN{IGNORECASE=1} /^x-envoy-upstream-service-time:/{gsub("\r","",$2); print $2}' "$headers_file" | tail -n1)"
  req_cost="$(awk -F': ' 'BEGIN{IGNORECASE=1} /^req-cost-time:/{gsub("\r","",$2); print $2}' "$headers_file" | tail -n1)"
  resp_start="$(awk -F': ' 'BEGIN{IGNORECASE=1} /^resp-start-time:/{gsub("\r","",$2); print $2}' "$headers_file" | tail -n1)"
  body_snippet="$(tr '\n' ' ' <"$body_file" | cut -c1-180)"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$now" "$worker" "$round" "$attempt" "${http_code:-000}" "${time_total:-0}" \
    "${upstream_ms:--}" "${req_cost:--}" "${resp_start:--}" "$body_snippet" \
    >>"$SUMMARY_FILE"

  printf '[%s] worker=%s round=%s attempt=%s code=%s total=%ss upstream_ms=%s req_cost=%s\n' \
    "$now" "$worker" "$round" "$attempt" "${http_code:-000}" "${time_total:-0}" \
    "${upstream_ms:--}" "${req_cost:--}"

  [[ "${http_code:-000}" == "503" ]]
}

run_worker() {
  local worker="$1"
  local round attempt sleep_s
  for ((round=1; round<=ROUNDS; round++)); do
    for ((attempt=1; attempt<=MAX_RETRIES; attempt++)); do
      if request_once "$worker" "$round" "$attempt"; then
        if (( attempt < MAX_RETRIES )); then
          sleep_s="${BACKOFFS[$((attempt-1))]:-30}"
          echo "worker=$worker round=$round attempt=$attempt 命中503，sleep ${sleep_s}s 后重试"
          sleep "$sleep_s"
          continue
        fi
      fi
      break
    done
  done
}

echo "URL=$URL"
echo "ENDPOINT=$ENDPOINT"
echo "MODEL=$MODEL"
echo "CONCURRENCY=$CONCURRENCY ROUNDS=$ROUNDS MAX_RETRIES=$MAX_RETRIES"
echo "临时目录: $TMP_DIR"
echo

for ((worker=1; worker<=CONCURRENCY; worker++)); do
  run_worker "$worker" &
done
wait

echo
echo "=== 汇总 ==="
echo "明细文件: $SUMMARY_FILE"

total="$(wc -l <"$SUMMARY_FILE" | tr -d ' ')"
code_200="$(awk -F'\t' '$5=="200"{c++} END{print c+0}' "$SUMMARY_FILE")"
code_503="$(awk -F'\t' '$5=="503"{c++} END{print c+0}' "$SUMMARY_FILE")"
other_codes="$(awk -F'\t' '$5!="200" && $5!="503"{c++} END{print c+0}' "$SUMMARY_FILE")"
avg_total="$(awk -F'\t' '{sum+=$6; c++} END{if(c>0) printf "%.3f", sum/c; else print "0"}' "$SUMMARY_FILE")"
max_total="$(awk -F'\t' 'BEGIN{m=0} {if($6>m)m=$6} END{printf "%.3f", m}' "$SUMMARY_FILE")"
first_503="$(awk -F'\t' '$5=="503"{print $1; exit}' "$SUMMARY_FILE")"
last_503="$(awk -F'\t' '$5=="503"{v=$1} END{print v}' "$SUMMARY_FILE")"

echo "总请求数: $total"
echo "200 数量: $code_200"
echo "503 数量: $code_503"
echo "其他状态码数量: $other_codes"
echo "平均耗时(s): $avg_total"
echo "最大耗时(s): $max_total"
echo "首次503时间: ${first_503:-无}"
echo "末次503时间: ${last_503:-无}"

echo
echo "=== 状态码分布 ==="
awk -F'\t' '{count[$5]++} END{for (k in count) print k, count[k]}' "$SUMMARY_FILE" | sort

echo
echo "=== 最近10条 ==="
tail -n 10 "$SUMMARY_FILE" | awk -F'\t' '{printf "%s worker=%s round=%s attempt=%s code=%s total=%ss upstream_ms=%s req_cost=%s body=%s\n",$1,$2,$3,$4,$5,$6,$7,$8,$10}'
