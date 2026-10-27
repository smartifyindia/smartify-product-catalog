# Public PDF catalogue

Permanent URL: https://catalog.smartify.in/ (only live after the first successful approved pipeline run).

**Share the page link, not the PDF.** `https://catalog.smartify.in/` never changes and always opens the latest catalogue. PDF URLs include a content hash and change with every edition, so a PDF sent over WhatsApp can never be updated. The page's Share button shares only the page link. `/#page=12` opens a specific page.

The catalogue is a 60-slide, 16:9 landscape deck, so the page is a fixed full-screen viewer (no page scroll, so it never competes with the viewer's own gestures) that shows one page at a time at the largest size that fits. Swipe or use the arrows to turn pages; pinch, double-tap or +/- to zoom (pages re-render sharply at the new zoom); the page counter opens an overview grid of all pages. Keyboard: arrows, Space, Home/End, +/-/0. On phones, turning the phone sideways gives a larger page. The self-hosted PDF.js reader fetches PDF byte ranges on demand and keeps only the current page and its neighbours in memory, with canvases capped at 8 million pixels. The default download is the approved 13.3 MB mobile PDF; the 146.9 MB original is a separate option preserved byte-for-byte. The official Smartify logo comes from the marketing website. There are no third-party script, font, or analytics requests. The page text layer is not rendered, so PDF text is not selectable in the viewer (the downloaded PDF keeps it). If the viewer cannot start, open and download links remain available. `og-catalogue.jpg` is a JPEG because WhatsApp link previews are unreliable with WebP.

`pdfjs-dist` is pinned in the lockfile. The build copies only the runtime, worker, fonts, text-layer CSS, character maps and image decoders into `dist/vendor/pdfjs/`, including its license. CSP permits same-origin scripts/workers and WebAssembly image decoders; arbitrary script evaluation and remote scripts remain blocked.

## Architecture

- Dedicated Worker: `smartify-catalogue`, with only `catalog.smartify.in` as its custom domain.
- Private R2 bucket: `smartify-catalogue-pdfs`; the Worker exposes only the expected PDF filename patterns under content-addressed paths.
- PDF responses stream from R2, support HEAD, byte ranges/resume, ETags, inline viewing and explicit attachment downloads. They are not buffered into Worker memory.
- Git LFS holds the source PDFs. `manifest.json` pins their SHA-256 digests and byte sizes. Missing LFS downloads or changed files fail the build.
- `public/` is the page source; `dist/` is generated. PDFs are never bundled as Worker static assets.
- A changed PDF gets a new digest URL. Previously published objects are not deleted, so older shared PDF links remain usable. The landing page and `/release.json` revalidate on every visit.

## Release pipeline and approval

`.github/workflows/catalogue-site.yml` validates PRs without production secrets. A matching push to `main`, or an explicit dispatch from `main`, runs validation and then waits for the `catalogue-production` environment approval. GitHub environment settings require approval by `abhibavishi` and allow only the `main` branch. This is an external gate, not a convention in the script. Do not weaken it to make a release run.

The production job:

1. Checks the clean source revision against the workflow SHA and the current remote `main` SHA, rejecting stale approved runs.
2. Verifies both input PDF checksums, provisions the dedicated bucket if absent, uploads immutable digest paths and downloads them again to verify their bytes.
3. Checks `main` again and deploys the Worker and its dedicated custom domain using the committed Wrangler configuration.
4. Waits for DNS/TLS and the exact `/release.json` revision; checks the page, both PDF content types/sizes, attachment behavior, byte ranges and complete streamed SHA-256 hashes.

Failed provisioning, uploads or checks fail the job. There is no manual deployment fallback, automatic rollback, or modification of the existing marketing website's deployment configuration.

## First release: owner setup

1. Add `CLOUDFLARE_API_TOKEN` as a secret in the repository's **catalogue-production environment**, not in source or chat. Use Cloudflare's **Edit Cloudflare Workers** token template scoped to account `b9f8db8151b55e4e33b0190fd0805f38` and the `smartify.in` zone, plus **Workers R2 Storage: Edit** for bucket creation and PDF operations. The account must have R2 enabled. The template includes the Workers/route and account/zone read permissions; ensure it supports custom-domain publication.
2. Review and merge the PR after validation succeeds. The environment gate then asks for release approval. The agent must not approve its own deployment on the owner's behalf.
3. Approve the job after inspecting its source revision. If `main` advances while approval is pending, dispatch a fresh workflow at the latest `main` instead of redeploying the stale run.
4. Confirm the final verification step succeeds before announcing the URL as live.

Git LFS stores around 160 MB for this first edition. LFS storage and CI downloads use the GitHub account's LFS quota; future changed PDFs add storage. Keep the lockfile committed. The Undici override pins the patched version used by the current Wrangler/Miniflare development dependencies.

## Local validation (no deployment)

```sh
git lfs pull
npm ci
npm test
npm run verify-catalog
npm run check-catalog
npm run catalogue:test
npm run catalogue:build
npm run catalogue:bundle  # dry run only; no upload
```

The deployment script refuses ordinary local execution. Running it with spoofed CI variables is prohibited by the workspace deployment policy.

## Updating the catalogue

Replace `files/SmartifyB2C-mobile.pdf` and `files/SmartifyB2C-full-quality.pdf`. Review the mobile PDF visually against the original. Update version, page count, SHA-256 values and byte sizes in `manifest.json`; preserve the filename/source fields. Replace the cover image if needed. Commit the PDFs through Git LFS, run the validation above, and submit a PR. The builder generates both URLs, displayed sizes and the added date from the manifest. The same permanent landing-page link continues to work.

No credentials are required to build or test locally. No local command should publish files, mutate DNS, or deploy the Worker.
