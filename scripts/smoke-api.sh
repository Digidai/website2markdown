#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
API_TOKEN="${API_TOKEN:-}"
TARGET_URL="${TARGET_URL:-https://example.com/}"

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

echo "[1/5] /api/health"
health_json="$(curl -fsS "${BASE_URL}/api/health")"
printf '%s' "$health_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (payload.status !== "ok") process.exit(1);
  if (!payload.metrics || !payload.metrics.operational) process.exit(1);
});
'

echo "[2/5] /api/extract"
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

echo "[3/5] /api/jobs + /api/jobs/:id"
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
  if (!payload.job || !payload.job.id) process.exit(1);
});
'

echo "[4/5] /api/jobs/:id/run"
job_run_json="$(request_json "POST" "${BASE_URL}/api/jobs/${job_id}/run")"
printf '%s' "$job_run_json" | node -e '
let data = "";
process.stdin.on("data", (c) => data += c);
process.stdin.on("end", () => {
  const payload = JSON.parse(data);
  if (!payload.status) process.exit(1);
});
'

echo "[5/5] /api/deepcrawl"
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
});
'

echo "Smoke checks passed for ${BASE_URL}"
