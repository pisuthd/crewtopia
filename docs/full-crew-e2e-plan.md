# Crewtopia full-crew e2e plan

Buyer hires the Dev Crew for 1 hr → crew builds a hotel/resort booking React app
(mock) → buyer checks preview → delivery as source zip via presigned S3 link.

## Ground truths (verified 2026-11-21)

- Negotiator/Ember brain already runs `muse-ember-1.0` on
  `https://api.meta.ai/v1` via `PROVIDER_API_KEY` (EmberFn env, live).
  `NEGOTIATOR_*` (modal GLM) fully migrated to `PROVIDER_*` — negotiator.ts,
  stack env, sandbox key injection, local `.env`. Only the **VM catalog**
  (`computer/workspace/providers.json`) is still modal-based.
- Keys flow: Lambda env → `sandbox.ts` → `/hooks/run` secrets → VM keystore.
  `PROVIDER_API_KEY` already reaches the VM. **No `META_API_KEY` — reuse
  `PROVIDER_API_KEY` everywhere.**
- `relay.ts` never sends `provider`/`model` — every member gets catalog default.
  `/task` already accepts both fields (`server.ts:362`).
- Cross-bot chat works (`runner.ts` `makeMessageRunner`, roster passed by relay).
- `shell` tool exists on the VM. Skills (5) already baked in the image.
- Sync moves bytes via backend-minted presigned URLs; the VM holds no AWS creds.
  Delivery reuses this pattern (private bucket, no public policy).
- Deployed image is `wayfind-computer:1.0` (shared lineage); bake scripts still
  reference `packages/computer/...` paths that don't exist here.

## e2e flow (`scripts/e2e/full-crew.ts`, to be written)

1. Hire 60 min: negotiate (minutes=60) → accept → fund 0.01 U (cold-buyer pattern,
   chunks=10).
2. Brief Taylor via `team-message`: hotel/resort booking React app + acceptance list.
3. Taylor splits via `message_bot` → Reef (build), Uxu (design), Moss (API mock).
4. Reef builds from `~/template`, `npm run dev` on :5173.
5. Buyer polls threads until "dev server up".
6. `preview-link` → fetch URL, assert booking/hotel/room text.
7. Taylor declares done → Reef runs `deliver` tool → source zip → S3 → buyer
   downloads via presigned GET, asserts `package.json` + `src/` + booking text.
8. `web3-deliver` submit → approve → post-window settle (cold-buyer steps).

## Work items

### 0. Adapt bake pipeline to this repo — 1-2 hrs — [ ] todo
- `computer/scripts/image/config.ts`: `DIR` → `computer/scripts/image`, env files
  → repo-root `.env.local` + `computer/scripts/image/.env`.
- `01-package-upload.ts`: `packages/computer` → `computer`; parametrize
  (`COMPUTER_IMAGE_NAME=crewtopia-computer`).
- Run `02-create-image.ts` for the new name → `crewtopia-computer:1.0`.
  Keep `wayfind-computer` untouched as fallback.

### 1. VM catalog goes meta — half day — [ ] todo
- New `computer/workspace/providers.json`, meta-only: provider `meta`
  (`https://api.meta.ai/v1`, key `{env: PROVIDER_API_KEY}`), models
  `muse-ember-1.0` (default) + `muse-spark-1.3-contributor`. Drop modal/near.
- Smoke test **before** baking: local server + one `/task` per model.
  Kills OpenAI-compat risk early. Grounded search falls back to the
  `grounded_search` tool (already Meta-backed).

### 2. Per-role models — small, backend-only — [ ] todo
- `backend-cdk/lambda/a2a/relay.ts`: role→model map. Taylor = catalog default
  (`muse-ember-1.0`, pass nothing); Reef/Moss/Uxu = `muse-spark-1.3-contributor`
  (same `meta` provider). Internal `message_bot` turns inherit the sender's model.
- Same deploy as the next backend change; no image rebuild.

### 3. Bake `crewtopia-computer:1.0` — 1 day — [ ] todo
- Contents: agent server + meta catalog + 5 skills + Vite+React+Tailwind
  hotel-booking starter in `workspace/template/` (warm `node_modules` baked in
  only if zip stays sane — measure, fallback: on-VM `npm i`).
- `01` → upload → `02` → image `1.0` → record ARN in `.computer-image-state.json`.
- Backend `COMPUTER_IMAGE_ARN` → new ARN, `cdk deploy`. All later rentals boot ours.

### 4. Delivery = source zip, presigned links — 1 day (parallel with 3) — [ ] todo
- VM `deliver` tool: `zip -r delivery.zip . -x 'node_modules/*' '.git/*'
  '.wayfind/*' '*.log' '.env*'` → PUT to backend-minted presigned URL → return key.
  Zip cap ~500MB, fail loudly above.
- Backend: `POST /computer/delivery/put-url` (usage-token gated,
  `deliveries/{taskId}.zip`, 15-min expiry) + `POST /computer/delivery/get-url`
  (buyer-session gated, **presigned GET, 7-day expiry**, private bucket).
- A2A: `web3-deliver submit` accepts/returns `{ downloadUrl }`, stored on task.

### 5. `full-crew.ts` + brief hardening — after first run — [ ] todo
- Write script per flow above; harden `ROLE_BRIEFS` from the transcript
  (Reef: "scaffold from `~/template`, never `npm create`"; Taylor: "have Reef run
  deliver when done"). Script text-assert on preview = v1 acceptance (no kane).

## Order
0 → 1 → smoke → 2 → 3 → (4 in parallel with 3) → 5.

## Done
- [x] 2026-11-21: `NEGOTIATOR_*` → `PROVIDER_*` (negotiator.ts, stack env for
  a2aFn/sandboxFn, sandbox key injection, local `.env`). A2aFn negotiator brain
  now meta/`muse-ember-1.0` like EmberFn. Deployed.
- [x] 2026-11-21: Bake pipeline adapted to this repo (`computer/...` paths,
  default image `crewtopia-computer`, Crewtopia tags).
- [x] 2026-11-21: VM catalog meta-only (`meta` provider, ember default + spark,
  key `PROVIDER_API_KEY`). `keysReady` no longer demands `MODAL_API_KEY` unless
  the catalog references it.
- [x] 2026-11-21: Smoke test green — local server, ember + spark + handoffs-on
  all reply. Fixes needed: `strict: true` on all 23 first-party tools (Meta
  Responses demands it); MCP tools left non-strict; `install_mcp_server`
  env/headers `z.record` → `[{key,value}]` pairs (records fail Meta validation).
  `WAYFIND_NO_HANDOFFS=1` escape hatch added (default: handoffs on).

## Decisions
- Presigned GET links (expire, private bucket). No public S3 policy. — locked.
- Deliverable = full project source minus junk, not `dist/` — locked.
- Key = `PROVIDER_API_KEY` everywhere, no `META_API_KEY` — locked.
- Team models: Taylor `muse-ember-1.0` (default), rest `muse-spark-1.3-contributor` — locked.
- Uxu stays as 4th member (UX), no Ash QA — locked earlier.
