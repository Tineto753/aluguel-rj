// Ranking: calcula nota_final (0-100) dos candidatos únicos.
// Pesos refletem prioridades: custo-benefício + segurança(bairro) + tamanho + spec(área serviço/pet) + completude.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

// classificação pelo bairro REAL (normalizado), não pelo que foi pesquisado
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const VERDE = new Set(["meier", "todos os santos", "vila da penha", "piedade", "vista alegre", "vila isabel", "tijuca", "grajau", "maracana"]);
const AMARELO = new Set(["cachambi", "del castilho", "agua santa"]);
const VERMELHO = new Set(["engenho de dentro", "engenho novo", "lins de vasconcelos"]);
function classe(bairro) {
  const b = norm(bairro);
  if (VERDE.has(b)) return "verde";
  if (AMARELO.has(b)) return "amarelo";
  if (VERMELHO.has(b)) return "vermelho";
  return "fora";
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const qInt = q => { const n = parseInt(q); return isNaN(n) ? null : n; };
const m2ok = m => (m && m > 0 && m <= 1000) ? m : null;  // capa m² absurdo

const W = { preco: 24, bairro: 16, borda: 20, m2: 12, quartos: 8, completude: 8, aserv: 5, pet: 3, baixou: 2, fotos: 2 };

function nota(r) {
  const s = {};
  const m2 = m2ok(r.m2);
  // custo-benefício: 1500 (ou menos) = 1.0 ; 2600 = 0
  s.preco = r.custo_vida == null ? 0.45 : clamp((2600 - r.custo_vida) / 1100, 0, 1);
  // segurança do bairro (real)
  const cl = classe(r.bairro);
  s.bairro = cl === "verde" ? 1.0 : cl === "amarelo" ? 0.6 : cl === "vermelho" ? 0.3 : 0;
  // distância à favela (segurança de BORDA) — peso forte
  const d = r.dist_favela;
  s.borda = d == null ? 0.5 : d === 0 ? 0 : d < 150 ? 0.08 : d < 400 ? 0.4 : d < 800 ? 0.75 : 1;
  // tamanho: 25->0, 35->0.5, 60+->1
  s.m2 = m2 == null ? 0.4 : clamp((m2 - 25) / 35, 0, 1);
  // quartos: 2+ ideal p/ setup dele
  const q = qInt(r.quartos);
  s.quartos = q == null ? 0.4 : q >= 2 ? 1 : q === 1 ? 0.5 : 0.3;
  s.completude = clamp((r.completude || 0) / 6, 0, 1);
  s.aserv = r.area_servico === 1 ? 1 : 0;
  s.pet = r.pet === 1 ? 1 : 0;
  s.baixou = r.baixou_preco === 1 ? 1 : 0;
  s.fotos = (r.n_fotos || 0) >= 1 ? 1 : 0;
  let total = 0; for (const k in W) total += W[k] * s[k];
  return Math.round(total * 10) / 10;
}

try { db.exec("ALTER TABLE anuncios ADD COLUMN bairro_classe TEXT"); } catch (e) {}
// ranqueia TODOS os primários (o dashboard filtra; nada fica sem nota ao afrouxar filtro)
const rows = db.prepare("SELECT * FROM anuncios WHERE is_primary=1").all();
const upd = db.prepare("UPDATE anuncios SET nota_final=@n, bairro_classe=@c WHERE list_id=@id");
db.exec("BEGIN");
for (const r of rows) upd.run({ n: nota(r), c: classe(r.bairro), id: r.list_id });
db.exec("COMMIT");

// ranking = só bairros do escopo (verde/amarelo/vermelho); vizinhos = fora-escopo à parte
db.exec(`DROP VIEW IF EXISTS ranking;
CREATE VIEW ranking AS SELECT * FROM candidatos_unicos WHERE bairro_classe IN ('verde','amarelo','vermelho') ORDER BY nota_final DESC;
DROP VIEW IF EXISTS vizinhos;
CREATE VIEW vizinhos AS SELECT * FROM candidatos_unicos WHERE bairro_classe='fora' ORDER BY nota_final DESC;`);

const nEsc = db.prepare("SELECT count(*) c FROM ranking").get().c;
const nViz = db.prepare("SELECT count(*) c FROM vizinhos").get().c;
console.log(`Ranqueados: ${rows.length} | no escopo: ${nEsc} | vizinhos fora-escopo: ${nViz}\n`);
console.log("=== TOP 15 (no escopo) ===");
const top = db.prepare("SELECT nota_final n, bairro, aluguel al, custo_vida cv, m2, quartos q, CASE WHEN pet=1 THEN 'pet' ELSE '' END pet, CASE WHEN area_servico=1 THEN 'AS' ELSE '' END aserv, CASE WHEN baixou_preco=1 THEN '↓' ELSE '' END bx, fonte FROM ranking LIMIT 15").all();
for (const t of top) console.log(
  `${String(t.n).padStart(5)} | ${(t.bairro || "").slice(0, 16).padEnd(16)} | R$${String(t.al).padStart(4)} cv${String(t.cv || "?").padStart(4)} | ${String(t.m2 || "?").padStart(3)}m² ${t.q || "?"}q | ${t.pet.padEnd(3)} ${t.aserv.padEnd(2)} ${t.bx} | ${t.fonte}`);
db.close();
