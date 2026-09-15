@AGENTS.md

# Meridian — decision log (cross-chat memory)

This file is the running record of confirmed decisions. Any future session starts here.

## Product
- Web platform of executive dashboards. One Project = one Excel workbook = one dashboard = one theme = one share link.
- First project: "Agthia" freight quotation pipeline (RFQ tracker, 11 columns, one sheet).
- Audience for the Agthia dashboard: internal management. Insights are worded frankly.

## Decisions taken (2026-09-15)
- Design direction A "Terminal": dense monochrome, hairline rules not cards, one accent (project brand colour), IBM Plex Sans for UI, IBM Plex Mono for all numerals, uppercase micro-labels. Dark and light both designed.
- Stack: Next.js 16 App Router + TypeScript on Vercel, Neon Postgres via Drizzle, Vercel Blob for raw files (Postgres bytea fallback until the Blob store exists), ExcelJS for parsing (SheetJS CDN unreachable from the build sandbox), custom D3-based React SVG charts, react-grid-layout for editable layouts, Tailwind v4 as utility engine only with our own tokens, Claude API for natural-language questions only. Insights and anomalies are deterministic code.
- No admin password (user decision). ADMIN_PASSWORD env var is optional: set it to require a login later.
- Share links: public token per project, optional per-project password.
- Region: Vercel functions in fra1, Neon in aws-eu-central-1 (closest sensible pair to UAE).
- Data rules for Agthia: quote dates in 2028 treated as 2026 typos and flagged; Won/Lost column trusted, conflicting remarks flagged; "Air/sea" kept as "Multimodal"; origins and destinations normalised to city and country with an editable mapping; lane type (Import, Export, Domestic, Cross-trade) and business unit derived; count-based metrics now, money metrics light up automatically when a value column appears.

## Conventions
- Never hardcode source column names in visuals; visuals bind to stable field ids in the project's schema map.
- Numbers are never produced by an LLM. Claude only translates questions to widget configs and phrases text.
- Commit at the end of every phase. Small commits.
- The user tests on the live Vercel URL, not locally.

## Phases
0. Pipeline live (status page, health endpoint)
1. Core: DB schema, ingestion, schema inference, engine, charts, grid, tokens
2. Upload and history
3. Intelligence: insights, anomalies, data quality, NL questions
4. Projects home, themes, sharing, layout editing, new-project wizard
5. Polish: boardroom mode, export, transitions, skeletons
