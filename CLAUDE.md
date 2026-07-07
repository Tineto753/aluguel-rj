# Aluguel RJ — busca de imóvel com filtro de segurança

Pipeline que coleta anúncios de aluguel do Rio, cruza com **camadas de segurança**
(favela / assalto / mortalidade / tiroteio / grupos armados) e ranqueia. Tem
dashboard **online com senha** (lista + mapa + anotações).

Objetivo do dono: achar imóvel pra morar (solteiro + pet, aceita animais é
inegociável). **Segurança é a fronteira**: coleta de qualquer fonte, mas só
mantém/mostra onde as camadas de risco existem.

## Duas metades

### 1. Pipeline de dados (local, `~/aluguel_rj/*.js` + `aluguel.db`)
- Banco: **SQLite** `aluguel.db` (`node:sqlite` nativo, sem servidor). Tabela
  `anuncios` (~50 cols) + views (`candidatos`, `candidatos_unicos`, `ranking`).
- Runner diário: **`atualiza.sh`** (systemd user timer 06:00). Fases:
  `coleta_{olx,zap,vivareal,qa,cnm}` → `enrich_qa` → marca novos → `dedup` →
  `merge_grupos` → `sabren` → `buffer` → `build_bairro_crime` → `tiros_freq` →
  `rank` → `gera_html` → `gera_mapa` → `push_to_supabase` (se `web/.env`).
- `atualiza_semanal.sh` (dom): refresh tiroteios (Fogo Cruzado) + crime ISP.
- Dados-fonte estáticos em `data/` (bairros.geojson, cisp.kml, isp_cisp.csv…).
- Coletores hoje têm lista fixa `BAIRROS` (~10 slugs zona-norte). **Próximo passo
  planejado:** expandir p/ todos os bairros do Rio, varrendo por ZONA
  (URL OLX: `.../rio-de-janeiro-e-regiao/<zona>/<bairro>`).

Camadas de risco (cada imóvel c/ coord recebe): `dist_favela`+`favela_prox`
(SABREN, point-in-polygon), `tiros_300/1km/2km` (Fogo Cruzado, densidade por
raio), `taxa_assalto_bairro`/`taxa_mort_bairro` (ISP por CISP→bairro),
`grupos_armados` (GENI, por comunidade). Números ABSOLUTOS de AISP eram grossos →
migrado p/ per-capita por bairro.

### 2. Dashboard online (`~/aluguel_rj/web/`) — **NO AR**
Stack split: **Vercel (UI)** + **Render (API)** + **Supabase (Postgres)**.
- `web/api/` — Express + `pg` + JWT. Login por senha (`APP_PASSWORD`) → token 30d.
  Rotas: `/api/login`, `/api/imoveis` (imóveis + anotações via LEFT JOIN),
  `/api/anotacoes/:id` (upsert favorito/status/nota), `/api/health`.
- `web/ui/` — estático (Vercel). Login, filtros (mesmos da lista local),
  **aba Lista + aba Mapa** (Leaflet), anotações por card, botão recolher filtros.
- `web/sync/push_to_supabase.js` — lê primários do `aluguel.db` e reescreve a
  tabela `imoveis` no Supabase (TRUNCATE+insert). **NÃO toca `anotacoes`**
  (tabela separada por `list_id`, durável — sobrevive ao refresh diário).

URLs: site https://ui-chi-gules.vercel.app · API https://aluguel-rj-api.onrender.com
Supabase: tabelas `imoveis` (espelho) + `anotacoes` (dados do user).

## Deploy / operação
- **API (Render):** auto-deploy no push do `master`. Env vars no painel do Render
  (`APP_PASSWORD`, `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`). Plano free DORME
  após ~15min (cold start ~30s). CLI: `render` (logado). `render services update`
  NÃO edita env-var (só painel/API).
- **UI (Vercel):** `cd web/ui && npx vercel --prod --yes`. Bump `?v=N` nos assets
  (`index.html`) a cada mudança de JS/CSS pra furar cache.
- **Segredos:** `web/.env` (DATABASE_URL, p/ sync) e `web/api/.env` (local dev),
  ambos gitignored. NUNCA commitar. No Render vão no painel.
- Repo GitHub `Tineto753/aluguel-rj` está **público** (Render CLI não puxava
  privado sem conexão GitHub↔workspace). Voltar p/ privado exige arrumar essa
  conexão antes, senão auto-deploy quebra.

## Gotchas (já custaram tempo)
- **`[hidden]` vs CSS `display`:** `el.hidden=true` NÃO esconde se uma classe
  define `display` (ex `.grid{display:grid}` vence o UA `[hidden]{display:none}`).
  Fix global no `style.css`: `[hidden]{display:none!important}`.
- **`""` → null no sync:** SQLite guarda string vazia em coluna numérica;
  Postgres rejeita. `push_to_supabase.js` converte `""`/undefined → null.
- **Leaflet self-hosted** em `web/ui/vendor/leaflet/` (unpkg pode ser bloqueado
  por rede/adblock). Tiles CARTO com fallback OSM em `tileerror`.
- **`web/ui/data/`** (geojson das camadas) é ignorado pela regra `data/` do
  `.gitignore` raiz → foi versionado com `git add -f`. Vercel sobe mesmo assim.
- **Diagnóstico de front remoto:** `puppeteer-core` + `/usr/bin/google-chrome-stable`
  headless (login real → click → screenshot + console + requestfailed). "Funciona
  no meu teste" vs no user costuma ser cache ou layout — screenshot resolve.

## Queries úteis
```bash
sqlite3 aluguel.db "SELECT * FROM ranking LIMIT 15"     # top no escopo
sqlite3 aluguel.db "SELECT count(*) FROM anuncios"
```

## Convenções
- Comentários e mensagens em pt-BR. Commits terminam com Co-Authored-By do Claude.
- Filosofia de filtros: poucos ELIMINATÓRIOS (só inegociáveis: pet, favela,
  ≤25m², sem foto), muitos PONTUADORES. Dado faltando afunda no ranking, não corta.
