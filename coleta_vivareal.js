// Coletor ZAP Imóveis -> SQLite. A fonte mais rica: coords + preço quebrado + rua/nº + amenities.
// Uso: node coleta_zap.js [--dry] [--pages=N]
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const DRY = process.argv.includes("--dry");
const PAGES = (() => { const a = process.argv.find(x => x.startsWith("--pages=")); return a ? +a.split("=")[1] : 3; })();
const ID_OFFSET = 5_000_000_000_000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
  "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (b, s) => sleep(b + Math.floor(Math.random() * s));

const BAIRROS = [
  ["meier", "zona-norte"], ["todos-os-santos", "zona-norte"], ["cachambi", "zona-norte"],
  ["engenho-novo", "zona-norte"], ["del-castilho", "zona-norte"], ["piedade", "zona-norte"],
  ["engenho-de-dentro", "zona-norte"], ["agua-santa", "zona-norte"],
  ["vila-da-penha", "zona-norte"], ["vista-alegre", "zona-norte"],
  ["tijuca", "zona-norte"], ["maracana", "zona-norte"], ["vila-isabel", "zona-norte"], ["grajau", "zona-norte"],
];

async function getHtml(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 200) return { ok: true, html: await r.text() };
      if (r.status === 403 || r.status === 429) { await sleep(12000 + a * 15000 + Math.random() * 6000); continue; }
      return { ok: false, status: r.status };
    } catch (e) { await sleep(5000); }
  }
  return { ok: false, status: 403 };
}
function rscOf(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m, rsc = ""; while ((m = re.exec(html))) { try { rsc += JSON.parse('"' + m[1] + '"'); } catch (e) {} }
  return rsc;
}
function extractArray(txt, key) {
  const k = txt.indexOf('"' + key + '":['); if (k < 0) return null;
  let s = txt.indexOf("[", k), i = s, d = 0, q = false;
  for (; i < txt.length; i++) { const c = txt[i]; if (q) { if (c === "\\") { i++; continue; } if (c === '"') q = false; continue; } if (c === '"') q = true; else if (c === "[") d++; else if (c === "]") { d--; if (d === 0) { i++; break; } } }
  try { return JSON.parse(txt.slice(s, i)); } catch (e) { return null; }
}
const first = a => Array.isArray(a) ? a[0] : (a == null ? null : a);

function row(a, slug) {
  const pr = (a.prices && a.prices.rental) || {};
  const am = a.amenities || {};
  const ad = a.address || {};
  const aluguel = pr.value || null, cond = pr.condominium != null ? pr.condominium : null, iptu = pr.iptu != null ? pr.iptu : null;
  const total = aluguel != null ? aluguel + (cond || 0) + (iptu || 0) : null;
  const cat = /HOME|HOUSE/i.test(a.unitType || "") ? "Casas" : "Apartamentos";
  const contas = cat === "Casas" ? 300 : 220;
  const vals = am.values || [];
  const nfotos = (a.medias && a.medias.images || []).length;
  const m2 = first(am.usableAreas), quartos = first(am.bedrooms), ban = first(am.bathrooms), vagas = first(am.parkingSpaces);
  const rua = ad.street ? (ad.street + (ad.streetNumber ? " " + ad.streetNumber : "")) : null;
  const co = ad.coordinates || {};
  const adv = a.advertiser || {};
  const key = [cond != null, iptu != null, m2, nfotos, rua, a.description].filter(Boolean).length;
  return {
    list_id: ID_OFFSET + Number(a.id), fonte: "VR", coletado_em: new Date().toISOString(),
    bairro: ad.neighborhood || slug, bairro_alvo: slug, categoria: cat, tipo: a.unitType || "",
    titulo: (a.title || "").slice(0, 120), url: a.href,
    aluguel, condominio: cond, iptu, total, contas_est: contas, custo_vida: total == null ? null : total + contas,
    m2: m2 || null, quartos: quartos != null ? "" + quartos : "", banheiros: ban || null, vagas: vagas || null,
    n_fotos: nfotos || null, pet: null,
    area_servico: vals.includes("SERVICE_AREA") ? 1 : (vals.length ? 0 : null),
    re_features: vals.join(", "), re_complex_features: a.condominiumName ? "Prédio: " + a.condominiumName : "",
    rua, lat: co.latitude || null, lon: co.longitude || null,
    coord_aprox: ad.isApproximateLocation ? 1 : 0,
    telefone: (adv.phoneNumbers && adv.phoneNumbers[0]) || null, whatsapp: adv.whatsAppNumber || null,
    anunciante: adv.name || null,
    descricao: (a.description || "").slice(0, 500), completude: key,
  };
}

(async () => {
  const db = DRY ? null : new DatabaseSync(path.join(__dirname, "aluguel.db"));
  let ins;
  if (db) {
    const cols = "list_id,fonte,coletado_em,bairro,bairro_alvo,categoria,tipo,titulo,url,aluguel,condominio,iptu,total,contas_est,custo_vida,m2,quartos,banheiros,vagas,n_fotos,pet,area_servico,re_features,re_complex_features,rua,lat,lon,coord_aprox,telefone,whatsapp,anunciante,descricao,completude".split(",");
    ins = db.prepare(`INSERT INTO anuncios (${cols.join(",")}) VALUES (${cols.map(c => "@" + c).join(",")})
      ON CONFLICT(list_id) DO UPDATE SET coletado_em=@coletado_em, aluguel=@aluguel, condominio=@condominio, iptu=@iptu, total=@total, custo_vida=@custo_vida, lat=@lat, lon=@lon, rua=@rua, coord_aprox=@coord_aprox, telefone=@telefone, whatsapp=@whatsapp, anunciante=@anunciante`);
  }
  const seen = new Set(); let grand = 0; const resumo = [];
  for (const [slug, regiao] of BAIRROS) {
    let bc = 0;
    for (let pg = 1; pg <= PAGES; pg++) {
      const url = `https://www.vivareal.com.br/aluguel/rj/rio-de-janeiro/${regiao}/${slug}/` + (pg > 1 ? `?pagina=${pg}` : "");
      const res = await getHtml(url);
      if (!res.ok) { if (pg === 1) resumo.push(`${slug}: HTTP ${res.status}`); break; }
      const listings = extractArray(rscOf(res.html), "listings");
      if (!listings || !listings.length) break;
      let novos = 0;
      for (const a of listings) {
        if (!a || !a.id || seen.has(a.id)) continue; seen.add(a.id); novos++;
        if (db) { try { ins.run(row(a, slug)); } catch (e) {} }
      }
      bc += novos;
      if (novos === 0) break;
      await jitter(2500, 2500);
    }
    grand += bc; resumo.push(`${slug.padEnd(20)} ${bc} anúncios`); console.log(resumo.at(-1));
    await jitter(3000, 3000);
  }
  console.log("\n=== RESUMO VR ===\n" + resumo.join("\n") + `\nTOTAL ${grand}${DRY ? " (DRY)" : ""}`);
  if (db) db.close();
})();
