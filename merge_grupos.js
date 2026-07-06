// Consolida cada dup_group: o primário herda campos faltantes dos irmãos.
// Preenche só NULL/'' — não sobrescreve dado existente do primário.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

try { db.exec("ALTER TABLE anuncios ADD COLUMN fontes_dado TEXT"); } catch (e) {}

const FILL = ["rua", "cep", "lat", "lon", "condominio", "iptu", "m2", "quartos", "banheiros",
  "vagas", "n_fotos", "pet", "area_servico", "re_features", "re_complex_features", "descricao",
  "mobiliado", "cozinha_score", "comodo_extra", "perto_metro", "telefone", "whatsapp", "anunciante", "thumb", "coord_aprox"];
const empty = v => v === null || v === undefined || v === "";

const groups = db.prepare("SELECT DISTINCT dup_group FROM anuncios WHERE dup_n>=2").all();
const getMembers = db.prepare("SELECT * FROM anuncios WHERE dup_group=? ORDER BY is_primary DESC");
const setCols = FILL.concat(["total", "custo_vida", "fontes_dado"]);
const upd = db.prepare(`UPDATE anuncios SET ${setCols.map(c => c + "=@" + c).join(",")} WHERE list_id=@id`);

let enriquecidos = 0, campos = 0;
db.exec("BEGIN");
for (const { dup_group } of groups) {
  const mem = getMembers.all(dup_group);
  const prim = mem[0];
  const patch = {}; let changed = false;
  for (const f of FILL) {
    if (!empty(prim[f])) continue;
    const src = mem.find(m => !empty(m[f]));
    if (src) { patch[f] = src[f]; changed = true; campos++; }
  }
  if (!changed) continue;
  enriquecidos++;
  const merged = { ...prim, ...patch };
  // recompute total/custo se ganhou cond/iptu
  if (merged.aluguel != null) {
    merged.total = merged.aluguel + (merged.condominio || 0) + (merged.iptu || 0);
    merged.custo_vida = merged.total + (merged.contas_est || 220);
  }
  merged.fontes_dado = [...new Set(mem.map(m => m.fonte))].sort().join("+");
  const args = { id: prim.list_id };
  for (const c of setCols) args[c] = merged[c] !== undefined ? merged[c] : prim[c];
  upd.run(args);
}
db.exec("COMMIT");

console.log(`Grupos processados:     ${groups.length}`);
console.log(`Primários enriquecidos: ${enriquecidos}`);
console.log(`Campos preenchidos:     ${campos}`);
// impacto: primários únicos com coord antes/depois
const c = db.prepare("SELECT sum(lat IS NOT NULL) coord, sum(rua IS NOT NULL) rua, sum(pet=1) pet FROM anuncios WHERE is_primary=1").get();
console.log(`\nPrimários (1665) agora: coord=${c.coord} rua=${c.rua} pet=${c.pet}`);
db.close();
