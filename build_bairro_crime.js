// Crime POR BAIRRO: taxa per-capita por CISP (fino) atribuída a cada bairro (via delegacia que o contém).
// Substitui a camada AISP (grossa/quebrada). Gera bairros_crime.geojson + atualiza imóveis.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const TMP = path.join(__dirname, "data") + "/";
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));
for (const c of ["taxa_assalto_bairro REAL", "taxa_mort_bairro REAL", "cisp INTEGER"]) { try { db.exec("ALTER TABLE anuncios ADD COLUMN " + c); } catch (e) {} }
const num = v => v == null || v === "" ? 0 : (+("" + v).replace(",", ".") || 0);
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// --- crime por CISP (2024-25) ---
const cl = fs.readFileSync(TMP + "isp_cisp.csv", "utf8").split(/\r?\n/).filter(Boolean);
const CH = {}; cl[0].split(";").forEach((h, i) => CH[h.trim()] = i);
const cispCrime = {};
for (let i = 1; i < cl.length; i++) { const r = cl[i].split(";"); if (+r[CH.ano] < 2024) continue;
  const c = r[CH.cisp]; const o = cispCrime[c] || (cispCrime[c] = { assalto: 0, mort: 0 });
  o.assalto += num(r[CH.roubo_transeunte]); o.mort += num(r[CH.letalidade_violenta]); }
// --- pop por CISP (ano recente) ---
const pl = fs.readFileSync(TMP + "pop_aisp.csv", "utf8").split(/\r?\n/).filter(Boolean);
const PH = {}; pl[0].split(";").forEach((h, i) => PH[h.trim()] = i);
const cispPop = {}, cy = {};
for (let i = 1; i < pl.length; i++) { const r = pl[i].split(";"); const c = r[PH.circ], a = +r[PH.ano];
  if (!cy[c] || a >= cy[c]) { cy[c] = a; cispPop[c] = num(r[PH.pop_circ]); } }
const cispTaxa = {};
for (const c in cispCrime) { const p = cispPop[c] || 0;
  cispTaxa[c] = p > 0 ? { assalto: +(cispCrime[c].assalto / 2 / p * 1e5).toFixed(0), mort: +(cispCrime[c].mort / 2 / p * 1e5).toFixed(1) } : { assalto: null, mort: null }; }

// --- polígonos CISP (KML) ---
const kml = fs.readFileSync(TMP + "cisp.kml", "utf8");
const cispFeats = [];
for (const pm of kml.split("<Placemark").slice(1)) {
  const nm = (pm.match(/<name>\s*(\d+)\s*<\/name>/) || [])[1]; if (!nm) continue;
  for (const cb of (pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/g) || [])) {
    const ring = cb.replace(/<\/?coordinates>/g, "").trim().split(/\s+/).map(t => { const p = t.split(","); return [+p[0], +p[1]]; }).filter(p => !isNaN(p[0]));
    if (ring.length > 3) { let b = [1e9, 1e9, -1e9, -1e9]; for (const [x, y] of ring) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } cispFeats.push({ cisp: nm, ring, bb: b }); }
  }
}
function pip(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
function cispDe(lon, lat) { for (const f of cispFeats) { const b = f.bb; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue; if (pip(lon, lat, f.ring)) return f.cisp; } return null; }

// --- bairros: centroide -> CISP -> taxa ---
const bj = JSON.parse(fs.readFileSync(TMP + "bairros.geojson", "utf8"));
function outerRing(geom) { return geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates.map(p => p[0]).sort((a, b) => b.length - a.length)[0]; }
const bairroTaxa = {}; // norm(nome) -> {assalto,mort,cisp}
for (const f of bj.features) {
  const nome = f.properties.nome; const ring = outerRing(f.geometry);
  let sx = 0, sy = 0; for (const [x, y] of ring) { sx += x; sy += y; } const cx = sx / ring.length, cy2 = sy / ring.length;
  const c = cispDe(cx, cy2) || cispDe(ring[0][0], ring[0][1]);
  const t = c ? cispTaxa[c] : null;
  f.properties.taxa_assalto = t ? t.assalto : null; f.properties.taxa_mort = t ? t.mort : null; f.properties.cisp = c ? +c : null;
  bairroTaxa[norm(nome)] = { assalto: f.properties.taxa_assalto, mort: f.properties.taxa_mort, cisp: c ? +c : null };
}
fs.writeFileSync(path.join(__dirname, "bairros_crime.geojson"), JSON.stringify(bj));
const comTaxa = bj.features.filter(f => f.properties.taxa_assalto != null).length;
console.log("Bairros:", bj.features.length, "| com taxa:", comTaxa);
const top = bj.features.filter(f => f.properties.taxa_mort != null).sort((a, b) => b.properties.taxa_mort - a.properties.taxa_mort);
console.log("Pior mortalidade:", top.slice(0, 3).map(f => f.properties.nome + " " + f.properties.taxa_mort).join(" · "));
console.log("Melhor:", top.slice(-3).map(f => f.properties.nome + " " + f.properties.taxa_mort).join(" · "));

// --- atualiza imóveis por nome de bairro ---
const rows = db.prepare("SELECT list_id, bairro FROM anuncios WHERE is_primary=1").all();
const upd = db.prepare("UPDATE anuncios SET taxa_assalto_bairro=@a, taxa_mort_bairro=@m, cisp=@c WHERE list_id=@id");
db.exec("BEGIN"); let hit = 0;
for (const r of rows) { const t = bairroTaxa[norm(r.bairro)]; if (!t) continue; upd.run({ a: t.assalto, m: t.mort, c: t.cisp, id: r.list_id }); hit++; }
db.exec("COMMIT");
console.log("Imóveis c/ taxa por bairro:", hit, "/", rows.length);
db.close();
