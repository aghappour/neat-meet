# Mike — private deployment fork

Private fork of [MikeOSS](https://github.com/Open-Legal-Products/mike) (AGPL-3.0-only),
running fully self-hosted via `docker-compose.yml` (Postgres + GoTrue + PostgREST +
nginx gateway + RustFS + Mailpit + backend + frontend). No external accounts; documents
stay on this machine. Remote `upstream` = Open-Legal-Products/mike, `origin` = our fork.

## Run / verify
- Boot: `docker compose up --build` → app at http://localhost:3000, API :3001,
  Supabase gateway :54321, Postgres :54322, RustFS console :9001, Mailpit :8025.
- Backend: `npm run build --prefix backend && npm test --prefix backend` (vitest).
- Frontend: `npm run build --prefix frontend && npm run lint --prefix frontend`.
  Production build fails without the three `NEXT_PUBLIC_*` vars (baked at build time).
- E2E: `npm run test:e2e:local` (brings up the stack). Stack tests are env-gated.
- Secrets live in `backend/.env` (gitignored): DOWNLOAD_SIGNING_SECRET (required),
  USER_API_KEYS_ENCRYPTION_SECRET, MANIFEST_SIGNING_KEY. Never commit; never lose.

## Feature → file map
Backend (Express, `backend/src/`): `app.ts` wires routes; entry `index.ts`.
- Chat / assistant: `routes/chat.ts`, `routes/projectChat.ts`, `routes/wordChat.ts`,
  orchestration in `lib/chat/`.
- LLM providers: `lib/llm/` — `claude.ts`, `openai.ts`, `gemini.ts`, `openrouter.ts`,
  `ollama.ts` (dynamic `ollama list` detection; `GET /models/ollama`), `models.ts`,
  `tools.ts`. This is the seam for model routing changes.
- Documents & files: `routes/documents.ts`, `routes/sourceDocuments.ts`,
  `lib/storage.ts`, `lib/upload.ts`, `lib/convert.ts` (LibreOffice), `lib/officeText.ts`,
  `lib/spreadsheet.ts`, versions in `lib/documentVersions.ts`,
  Word tracked changes in `lib/docxTrackedChanges.ts`.
- Signed downloads: `routes/downloads.ts` + `lib/downloadTokens.ts` (HMAC).
- Projects / library: `routes/projects.ts`, `routes/library.ts`.
- Tabular review: `routes/tabular.ts` (runs the model once per cell — budget for it).
- Workflows: `routes/workflows.ts`, `routes/workflowAddons.ts`, `lib/systemWorkflows.ts`,
  `lib/workflowCatalog.ts`. System workflow content lives in the separate
  `Open-Legal-Products/mike-workflows` repo (SKILL.md files), not here.
- Case law (CourtListener): `lib/courtlistener.ts`; token via COURTLISTENER_API_TOKEN.
- Users & keys: `routes/user.ts`, `lib/userApiKeys.ts` (encrypted per-user provider
  keys; a key set globally in backend/.env makes the matching account field read-only),
  `lib/userSettings.ts`, `lib/userDataExport.ts` + `lib/manifestSigning.ts`
  (Ed25519 export manifests; pubkey at `GET /manifest-signing-key`).
- Authz & audit: `lib/access.ts`, `lib/audit.ts`, `routes/audit.ts`.
- MCP connectors: `lib/mcp/`, `lib/mcpConnectors.ts`.
- Schema: `backend/schema.sql` (FRESH DATABASES ONLY — never run against live data);
  incremental dated migrations in `backend/migrations/` (YYYYMMDD_NN_desc.sql,
  idempotent — IF NOT EXISTS / ON CONFLICT DO NOTHING).

Frontend (Next.js App Router, `frontend/src/app/`):
- Pages `(pages)/`: `projects/[id]` (workspace, + `/assistant`, `/folders`,
  `/tabular-reviews`), `assistant/chat/[id]`, `tabular-reviews/[id]`,
  `library/{files,folders,templates}`, `workflows/{assistant,tabular-review,addons}`,
  `history`, `settings/{models,api-keys,security,connectors,privacy-data,features}`.
- Components: `components/tabular/` (densest area; presets in
  `components/tabular/columnPresets.ts`), `components/shared/views/` (PdfView,
  DocxView, SpreadsheetView), `components/ui/` primitives.

## Fork discipline (keeps upstream syncs cheap)
- Never commit to `main`-mirroring branches; all our work stays on the deployment
  branch. Prefer additive changes over edits to upstream files.
- Schema changes: dated migration in `backend/migrations/`, never edit `schema.sql`.
- Sync: `git fetch upstream` → merge/rebase onto `upstream/main`, then apply only the
  new migrations in filename order, rebuild, re-run Phase 7 checks.
- `package-lock.json` merges as binary (.gitattributes): on conflict take upstream's
  and re-run `npm install`.

## Local deviations from upstream (this fork)
1. `backend/package.json`: `xlsx` installs from npm (`npm:@e965/xlsx@0.20.3`, same
   SheetJS 0.20.3 code) because this environment's egress policy blocks
   cdn.sheetjs.com. Re-check on every upstream sync.
2. `backend/Dockerfile`: LibreOffice apt install is best-effort (egress policy blocks
   apt mirrors); without it only DOC/DOCX → PDF conversion is disabled.
2b. Both Dockerfiles trust an optional `ca-bundle.crt` from the build context
   (NODE_EXTRA_CA_CERTS): this box's egress gateway TLS-intercepts npm traffic.
   The bundle itself is gitignored; copy /root/.ccr/ca-bundle.crt into backend/
   and frontend/ before building images here. No-op when the file is absent.
3. Frontend image builds from the repo root via `docker/frontend-local.Dockerfile`
   (wired in docker-compose.override.yml): the frontend type check imports types
   from `backend/src/lib/{sourceDocuments,chat/types}` (see
   `frontend/src/app/components/shared/types.ts`), which upstream's `./frontend`
   build context cannot see, so upstream's frontend/Dockerfile fails `next build`.
   Worth reporting upstream.
4. Provider API keys are intentionally blank in `backend/.env` so per-user keys stay
   editable in Settings → Models & API Keys. Ollama is reached on the host at
   OLLAMA_BASE_URL (default http://host.docker.internal:11434/v1).

## Environment quirks (this deployment box)
- Docker daemon must be started manually (`dockerd &`) and uses mirror.gcr.io as a
  Docker Hub mirror (`/etc/docker/daemon.json`) because the egress proxy denies
  Docker Hub's blob CDN.
- The Supabase JWT/anon/service_role values in docker-compose.yml are the well-known
  local demo keys: fine on loopback, REGENERATE before exposing on any network, and
  revisit AGPL §13 source-offer obligations before letting colleagues use it.
