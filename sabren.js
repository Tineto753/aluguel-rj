// SABREN: marca morro por point-in-polygon (favelas.json) nos anúncios com coordenadas.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

const FAV = process.env.FAV || "/home/argo/favelas.json";
const fav = JSON.parse(fs.readFileSync(FAV, "utf8"));
const nomeDe = p => p ? (p.nome || p.Nome || p.NOME || p.nm_fav || "favela") : "favela";

function pip(pt, poly) {
  let [x, y] = pt, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// bbox por feature p/ acelerar
const feats = fav.features.map(f => {
  const g = f.geometry; if (!g) return null;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of polys) for (const [x, y] of p[0]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  return { nome: nomeDe(f.properties), polys, bb: [minx, miny, maxx, maxy] };
}).filter(Boolean);

function inFavela(lon, lat) {
  for (const f of feats) {
    const [minx, miny, maxx, maxy] = f.bb;
    if (lon < minx || lon > maxx || lat < miny || lat > maxy) continue;
    for (const p of f.polys) if (pip([lon, lat], p[0])) return f.nome;
  }
  return null;
}

const rows = db.prepare("SELECT list_id, lat, lon FROM anuncios WHERE lat IS NOT NULL AND lon IS NOT NULL").all();
const upd = db.prepare("UPDATE anuncios SET morro=@m WHERE list_id=@id");
let dentro = 0, fora = 0;
db.exec("BEGIN");
for (const r of rows) {
  const f = inFavela(r.lon, r.lat);
  upd.run({ m: f || "-", id: r.list_id });
  if (f) dentro++; else fora++;
}
db.exec("COMMIT");

console.log(`Favelas carregadas:   ${feats.length}`);
console.log(`Anúncios c/ coord:    ${rows.length}`);
console.log(`  DENTRO de favela:   ${dentro}  (marcados, serão cortados)`);
console.log(`  fora (ok):          ${fora}`);
const p = db.prepare("SELECT sum(morro IS NOT NULL AND morro!='-') dentro, sum(morro='-') fora FROM anuncios WHERE is_primary=1").get();
console.log(`\nPrimários: ${p.dentro} em favela, ${p.fora} confirmados fora`);
console.log(`Candidatos únicos (view): ${db.prepare("SELECT count(*) c FROM candidatos_unicos").get().c}`);
db.close();
