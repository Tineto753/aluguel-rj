// Le os primarios do aluguel.db local e substitui a tabela imoveis no Supabase.
// NAO toca em anotacoes (dados duraveis do usuario ficam intactos).
// Env necessario: DATABASE_URL (sourced de ~/aluguel_rj/web/.env).
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// carrega ~/aluguel_rj/web/.env (KEY=VALUE simples) sem dependencia externa
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const IMOVEL_COLS = [
  "list_id", "nota_final", "bairro", "bairro_classe", "fonte", "titulo", "url",
  "aluguel", "condominio", "iptu", "total", "custo_vida", "m2", "quartos",
  "banheiros", "vagas", "n_fotos", "pet", "area_servico", "mobiliado",
  "cozinha_score", "comodo_extra", "perto_metro", "baixou_preco", "categoria",
  "tipo", "rua", "lat", "lon", "morro", "dist_favela", "favela_prox",
  "tiros_300", "tiros_1km", "coord_aprox", "telefone", "whatsapp", "anunciante",
  "re_complex_features", "dup_fontes", "thumb", "primeiro_visto",
];

async function main() {
  const local = new DatabaseSync(path.join(__dirname, "..", "..", "aluguel.db"));
  const rows = local.prepare(
    `SELECT ${IMOVEL_COLS.join(",")} FROM anuncios WHERE is_primary=1`
  ).all();
  local.close();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // limpa e reescreve (anotacoes ficam em tabela separada, intactas)
    await client.query("TRUNCATE imoveis");

    const collist = IMOVEL_COLS.join(",");
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const base = j * IMOVEL_COLS.length;
        values.push("(" + IMOVEL_COLS.map((_, k) => `$${base + k + 1}`).join(",") + ")");
        for (const c of IMOVEL_COLS) params.push(r[c] === undefined ? null : r[c]);
      });
      await client.query(
        `INSERT INTO imoveis (${collist}) VALUES ${values.join(",")}`,
        params
      );
    }
    await client.query("COMMIT");
    console.log(`Supabase: ${rows.length} imoveis empurrados.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
