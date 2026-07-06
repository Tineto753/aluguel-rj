// Cria o schema SQLite do estudo de aluguel RJ.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const DB = process.env.ALUGUEL_DB || path.join(__dirname, "aluguel.db");
const db = new DatabaseSync(DB);

db.exec(`
CREATE TABLE IF NOT EXISTS anuncios (
  list_id        INTEGER PRIMARY KEY,     -- id do OLX (ou hash p/ outras fontes)
  fonte          TEXT NOT NULL,           -- OLX / QA / VR
  coletado_em    TEXT NOT NULL,
  bairro         TEXT,
  bairro_alvo    TEXT,                    -- slug do bairro-alvo que gerou a busca
  categoria      TEXT,                    -- Apartamentos / Casas / Kitnets...
  tipo           TEXT,                    -- real_estate_type
  titulo         TEXT,
  url            TEXT UNIQUE,
  -- preço
  aluguel        INTEGER,
  condominio     INTEGER,
  iptu           INTEGER,
  total          INTEGER,                 -- aluguel + cond + iptu (conhecidos)
  contas_est     INTEGER,                 -- estimativa energia+agua+gas
  custo_vida     INTEGER,                 -- total + contas_est
  old_price      INTEGER,
  baixou_preco   INTEGER DEFAULT 0,       -- 1 se old_price > aluguel
  -- físico
  m2             INTEGER,
  quartos        TEXT,
  banheiros      INTEGER,
  vagas          INTEGER,
  n_fotos        INTEGER,
  -- amenidades (dado oficial OLX)
  pet            INTEGER,                  -- 1 permitido, 0 proibido, NULL desconhecido
  area_servico   INTEGER,                 -- 1 se re_features menciona
  re_features         TEXT,
  re_complex_features TEXT,
  -- enriquecimento (2ª passada)
  rua            TEXT,
  cep            TEXT,
  lat            REAL,
  lon            REAL,
  morro          TEXT,                     -- nome da favela ou '-' ou NULL
  descricao      TEXT,
  cozinha_score  INTEGER,
  comodo_extra   INTEGER,
  mobiliado      INTEGER,
  -- meta
  completude     INTEGER,                  -- 0..N campos-chave preenchidos
  nota_final     REAL
);

CREATE INDEX IF NOT EXISTS idx_bairro ON anuncios(bairro_alvo);
CREATE INDEX IF NOT EXISTS idx_custo  ON anuncios(custo_vida);

-- VIEW de candidatos: aplica os CORTES via SQL (não apaga nada da tabela)
DROP VIEW IF EXISTS candidatos;
CREATE VIEW candidatos AS
SELECT * FROM anuncios
WHERE (total IS NULL OR total <= 2200)          -- teto (aluguel+cond+iptu)
  AND (m2 IS NULL OR m2 > 25)                    -- corte de tamanho (só se informado)
  AND (n_fotos IS NULL OR n_fotos >= 1)          -- tem foto
  AND (pet IS NULL OR pet = 1)                    -- não corta desconhecido, corta proibido
  AND (morro IS NULL OR morro = '-' OR morro LIKE '?%');  -- fora de favela detectada
`);

console.log("Schema criado em", DB);
db.close();
