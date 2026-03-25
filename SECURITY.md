# Security Policy

## Supported Versions

Security fixes are prioritized for the latest code on `main`.

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Use one of these responsible disclosure channels instead:

1. Open a GitHub Security Advisory / private vulnerability report for this repository.
2. If you need to disclose by email instead, use the maintainer contact address published in the repository metadata or GitHub profile.

Please include:

- a clear description of the issue
- impact and affected routes or modules
- reproduction steps or a minimal proof of concept
- any suggested mitigation, if available

Target response process during launch:

- acknowledgement within 7 days when possible
- follow-up as triage progresses
- coordinated disclosure after a fix is ready

## Security Controls in This Project

### SSRF Protection

Outbound fetches are guarded in `src/security.ts`.

The worker rejects requests to internal or unsafe targets, including:

- localhost and loopback addresses
- private IPv4 ranges
- carrier-grade NAT ranges
- link-local addresses
- cloud metadata endpoints such as `169.254.169.254`
- private or link-local IPv6 ranges
- IPv4-mapped IPv6 addresses
- hex-encoded or integer-encoded IP forms
- internal-only hostnames and common DNS rebinding helper domains

The fetch layer also limits redirects and only allows HTTP(S) targets.

### Rate Limiting

The worker applies per-IP rate limiting in application code, with Cloudflare WAF rate limiting intended as an outer layer.

Implementation details:

- client IP is taken from `cf-connecting-ip` when available, otherwise the first `x-forwarded-for` entry
- limits are tracked by route class such as convert, stream, and batch
- KV-backed counters are used when available
- if distributed KV counting is unavailable, the worker falls back to stricter degraded local limits instead of disabling protection

### Authentication

Protected write APIs use Bearer-token authentication.

Implementation details:

- `Authorization: Bearer <token>` is required for protected endpoints
- token comparison uses a timing-safe HMAC-based comparison in `src/index.ts`
- optional public token protection also exists for raw convert-style API access and `/api/stream`

## Scope Notes

`src/browser/stealth.ts` and `src/proxy.ts` are intentionally included.

They exist to improve retrieval reliability for anti-bot-protected or challenge-prone sites. Reports that these files exist, or that they are used for anti-bot bypass in the documented conversion flow, are not by themselves security vulnerabilities.

Valid reports in this area include issues such as:

- privilege escalation
- token leakage
- SSRF bypass
- header injection
- cache poisoning
- authentication bypass
- cross-tenant data exposure

## Disclosure Expectations

Please give the maintainer reasonable time to investigate and remediate a report before public disclosure.
