@AGENTS.md

# Meridian — decision log (cross-chat memory)

This file is the running record of confirmed decisions. Any future session starts here.

## Product
- Web platform of executive dashboards. One Project = one Excel workbook = one dashboard = one theme = one share link.
- First project: "Agthia" freight quotation pipeline (RFQ tracker, 11 columns, one sheet).
- Audience for the Agthia dashboard: internal management. Insights are worded frankly.

## Decisions taken (2026-09-15)
- Design direction A "Terminal": dense monochrome, hairline rules not cards, one accent (project brand colour). Dark and light both designed.
- Typography (revised 2026-09-15, user found the Plex/mono/uppercase look "AI" and hard to read): Source Sans 3 for everything, tabular numerals via `.num`, sentence-case labels at 12.5–14px, body 14.5px, KPI values 36px bold. IBM Plex packages removed.
- Light mode is first-class: `src/lib/ui/theme.ts` adapts the project brand colour per mode (steps HSL lightness until ≥4.5:1 against the surface) and status/categorical colours have separate light and dark values. Theme choice is remembered per project (`meridian-theme:<projectId>`) and globally, default follows the system preference. Toggle on every page.
- Phone-friendly: below 720px the grid uses a fixed reading-order layout (KPIs two per row, everything else full width, no editing), the top bar collapses into a Menu, filters collapse, and tables below 560px render as stacked cards.
- Review-inbox framing (the user reviews what their transporter uploads): an update banner announces each new version ("New update from X · n new · n changed since vN") until dismissed per browser, "Review changes" switches every table to changed rows only, rows carry NEW/CHANGED badges, and the insight strip is titled "What changed since the last update".
- Delete: two-click confirm everywhere (settings, home card menu, history drawer per version), API accepts `?confirm=yes`. The typed-name gate was removed because it silently blocked deletes.
- Vercel Blob store is private: files are stored with `access: "private"` and streamed back through the app; public-store and Postgres bytea fallbacks remain.
- Stack: Next.js 16 App Router + TypeScript on Vercel, Neon Postgres via Drizzle, Vercel Blob for raw files (Postgres bytea fallback until the Blob store exists), ExcelJS for parsing (SheetJS CDN unreachable from the build sandbox), custom D3-based React SVG charts, react-grid-layout for editable layouts, Tailwind v4 as utility engine only with our own tokens, Claude API for natural-language questions only. Insights and anomalies are deterministic code.
- No admin password (user decision). ADMIN_PASSWORD env var is optional: set it to require a login later.
- Share links: public token per project, optional per-project password.
- Region: Vercel functions in fra1, Neon in aws-eu-central-1 (closest sensible pair to UAE).
- Agthia decisions (2026-09-15, later): the client is spelled "Agthia" (the live project was created as "Aghtia" and corrected in the database: name, slug `/p/agthia`, theme name). No "Median turnaround" KPI: the overview has five KPI tiles (RFQs received 3 cols, Quoted rate 3, Win rate 2, Awaiting client 2, Not yet quoted 2); the Quote turnaround dots chart on the Pipeline page stays. Share links present as "Reports and analytics" (browser title and footer), Meridian branding only on the internal pages.
- Data rules for Agthia: quote dates in 2028 treated as 2026 typos and flagged; Won/Lost column trusted, conflicting remarks flagged; "Air/sea" kept as "Multimodal"; origins and destinations normalised to city and country with an editable mapping; lane type (Import, Export, Domestic, Cross-trade) and business unit derived; count-based metrics now, money metrics light up automatically when a value column appears.

## Conventions
- Never hardcode source column names in visuals; visuals bind to stable field ids in the project's schema map.
- Numbers are never produced by an LLM. Claude only translates questions to widget configs and phrases text.
- Commit at the end of every phase. Small commits.
- The user tests on the live Vercel URL, not locally.

## Architecture notes (Phase 1)
- Ingestion: `src/lib/excel/parse.ts` (ExcelJS/CSV, header detection, dropdown lists) → `src/lib/schema/infer.ts` (types, roles, semantics, value maps, schema diff) → `src/lib/schema/normalize.ts` (snapshot: columnar arrays, derived fields, exclusions, year-typo fixes, folded variants).
- Engine (`src/lib/engine`) is pure and shared by server and client: filters → Uint8Array mask, metrics, groupBy, timeSeries, formatting. Widgets bind to field ids only.
- Snapshot is stored on the upload row and rebuilt from `upload_rows` whenever the project's schema map hash changes, so mapping edits never need a re-upload.
- Curated template for the Agthia sheet lives in `src/lib/templates/agthia.ts` (matched by header fingerprint); other sheets get `src/lib/dashboard/propose.ts`.
- Cross-filtering: `src/lib/ui/dashboard-state.tsx`. Each widget computes its mask from every selection except its own, so the source widget highlights instead of filtering itself. The same state carries `changesOnly` (review mode) so the banner and every table stay in sync.
- Change markers: `src/lib/data/intelligence.ts` `rowDiff()` compares id rows with the previous version on non-derived dimension/date/measure/text fields → `newIds`/`changedIds`, cached with the insights. `UpdateBanner.tsx` reads them; `TableTile.tsx` renders badges, the "n changed since vN" chip and the phone card layout.
- Local design checks: `MERIDIAN_FIXTURE_DIR=fixtures npx next start` renders projects from `fixtures/*.json` (generated by `scripts/make-fixture.ts`, git-ignored because it contains client data). The fixture carries a synthesised previous version (`previousSnapshot`/`previousUpload`) so insights, markers and the banner render locally. Screenshots via `scripts/shot.mjs` (`SHOTS` JSON: path, w, h, theme, click, full).
- The sandbox cannot reach Neon or vercel.app directly; migrations run through the Neon MCP, live checks through the Vercel MCP.

## Phases
0. Pipeline live (status page, health endpoint) — done
1. Core: DB schema, ingestion, schema inference, engine, charts, grid, tokens — done
2. Upload and history — done (drop anywhere on the dashboard, schema-change modal with rename/new/ignore decisions, confirmed-missing columns stop prompting, new money columns auto-add value tiles, history drawer with restore and file download)
3. Intelligence — done (deterministic insight engine compares each version with the previous: KPI deltas with driven-by attribution, new/removed rows, stage and outcome transitions, dimension shifts, aging; robust z-score anomalies on KPI history, row measures and weekly counts; semantic logic checks; Ask panel translates questions into widget specs with Claude Opus 5 via structured outputs, server-side refusal fallback to Opus 4.8, numbers computed locally)
4. Projects home, themes, sharing, layout editing, new-project wizard — done (live mini-dashboards on the home page; settings page for identity, colour, default theme, logo, monogram, field labels/roles/hidden, delete; share links with optional scrypt-hashed password and signed per-project cookie; layout edit mode with drag/resize/hide/restore/save/reset and pin-from-Ask; wizard previews fields and proposed pages before creating)
5. Polish — done (boardroom mode with auto-cycling pages and keyboard control; server-side Chromium export to PNG (2×) and PDF (one sheet per page) via /api/projects/[id]/export, client-side PNG fallback; KPI deltas vs previous version; terminal-style selects; hover-revealed expand and table views on every chart; entrance and page transitions; loading skeleton)

## Next (approved by the user 2026-09-15, not started; confirm scope before building each)
- Meridian is a general product: anyone uploads their own kind of sheet. The Agthia template is just one auto-matched template.
- Order: (1) sign-in and workspaces so each person sees only their projects, share links stay public; (2) column meaning (semantic) editable in settings with dashboard rebuild; (3) sheet picker for multi-sheet workbooks; (4) more auto-matched templates: sales pipeline, project plan, expenses, inventory, attendance; (5) public landing page with a demo.
- The name stays Meridian.

## Gotchas
- Hooks must sit above any early `return null` (the History drawer once declared `useState` after `if (!open) return null` and crashed with React #310 on open).
- Never put a CSS animation that ends on `transform` directly on a react-grid-layout item: the animation outranks the inline transform RGL uses for positioning. Animate an inner wrapper.
- Export needs `serverExternalPackages` for `@sparticuz/chromium` and `puppeteer-core`, plus `outputFileTracingIncludes` for the chromium binaries. Locally set `CHROME_PATH` to a Chromium binary and `NEXT_PUBLIC_APP_URL` to the local origin.
- The share page accepts `?print=1&page=<id>&theme=dark|light` (no chrome, no animations) and `?board=1` (boardroom).
