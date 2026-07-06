// Frequência de tiroteios (12m) em 2 faixas: ≤300m (fogo direto) e ≤1km (bala perdida).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));
for (const c of ["tiros_300 INTEGER", "tiros_1km INTEGER", "tiros_2km INTEGER"]) { try { db.exec("ALTER TABLE anuncios ADD COLUMN " + c); } catch (e) {} }

const tl = fs.readFileSync(path.join(__dirname, "tiroteios_rj.csv"), "utf8").split(/\r?\n/).filter(Boolean);
const th = {}; tl[0].split(",").forEach((h, i) => th[h.trim()] = i);
const MLAT = 111320, MLON = 111320 * Math.cos(-22.9 * Math.PI / 180);
const tiros = [];
for (let i = 1; i < tl.length; i++) { const r = tl[i].split(","); const la = +r[th.lat], lo = +r[th.lon]; if (!isNaN(la)) tiros.push([lo * MLON, la * MLAT]); }

const rows = db.prepare("SELECT list_id, lat, lon FROM anuncios WHERE lat IS NOT NULL AND lon IS NOT NULL").all();
const upd = db.prepare("UPDATE anuncios SET tiros_300=@a, tiros_1km=@b, tiros_2km=@c WHERE list_id=@id");
db.exec("BEGIN");
for (const r of rows) {
  const x = r.lon * MLON, y = r.lat * MLAT; let a = 0, b = 0, c = 0;
  for (const p of tiros) { const dx = Math.abs(p[0] - x), dy = Math.abs(p[1] - y); if (dx > 2000 || dy > 2000) continue; const d = Math.hypot(dx, dy); if (d <= 300) a++; if (d <= 1000) b++; if (d <= 2000) c++; }
  upd.run({ a, b, c, id: r.list_id });
}
db.exec("COMMIT");
const s = db.prepare("SELECT avg(tiros_300) a3, avg(tiros_1km) a1, avg(tiros_2km) a2, max(tiros_2km) mx, sum(tiros_300=0) zero300, count(*) n FROM anuncios WHERE is_primary=1 AND tiros_1km IS NOT NULL").get();
console.log("Primários com coord:", s.n);
console.log(`≤300m (direto): média ${s.a3.toFixed(1)}/ano · ${s.zero300} casas ZERO`);
console.log(`≤1km (bala perdida): média ${s.a1.toFixed(1)}/ano`);
console.log(`≤2km (reduzido): média ${s.a2.toFixed(1)}/ano · máx ${s.mx}`);
db.close();
