#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
API_TOKEN="${API_TOKEN:-}"
TARGET_URL="${TARGET_URL:-https://example.com/}"
EXPECT_AUTH_DB="${EXPECT_AUTH_DB:-true}"

if [[ -z "$API_TOKEN" ]]; then
  echo "API_TOKEN is required. Example: BASE_URL=https://your-worker API_TOKEN=token npm run smoke:api"
  exit 1
fi

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local tmp_file
  tmp_file="$(mktemp)"
  local status

  if [[ -n "$body" ]]; then
    status="$(curl -sS -o "$tmp_file" -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer ${API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body")"
  else
    status="$(curl -sS -o "$tmp_file" -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer ${API_TOKEN}" \
      -H "Content-Type: application/json")"
  fi

  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    echo "Request failed: ${method} ${url} (HTTP ${status})"
    cat "$tmp_file"
    rm -f "$tmp_file"
    exit 1
  fi

  cat "$tmp_file"
  rm -f "$tmp_file"
}

encoded_target_url() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

echo "[1/7] /api/health"
health_json="$(curl -fsS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${BASE_URL}/api/health?full=1")"
printf '%s' "$health_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (payload.status !== "ok") process.exit(1);
  if (!payload.metrics || !payload.metrics.operational) process.exit(1);
});
'

echo "[2/7] /api/extract"
extract_json="$(request_json "POST" "${BASE_URL}/api/extract" '{
  "strategy": "css",
  "html": "<article><h1>Smoke</h1><p>ok</p></article>",
  "schema": {
    "fields": [
      { "name": "title", "selector": "h1", "type": "text" }
    ]
  }
}')"
printf '%s' "$extract_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (payload.success !== true) process.exit(1);
  if (!payload.data || payload.data.title !== "Smoke") process.exit(1);
});
'

echo "[3/7] /api/jobs + /api/jobs/:id"
job_json="$(request_json "POST" "${BASE_URL}/api/jobs" "{
  \"type\": \"crawl\",
  \"tasks\": [\"${TARGET_URL}\"],
  \"priority\": 1,
  \"maxRetries\": 1
}")"

job_id="$(
  printf '%s' "$job_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (!payload.jobId) process.exit(1);
  process.stdout.write(payload.jobId);
});
'
)"

job_status_json="$(request_json "GET" "${BASE_URL}/api/jobs/${job_id}")"
printf '%s' "$job_status_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (!payload.jobId || payload.jobId !== "'"${job_id}"'") process.exit(1);
});
'

echo "[4/7] /api/jobs/:id/run"
job_run_json="$(request_json "POST" "${BASE_URL}/api/jobs/${job_id}/run")"
printf '%s' "$job_run_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (payload.status !== "succeeded") process.exit(1);
  if (payload.executedTasks !== 1) process.exit(1);
  if (payload.failedTasksInRun !== 0) process.exit(1);
});
'

echo "[5/7] /api/deepcrawl"
deepcrawl_json="$(request_json "POST" "${BASE_URL}/api/deepcrawl" "{
  \"seed\": \"${TARGET_URL}\",
  \"max_depth\": 0,
  \"max_pages\": 1,
  \"strategy\": \"bfs\"
}")"
printf '%s' "$deepcrawl_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (!payload.crawlId || !payload.stats) process.exit(1);
  if (!Array.isArray(payload.results) || payload.results.length < 1) process.exit(1);
  if ((payload.stats.succeededPages || 0) < 1) process.exit(1);
});
'

encoded_target="$(encoded_target_url "$TARGET_URL")"

echo "[6/7] public debug_trace headers"
debug_headers="$(mktemp)"
debug_body="$(mktemp)"
debug_status="$(curl -sS -D "$debug_headers" -o "$debug_body" -w "%{http_code}" \
  -H "Accept: text/markdown" \
  "${BASE_URL}/${encoded_target}?raw=true&debug_trace=true")"
if [[ "$debug_status" -lt 200 || "$debug_status" -ge 300 ]]; then
  echo "debug_trace conversion failed (HTTP ${debug_status})"
  cat "$debug_body"
  rm -f "$debug_headers" "$debug_body"
  exit 1
fi
if [[ "$EXPECT_AUTH_DB" == "true" ]]; then
  expected_debug_pattern='^x-debug-trace: not-authorized'
  expected_debug_message="not-authorized"
else
  expected_debug_pattern='^x-debug-trace: (not-authorized|not-available)'
  expected_debug_message="not-authorized or not-available"
fi
if ! grep -Eiq "$expected_debug_pattern" "$debug_headers"; then
  echo "Expected X-Debug-Trace to be ${expected_debug_message}"
  cat "$debug_headers"
  rm -f "$debug_headers" "$debug_body"
  exit 1
fi
if ! grep -Eiq '^access-control-expose-headers: .*X-Debug-Trace' "$debug_headers"; then
  echo "Expected Access-Control-Expose-Headers to expose X-Debug-Trace"
  cat "$debug_headers"
  rm -f "$debug_headers" "$debug_body"
  exit 1
fi
rm -f "$debug_headers" "$debug_body"

echo "[7/7] /api/stream rejects restricted anonymous engine"
stream_body="$(mktemp)"
stream_status="$(curl -sS -o "$stream_body" -w "%{http_code}" \
  "${BASE_URL}/api/stream?url=${encoded_target}&engine=sk_live_smoke_secret")"
if [[ "$stream_status" != "401" ]]; then
  echo "Expected /api/stream restricted engine to return 401, got HTTP ${stream_status}"
  cat "$stream_body"
  rm -f "$stream_body"
  exit 1
fi
if ! grep -q "engine selection requires" "$stream_body"; then
  echo "Expected restricted engine policy message"
  cat "$stream_body"
  rm -f "$stream_body"
  exit 1
fi
rm -f "$stream_body"

echo "Smoke checks passed for ${BASE_URL}"
