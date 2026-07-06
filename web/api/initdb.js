// Cria o schema no Supabase (Postgres): imoveis (espelho, sobrescrito no sync
// diario) + anotacoes (dados do usuario, DURAVEIS — nunca apagados pelo pipeline).
// Rodar uma vez: DATABASE_URL=... node initdb.js
const { pool, IMOVEL_COLS } = require("./db");

// numericos -> numeric/double; resto -> text.
const NUM = new Set([
  "list_id", "nota_final", "aluguel", "condominio", "iptu", "total", "custo_vida",
  "m2", "banheiros", "vagas", "n_fotos", "pet", "area_servico", "mobiliado",
  "cozinha_score", "comodo_extra", "perto_metro", "baixou_preco", "lat", "lon",
  "dist_favela", "tiros_300", "tiros_1km", "coord_aprox",
]);

const colDefs = IMOVEL_COLS.map((c) => {
  if (c === "list_id") return "list_id BIGINT PRIMARY KEY";
  return `${c} ${NUM.has(c) ? "DOUBLE PRECISION" : "TEXT"}`;
}).join(", ");

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS imoveis (${colDefs})`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS anotacoes (
      list_id BIGINT PRIMARY KEY,
      favorito INTEGER DEFAULT 0,
      status TEXT,
      nota TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  console.log("Schema Supabase pronto: imoveis (%d cols) + anotacoes", IMOVEL_COLS.length);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
