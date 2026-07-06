# Dashboard Aluguel RJ — online com senha

Arquitetura: **Vercel (UI)** + **Render (API + senha)** + **Supabase (Postgres)**.

```
pipeline local (06:00) --push--> Supabase (imoveis + suas anotacoes)
                                     ^
Vercel (UI) <---fetch/auth---> Render (API + JWT) <---SQL---/
```

- Os **imoveis** são um espelho do `aluguel.db` local, reescritos todo dia pelo sync.
- Suas **anotacoes** (favorito, status, nota) ficam numa tabela separada e **nunca são apagadas** pelo refresh diário.

## Estrutura
- `api/`  — servidor Express (deploy no Render). Login por senha -> JWT.
- `ui/`   — dashboard estatico (deploy no Vercel). Busca dados da API.
- `sync/` — `push_to_supabase.js`, roda no pipeline diario local.

---

## Passo 1 — Supabase (banco)
Você já tem projeto. Pegue a **connection string** em
`Project Settings > Database > Connection string > URI` (use o **pooler**, porta 6543).

Crie o schema (uma vez), da sua máquina:
```bash
cd ~/aluguel_rj/web/api
DATABASE_URL='postgresql://postgres.xxxx:SENHA@aws-0-...pooler.supabase.com:6543/postgres' node initdb.js
```

## Passo 2 — Sync inicial (popular imoveis)
```bash
cd ~/aluguel_rj/web
cp .env.example .env      # e coloque a DATABASE_URL dentro
node sync/push_to_supabase.js
```

## Passo 3 — Render (API)
1. `render.com` > New > Web Service > conecte o repo (ou deploy manual).
2. Root Directory: `web/api` · Build: `npm install` · Start: `npm start`.
3. Environment (Environment Variables):
   - `APP_PASSWORD` = a senha do dashboard
   - `JWT_SECRET` = string longa aleatoria (`openssl rand -hex 32`)
   - `DATABASE_URL` = connection string do Supabase
   - `CORS_ORIGIN` = a URL do Vercel (preencher no passo 4, depois redeploy)
4. Anote a URL publica (ex: `https://aluguel-rj-api.onrender.com`).

## Passo 4 — Vercel (UI)
1. Edite `ui/config.js` -> `window.API_BASE = "https://SUA-API.onrender.com";`
2. `vercel.com` > New Project > Root Directory: `web/ui` (framework: Other).
3. Deploy. Pegue a URL (ex: `https://aluguel-rj.vercel.app`).
4. Volte no Render, ajuste `CORS_ORIGIN` pra essa URL e redeploy.

## Passo 5 — Sync diario automatico
O `~/aluguel_rj/atualiza.sh` já chama o sync no fim (ver linha "push_to_supabase").
Precisa do `~/aluguel_rj/web/.env` com a `DATABASE_URL`.

---

### Dev local
```bash
# API
cd web/api && DATABASE_URL=... APP_PASSWORD=teste JWT_SECRET=x npm start
# UI (config.js apontando pra http://localhost:8787)
cd web/ui && python -m http.server 5500
```

### Notas
- Render free "dorme" apos ~15min de inatividade (cold start ~30s no 1o acesso).
- Token JWT dura 30 dias no navegador (localStorage).
- Trocar a senha: muda `APP_PASSWORD` no Render e faz login de novo.
