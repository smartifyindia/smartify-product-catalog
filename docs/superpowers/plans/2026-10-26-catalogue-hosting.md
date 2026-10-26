# Catalogue hosting implementation plan

**Goal:** Publish the approved catalogue page at catalog.smartify.in through a dedicated, reviewed CI/CD pipeline.

**Architecture:** A Cloudflare Worker serves the lightweight page and streams PDFs from a dedicated private R2 bucket. GitHub Actions validates PRs and deploys only main through a protected production environment. Git LFS stores the approved PDF inputs; content-addressed R2 paths prevent stale updates and preserve older shared links.

**Scope:** The user approved creating this missing pipeline. No local/manual deployments, no changes to existing website routing, and no bypass of review gates. The original PDF is retained byte-for-byte; the mobile version is primary. No large file is buffered in Worker memory.

## Implementation

- [x] Add the approved page, LFS PDF inputs, checksum manifest and deterministic build. Validate input hashes before producing a bundle; generate a revision endpoint.
- [x] Test and implement read-only PDF delivery, inline/attachment behavior, HEAD, byte ranges, missing-file handling and cache headers. Preserve previous content-addressed paths.
- [x] Add PR validation and main-only production workflow. Use a protected environment, explicit CI-only deploy guard, idempotent bucket provisioning, PDF uploads before Worker publication, and live revision/checksum verification.
- [ ] Run existing and new tests, local bundle checks and independent review. Push a feature branch and open a PR. Configure the production approval environment without storing credentials in source.
- [ ] Deploy only after review and required credentials exist; report any remaining owner action rather than bypassing the pipeline.

## Review focus

- A PDF file above the Worker memory limit must stream, including during live checksum verification.
- Missing or mismatched PDF inputs must fail before any upload or deployment.
- Invalid/out-of-bounds byte ranges must not produce an incorrectly labelled full response.
- Pull requests and non-main workflow dispatches must never obtain production deployment permissions.
- Upload/deployment failures must fail the job and must never trigger a manual fallback or blind rollback.

## Verification and review

- Existing suite: 38/38 passed. Catalogue suite: 28/28 passed. Input checksums, catalogue consistency, build and Wrangler dry run passed. npm audit: zero vulnerabilities.
- Independent review identified stale workflow runs as a release risk. Fixed with fail-closed current-main checks before upload and publication; regression test passed after demonstrating failure.
- Review minor deferred: live verification checks page/PDF responses but does not independently probe the stylesheet and cover; those remain included in the locally checked static bundle.
- Production environment confirmed: reviewer abhibavishi, branch allowlist main. Cloudflare token still required before first release.
