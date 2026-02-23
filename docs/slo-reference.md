# SLO Reference (V1)

This document defines baseline operational targets for md-genedai health metrics.

## Core SLO Targets

- Conversion success rate: >= 95%
- Conversion latency p95: <= 12,000 ms
- Job retry rate: <= 0.15 retries per executed task
- Browser queue backlog: <= 2x browser concurrency

## Field Mapping

Read from `GET /api/health`:

- `metrics.operational.success_rate.conversions`
- `metrics.operational.latency_ms.convert.p95`
- `metrics.operational.retry_rate.retries_per_executed_task`
- `metrics.operational.backlog.browser_queue`
- `browser.maxConcurrent`

## Suggested Alert Rules

- Critical: conversion success rate < 0.90 for 5 minutes
- Warning: conversion p95 > 15,000 ms for 10 minutes
- Warning: retry rate > 0.25 for 10 minutes
- Critical: browser queue > 3x `browser.maxConcurrent` for 3 minutes

## Notes

- This is a practical starting point; tune thresholds after production baseline collection.
- Retry spikes should be correlated with challenge pages and proxy fallback metrics.
