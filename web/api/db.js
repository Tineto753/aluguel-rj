// Pool Postgres (Supabase) compartilhado. Connection string via env DATABASE_URL.
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL no ambiente (connection string do Supabase).");
  process.exit(1);
}

// Supabase exige SSL. rejectUnauthorized:false = aceita o cert gerenciado deles.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Colunas dos imoveis espelhadas do banco local (aluguel.db). list_id = PK.
// Mantido em sincronia com web/sync/push_to_supabase.js e o SELECT do gera_html.
const IMOVEL_COLS = [
  "list_id", "nota_final", "bairro", "bairro_classe", "fonte", "titulo", "url",
  "aluguel", "condominio", "iptu", "total", "custo_vida", "m2", "quartos",
  "banheiros", "vagas", "n_fotos", "pet", "area_servico", "mobiliado",
  "cozinha_score", "comodo_extra", "perto_metro", "baixou_preco", "categoria",
  "tipo", "rua", "lat", "lon", "morro", "dist_favela", "favela_prox",
  "tiros_300", "tiros_1km", "coord_aprox", "telefone", "whatsapp", "anunciante",
  "re_complex_features", "dup_fontes", "thumb", "primeiro_visto",
];

module.exports = { pool, IMOVEL_COLS };
