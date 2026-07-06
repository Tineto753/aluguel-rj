// Buffer: distância (m) de cada imóvel à favela mais próxima (borda do polígono).
// A pesquisa mostrou que o PERIGO mora na BORDA — isto pega o que o SABREN (só dentro) não pega.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));
for (const c of ["dist_favela INTEGER", "favela_prox TEXT"]) { try { db.exec("ALTER TABLE anuncios ADD COLUMN " + c); } catch (e) {} }

const fav = JSON.parse(fs.readFileSync(process.env.FAV || "/home/argo/favelas.json", "utf8"));
const nomeDe = p => p ? (p.nome || p.Nome || p.NOME || p.nm_fav || "favela") : "favela";
// projeção local equiretangular (Rio ~ -22.9°): metros
const LAT0 = -22.9, MLAT = 111320, MLON = 111320 * Math.cos(LAT0 * Math.PI / 180);
const px = lon => lon * MLON, py = lat => lat * MLAT;

// pré-computa por favela: segmentos projetados + bbox projetado
const feats = [];
for (const f of fav.features) {
  const g = f.geometry; if (!g) continue;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const segs = []; let minx = 1e18, miny = 1e18, maxx = -1e18, maxy = -1e18;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = px(ring[i][0]), y1 = py(ring[i][1]), x2 = px(ring[i + 1][0]), y2 = py(ring[i + 1][1]);
      segs.push([x1, y1, x2, y2]);
      minx = Math.min(minx, x1, x2); maxx = Math.max(maxx, x1, x2);
      miny = Math.min(miny, y1, y2); maxy = Math.max(maxy, y1, y2);
    }
  }
  feats.push({ nome: nomeDe(f.properties), segs, bb: [minx, miny, maxx, maxy] });
}

function segDist(x, y, s) {
  const [x1, y1, x2, y2] = s, dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(x - cx, y - cy);
}
function bboxDist(x, y, bb) {
  const dx = Math.max(bb[0] - x, 0, x - bb[2]), dy = Math.max(bb[1] - y, 0, y - bb[3]);
  return Math.hypot(dx, dy);
}
const CAP = 2000; // além de 2km não importa

const rows = db.prepare("SELECT list_id, lat, lon, morro FROM anuncios WHERE lat IS NOT NULL AND lon IS NOT NULL").all();
const upd = db.prepare("UPDATE anuncios SET dist_favela=@d, favela_prox=@n WHERE list_id=@id");
db.exec("BEGIN");
const bands = { d0: 0, d150: 0, d400: 0, d800: 0, ok: 0 };
for (const r of rows) {
  if (r.morro && r.morro !== "-" && !r.morro.startsWith("?")) { upd.run({ d: 0, n: r.morro, id: r.list_id }); bands.d0++; continue; }
  const x = px(r.lon), y = py(r.lat);
  let best = CAP, bn = null;
  for (const f of feats) {
    if (bboxDist(x, y, f.bb) > best) continue;
    for (const s of f.segs) { const d = segDist(x, y, s); if (d < best) { best = d; bn = f.nome; } if (best < 5) break; }
  }
  const dist = Math.round(best);
  upd.run({ d: dist, n: dist < CAP ? bn : null, id: r.list_id });
  if (dist < 150) bands.d150++; else if (dist < 400) bands.d400++; else if (dist < 800) bands.d800++; else bands.ok++;
}
db.exec("COMMIT");

console.log("Imóveis c/ coord:", rows.length);
console.log(`  DENTRO favela:      ${bands.d0}`);
console.log(`  🔴 <150m (borda):   ${bands.d150}`);
console.log(`  🟠 150-400m:        ${bands.d400}`);
console.log(`  🟡 400-800m:        ${bands.d800}`);
console.log(`  🟢 >800m (ok):      ${bands.ok}`);
const p = db.prepare("SELECT sum(dist_favela<150) borda, sum(dist_favela>=800) ok FROM anuncios WHERE is_primary=1 AND dist_favela IS NOT NULL").get();
console.log(`\nPrimários: ${p.borda} na borda (<150m), ${p.ok} folgados (>800m)`);
db.close();
