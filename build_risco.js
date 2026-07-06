// Consolida as camadas de risco: taxas per-capita (assalto/mortalidade por AISP) +
// densidade de tiroteios (Fogo Cruzado) por raio. Salva geojson de AISP p/ o mapa.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const TMP = "/home/argo/.claude/jobs/075c12f9/tmp/";
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));
for (const c of ["taxa_assalto REAL", "taxa_mortalidade REAL", "tiroteios_prox INTEGER"]) { try { db.exec("ALTER TABLE anuncios ADD COLUMN " + c); } catch (e) {} }
const num = v => v == null || v === "" ? 0 : (+("" + v).replace(",", ".") || 0);

// --- crime por AISP (2024-25) + cisp->aisp ---
const crimeLines = fs.readFileSync(TMP + "isp_cisp.csv", "utf8").split(/\r?\n/).filter(Boolean);
const CH = {}; crimeLines[0].split(";").forEach((h, i) => CH[h.trim()] = i);
const cispAisp = {}, aispCrime = {};
for (let i = 1; i < crimeLines.length; i++) {
  const r = crimeLines[i].split(";"); if (+r[CH.ano] < 2024) continue;
  const cisp = r[CH.cisp], aisp = r[CH.aisp]; cispAisp[cisp] = aisp;
  const o = aispCrime[aisp] || (aispCrime[aisp] = { assalto: 0, mort: 0 });
  o.assalto += num(r[CH.roubo_transeunte]); o.mort += num(r[CH.letalidade_violenta]);
}
// --- população por CISP (ano mais recente) -> soma por AISP ---
const popLines = fs.readFileSync(TMP + "pop_aisp.csv", "utf8").split(/\r?\n/).filter(Boolean);
const PH = {}; popLines[0].split(";").forEach((h, i) => PH[h.trim()] = i);
const cispPop = {}, cispYear = {};
for (let i = 1; i < popLines.length; i++) {
  const r = popLines[i].split(";"); const cisp = r[PH.circ], ano = +r[PH.ano], pop = num(r[PH.pop_circ]);
  if (!cispYear[cisp] || ano >= cispYear[cisp]) { cispYear[cisp] = ano; cispPop[cisp] = pop; }
}
const aispPop = {};
for (const cisp in cispPop) { const a = cispAisp[cisp]; if (a) aispPop[a] = (aispPop[a] || 0) + cispPop[cisp]; }
// --- taxas por 100 mil/ano (crime é soma de ~2 anos -> /2) ---
const YEARS = 2;
const taxa = {};
for (const a in aispCrime) {
  const pop = aispPop[a] || 0;
  taxa[a] = pop > 0 ? {
    assalto: +(aispCrime[a].assalto / YEARS / pop * 1e5).toFixed(1),
    mort: +(aispCrime[a].mort / YEARS / pop * 1e5).toFixed(1),
    pop
  } : { assalto: null, mort: null, pop };
}
console.log("AISPs c/ taxa:", Object.keys(taxa).length);
const rank = Object.entries(taxa).filter(([, t]) => t.assalto != null).sort((a, b) => b[1].assalto - a[1].assalto);
console.log("Pior assalto (taxa/100mil): AISP", rank[0][0], rank[0][1].assalto, "| Melhor:", rank.at(-1)[0], rank.at(-1)[1].assalto);
const rankM = Object.entries(taxa).filter(([, t]) => t.mort != null).sort((a, b) => b[1].mort - a[1].mort);
console.log("Pior mortalidade: AISP", rankM[0][0], rankM[0][1].mort, "| Melhor:", rankM.at(-1)[0], rankM.at(-1)[1].mort);

// --- tiroteios (Fogo Cruzado) ---
const tiroLines = fs.readFileSync(path.join(__dirname, "tiroteios_rj.csv"), "utf8").split(/\r?\n/).filter(Boolean);
const TIH = {}; tiroLines[0].split(",").forEach((h, i) => TIH[h.trim()] = i);
const LAT0 = -22.9, MLAT = 111320, MLON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const tiros = [];
for (let i = 1; i < tiroLines.length; i++) {
  const r = tiroLines[i].split(","); const lat = +r[TIH.lat], lon = +r[TIH.lon];
  if (!isNaN(lat) && !isNaN(lon)) tiros.push([lon * MLON, lat * MLAT]);
}
console.log("Tiroteios georref:", tiros.length);
const R = 500; // raio de contagem (m)

// --- atualiza imóveis ---
const rows = db.prepare("SELECT list_id, lat, lon, aisp FROM anuncios WHERE lat IS NOT NULL AND lon IS NOT NULL").all();
const upd = db.prepare("UPDATE anuncios SET taxa_assalto=@ta, taxa_mortalidade=@tm, tiroteios_prox=@tp WHERE list_id=@id");
db.exec("BEGIN");
for (const r of rows) {
  const t = taxa[r.aisp] || {};
  const x = r.lon * MLON, y = r.lat * MLAT; let c = 0;
  for (const p of tiros) { if (Math.abs(p[0] - x) < R && Math.abs(p[1] - y) < R && Math.hypot(p[0] - x, p[1] - y) < R) c++; }
  upd.run({ ta: t.assalto ?? null, tm: t.mort ?? null, tp: c, id: r.list_id });
}
db.exec("COMMIT");

// --- geojson de AISP (do KML) com as taxas, p/ o mapa ---
const kml = fs.readFileSync(TMP + "doc.kml", "utf8");
const feats = [];
for (const pm of kml.split("<Placemark").slice(1)) {
  const nm = (pm.match(/<name>\s*(\d+)\s*<\/name>/) || [])[1]; if (!nm) continue;
  const rings = (pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/g) || []).map(cb =>
    cb.replace(/<\/?coordinates>/g, "").trim().split(/\s+/).map(t => { const p = t.split(","); return [+p[0], +p[1]]; }).filter(p => !isNaN(p[0])));
  for (const ring of rings) if (ring.length > 3) feats.push({ type: "Feature",
    properties: { aisp: +nm, taxa_assalto: taxa[nm]?.assalto ?? null, taxa_mort: taxa[nm]?.mort ?? null },
    geometry: { type: "Polygon", coordinates: [ring] } });
}
fs.writeFileSync(path.join(__dirname, "aisp.geojson"), JSON.stringify({ type: "FeatureCollection", features: feats }));
console.log("aisp.geojson:", feats.length, "polígonos");

const p = db.prepare("SELECT sum(tiroteios_prox>0) comtiro, max(tiroteios_prox) maxtiro, avg(taxa_assalto) taxa FROM anuncios WHERE is_primary=1").get();
console.log(`\nPrimários: ${p.comtiro} c/ tiroteio <500m (máx ${p.maxtiro}), taxa assalto média ${Math.round(p.taxa||0)}/100mil`);
db.close();
