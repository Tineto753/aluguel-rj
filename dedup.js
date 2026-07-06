// Dedup "por dentro": agrupa anúncios do mesmo imóvel entre fontes.
// Não apaga nada — marca dup_group, is_primary, dup_n, dup_fontes.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

for (const col of ["dup_group INTEGER", "is_primary INTEGER DEFAULT 1", "dup_n INTEGER DEFAULT 1", "dup_fontes TEXT"]) {
  try { db.exec(`ALTER TABLE anuncios ADD COLUMN ${col}`); } catch (e) {}
}

const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ruaNorm = s => {
  let r = norm(s).replace(/^(rua|avenida|av\.?|estrada|estr\.?|travessa|praca|alameda|rodovia|ladeira|largo)\s+/i, "");
  r = r.replace(/,.*$/, "").replace(/\d+\s*$/, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  return r;
};
const srcRank = { ZAP: 5, VR: 4, OLX: 3, QA: 2, CNM: 1 };

const rows = db.prepare("SELECT list_id, fonte, bairro, aluguel, m2, quartos, rua, lat, completude FROM anuncios").all();

// union-find
const parent = new Map();
const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
for (const r of rows) parent.set(r.list_id, r.list_id);

// buckets por chave
const byA = new Map(), byB = new Map();
for (const r of rows) {
  const bn = norm(r.bairro), q = (r.quartos || "").toString().trim();
  if (r.aluguel && bn) {
    const kA = `${bn}|${r.aluguel}|${r.m2 || ""}|${q}`;
    (byA.get(kA) || byA.set(kA, []).get(kA)).push(r.list_id);
  }
  const rn = ruaNorm(r.rua);
  if (r.aluguel && rn.length >= 4) {
    const kB = `${rn}|${r.aluguel}`;
    (byB.get(kB) || byB.set(kB, []).get(kB)).push(r.list_id);
  }
}
for (const bucket of [...byA.values(), ...byB.values()]) {
  for (let i = 1; i < bucket.length; i++) union(bucket[0], bucket[i]);
}

// agrupa
const groups = new Map();
for (const r of rows) { const g = find(r.list_id); (groups.get(g) || groups.set(g, []).get(g)).push(r); }

const upd = db.prepare("UPDATE anuncios SET dup_group=@g, is_primary=@p, dup_n=@n, dup_fontes=@f WHERE list_id=@id");
let gid = 0, dupGroups = 0, crossSrc = 0;
db.exec("BEGIN");
for (const members of groups.values()) {
  gid++;
  const fontes = [...new Set(members.map(m => m.fonte))].sort();
  if (members.length > 1) dupGroups++;
  if (fontes.length > 1) crossSrc++;
  // primário: maior completude, depois fonte mais rica, depois tem coord
  members.sort((a, b) => (b.completude || 0) - (a.completude || 0) || (srcRank[b.fonte] - srcRank[a.fonte]) || ((b.lat ? 1 : 0) - (a.lat ? 1 : 0)));
  members.forEach((m, i) => upd.run({ g: gid, p: i === 0 ? 1 : 0, n: members.length, f: fontes.join("+"), id: m.list_id }));
}
db.exec("COMMIT");

// view de candidatos únicos
db.exec(`
DROP VIEW IF EXISTS candidatos_unicos;
CREATE VIEW candidatos_unicos AS
SELECT * FROM anuncios
WHERE is_primary=1
  AND (total IS NULL OR total <= 2200)
  AND (m2 IS NULL OR m2 > 25)
  AND (n_fotos IS NULL OR n_fotos >= 1)
  AND (pet IS NULL OR pet = 1)
  AND (morro IS NULL OR morro = '-' OR morro LIKE '?%');`);

const uniq = groups.size;
console.log(`Total linhas:        ${rows.length}`);
console.log(`Grupos (únicos):     ${uniq}`);
console.log(`Colapso:             ${rows.length - uniq} linhas eram repetição (${Math.round(100*(rows.length-uniq)/rows.length)}%)`);
console.log(`Grupos com repetição:${dupGroups}`);
console.log(`Grupos cross-fonte:  ${crossSrc} (mesmo imóvel em >1 site)`);
console.log(`Candidatos únicos:   ${db.prepare("SELECT count(*) c FROM candidatos_unicos").get().c}`);
db.close();
