// Camada ASSALTO/MORTALIDADE (ISP-RJ) por AISP → cruza com imóveis via point-in-polygon.
// Independente do Fogo Cruzado (que é TIROTEIO, camada à parte).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const TMP = "/home/argo/.claude/jobs/075c12f9/tmp/";
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));
for (const c of ["aisp INTEGER", "assalto_aisp INTEGER", "letalidade_aisp INTEGER"]) { try { db.exec("ALTER TABLE anuncios ADD COLUMN " + c); } catch (e) {} }

// 1) agrega ISP CSV -> por AISP (2024-2025)
const lines = fs.readFileSync(TMP + "isp_cisp.csv", "utf8").split(/\r?\n/).filter(Boolean);
const H = {}; lines[0].split(";").forEach((h, i) => H[h.trim()] = i);
const num = v => v == null || v === "" ? 0 : (+("" + v).replace(",", ".") || 0);
const byAisp = {};
for (let i = 1; i < lines.length; i++) {
  const r = lines[i].split(";");
  if (+r[H.ano] < 2024) continue;
  const a = r[H.aisp];
  const o = byAisp[a] || (byAisp[a] = { transeunte: 0, letalidade: 0 });
  o.transeunte += num(r[H.roubo_transeunte]);
  o.letalidade += num(r[H.letalidade_violenta]);
}

// 2) parseia KML -> polígonos por AISP
const kml = fs.readFileSync(TMP + "doc.kml", "utf8");
const placemarks = kml.split("<Placemark").slice(1);
const aispPolys = {}; // aisp -> [ [ [lon,lat],... ], ... ]
for (const pm of placemarks) {
  const nm = (pm.match(/<name>\s*(\d+)\s*<\/name>/) || [])[1];
  if (!nm) continue;
  const coordBlocks = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/g) || [];
  for (const cb of coordBlocks) {
    const ring = cb.replace(/<\/?coordinates>/g, "").trim().split(/\s+/).map(t => {
      const p = t.split(","); return [parseFloat(p[0]), parseFloat(p[1])];
    }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
    if (ring.length > 3) (aispPolys[nm] || (aispPolys[nm] = [])).push(ring);
  }
}
// bbox por AISP p/ acelerar
const feats = Object.entries(aispPolys).map(([aisp, polys]) => {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const r of polys) for (const [x, y] of r) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  return { aisp, polys, bb: [minx, miny, maxx, maxy] };
});
console.log("AISPs no KML:", feats.length, "| AISPs c/ dado ISP:", Object.keys(byAisp).length);

function pip(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function findAisp(lon, lat) {
  for (const f of feats) {
    const [minx, miny, maxx, maxy] = f.bb;
    if (lon < minx || lon > maxx || lat < miny || lat > maxy) continue;
    for (const r of f.polys) if (pip(lon, lat, r)) return f.aisp;
  }
  return null;
}

// 3) cruza com imóveis
const rows = db.prepare("SELECT list_id, lat, lon FROM anuncios WHERE lat IS NOT NULL AND lon IS NOT NULL").all();
const upd = db.prepare("UPDATE anuncios SET aisp=@a, assalto_aisp=@t, letalidade_aisp=@l WHERE list_id=@id");
db.exec("BEGIN");
let hit = 0;
for (const r of rows) {
  const a = findAisp(r.lon, r.lat);
  if (a == null) continue;
  const d = byAisp[a] || { transeunte: null, letalidade: null };
  upd.run({ a: +a, t: d.transeunte, l: d.letalidade, id: r.list_id });
  hit++;
}
db.exec("COMMIT");
console.log(`Imóveis mapeados p/ AISP: ${hit}/${rows.length}`);
// distribuição nos primários
const dist = db.prepare("SELECT aisp, max(assalto_aisp) assalto, max(letalidade_aisp) let, count(*) n FROM anuncios WHERE is_primary=1 AND aisp IS NOT NULL GROUP BY aisp ORDER BY assalto DESC").all();
console.log("\n=== assalto/letalidade por AISP (primários) — pior p/ melhor ===");
for (const d of dist.slice(0, 10)) console.log(`  AISP ${String(d.aisp).padStart(2)}: ${d.assalto} assaltos · ${d.let} mortes · ${d.n} imóveis`);
db.close();
