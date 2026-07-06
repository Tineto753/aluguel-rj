// API do dashboard de aluguel RJ.
// Auth: senha unica compartilhada (APP_PASSWORD) -> JWT Bearer.
// Dados: imoveis (read, espelho do pipeline) + anotacoes (read/write, duraveis).
// Banco: Supabase (Postgres) via pool em db.js.
// carrega ./.env em dev, se existir (no Render as envs vem do painel)
const fs = require("fs");
const path = require("path");
const _envPath = path.join(__dirname, ".env");
if (fs.existsSync(_envPath)) {
  for (const line of fs.readFileSync(_envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { pool, IMOVEL_COLS } = require("./db");

const PORT = process.env.PORT || 8787;
const APP_PASSWORD = process.env.APP_PASSWORD;      // senha do dashboard
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-troque-em-prod";
const ORIGIN = process.env.CORS_ORIGIN || "*";      // URL do Vercel em prod

if (!APP_PASSWORD) {
  console.error("Falta APP_PASSWORD no ambiente.");
  process.exit(1);
}

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

// --- auth ---
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: "senha incorreta" });
  }
  const token = jwt.sign({ sub: "user" }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token });
});

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sem token" });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "token invalido" });
  }
}

// --- health (pra Render nao dormir / checar) ---
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- imoveis + anotacoes (join) ---
app.get("/api/imoveis", auth, async (_req, res) => {
  try {
    const cols = IMOVEL_COLS.map((c) => `i.${c}`).join(", ");
    const r = await pool.query(`
      SELECT ${cols},
             a.favorito, a.status AS anot_status, a.nota AS anot_nota
      FROM imoveis i
      LEFT JOIN anotacoes a ON a.list_id = i.list_id
    `);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "erro ao ler imoveis" });
  }
});

// --- upsert de anotacao ---
app.put("/api/anotacoes/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id invalido" });
  const { favorito, status, nota } = req.body || {};
  try {
    await pool.query(
      `INSERT INTO anotacoes (list_id, favorito, status, nota, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (list_id) DO UPDATE SET
         favorito = EXCLUDED.favorito,
         status   = EXCLUDED.status,
         nota     = EXCLUDED.nota,
         updated_at = EXCLUDED.updated_at`,
      [id, favorito ? 1 : 0, status ?? null, nota ?? null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "erro ao salvar anotacao" });
  }
});

app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
