// Coletor OLX -> SQLite. Guarda TUDO (filtros ficam no SQL).
// Uso: node coleta_olx.js [--dry] [--pages=N]
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DRY = process.argv.includes("--dry");
const PAGES = (() => { const a = process.argv.find(x => x.startsWith("--pages=")); return a ? +a.split("=")[1] : 4; })();
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24"',
  "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1", "upgrade-insecure-requests": "1",
  "Referer": "https://www.olx.com.br/imoveis/aluguel/estado-rj/rio-de-janeiro-e-regiao",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (base, spread) => sleep(base + Math.floor(Math.random() * spread));

// fetch com backoff-and-retry no 403/429
async function getHtml(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 200) return { ok: true, html: await r.text() };
      if (r.status === 403 || r.status === 429) {
        const wait = 12000 + attempt * 15000 + Math.floor(Math.random() * 8000);
        console.log(`  ${r.status} em ${url.split("/").slice(-1)[0]} -> espera ${Math.round(wait/1000)}s (tent ${attempt+1}/3)`);
        await sleep(wait); continue;
      }
      return { ok: false, status: r.status };
    } catch (e) { await sleep(5000); }
  }
  return { ok: false, status: 403 };
}

// bairro-alvo: [slug, regiao-olx]
const BAIRROS = [
  ["meier", "zona-norte"], ["todos-os-santos", "zona-norte"], ["cachambi", "zona-norte"],
  ["engenho-novo", "zona-norte"], ["del-castilho", "zona-norte"], ["piedade", "zona-norte"],
  ["engenho-de-dentro", "zona-norte"], ["agua-santa", "zona-norte"],
  ["vila-da-penha", "zona-norte"], ["vista-alegre", "zona-norte"],
  ["tijuca", "grande-tijuca"], ["maracana", "grande-tijuca"],
  ["vila-isabel", "grande-tijuca"], ["grajau", "grande-tijuca"],
];

const money = s => { if (s == null) return null; const m = ("" + s).replace(/\./g, "").match(/(\d+)/); return m ? +m[1] : null; };
const sizeN = s => { if (!s) return null; const m = ("" + s).match(/(\d+)/); return m ? +m[1] : null; };
const prop = (a, n) => { const p = (a.properties || []).find(x => x.name === n); return p ? p.value : ""; };

function extractAds(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m, rsc = "";
  while ((m = re.exec(html))) { try { rsc += JSON.parse('"' + m[1] + '"'); } catch (e) {} }
  const k = rsc.indexOf('"ads":[');
  if (k < 0) return [];
  let s = rsc.indexOf("[", k), i = s, depth = 0, inStr = false;
  for (; i < rsc.length; i++) {
    const c = rsc[i];
    if (inStr) { if (c === "\\") { i++; continue; } if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "[") depth++; else if (c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  try { return JSON.parse(rsc.slice(s, i)).filter(a => a && a.listId); } catch (e) { return []; }
}

function row(a, slug) {
  const aluguel = money(a.priceValue);
  const cond = money(prop(a, "condominio"));
  const iptu = money(prop(a, "iptu"));
  const total = [aluguel, cond, iptu].some(x => x != null) ? (aluguel || 0) + (cond || 0) + (iptu || 0) : null;
  const cat = a.categoryName || "";
  const contas = /casa/i.test(cat) ? 300 : 220;
  const rf = prop(a, "re_features"), rcf = prop(a, "re_complex_features");
  const old = money(a.oldPrice);
  const m2 = sizeN(prop(a, "size"));
  const key = [cond, iptu, m2, a.imageCount, /animais/i.test(rcf) ? 1 : 0, rf ? 1 : 0];
  return {
    list_id: a.listId, fonte: "OLX", coletado_em: new Date().toISOString(),
    bairro: (a.locationDetails && a.locationDetails.neighbourhood) || (a.location || "").replace("Rio de Janeiro, ", ""),
    bairro_alvo: slug, categoria: cat, tipo: prop(a, "real_estate_type"),
    titulo: (a.subject || "").slice(0, 120), url: a.url,
    aluguel, condominio: cond, iptu, total, contas_est: contas,
    custo_vida: total == null ? null : total + contas,
    old_price: old, baixou_preco: old && aluguel && old > aluguel ? 1 : 0,
    m2, quartos: prop(a, "rooms"), banheiros: money(prop(a, "bathrooms")), vagas: money(prop(a, "garage_spaces")),
    n_fotos: a.imageCount != null ? a.imageCount : (a.images || []).length,
    pet: /animais/i.test(rcf) ? 1 : null,
    area_servico: /área de serviço/i.test(rf) ? 1 : (rf ? 0 : null),
    re_features: rf, re_complex_features: rcf,
    completude: key.filter(Boolean).length,
  };
}

(async () => {
  const db = DRY ? null : new DatabaseSync(path.join(__dirname, "aluguel.db"));
  let ins;
  if (db) {
    const cols = "list_id,fonte,coletado_em,bairro,bairro_alvo,categoria,tipo,titulo,url,aluguel,condominio,iptu,total,contas_est,custo_vida,old_price,baixou_preco,m2,quartos,banheiros,vagas,n_fotos,pet,area_servico,re_features,re_complex_features,completude".split(",");
    ins = db.prepare(`INSERT INTO anuncios (${cols.join(",")}) VALUES (${cols.map(c => "@" + c).join(",")})
      ON CONFLICT(list_id) DO UPDATE SET coletado_em=@coletado_em, aluguel=@aluguel, condominio=@condominio, iptu=@iptu, total=@total, custo_vida=@custo_vida, old_price=@old_price, baixou_preco=@baixou_preco, n_fotos=@n_fotos, pet=@pet, area_servico=@area_servico, completude=@completude`);
  }
  const seen = new Set();
  let grand = 0;
  const resumo = [];
  for (const [slug, regiao] of BAIRROS) {
    let bairroCount = 0;
    for (let pg = 1; pg <= PAGES; pg++) {
      const url = `https://www.olx.com.br/imoveis/aluguel/estado-rj/rio-de-janeiro-e-regiao/${regiao}/${slug}` + (pg > 1 ? `?o=${pg}` : "");
      const res = await getHtml(url);
      if (!res.ok) { if (pg === 1) resumo.push(`${slug}: HTTP ${res.status}`); break; }
      const ads = extractAds(res.html);
      if (!ads.length) break;
      let novos = 0;
      for (const a of ads) {
        if (seen.has(a.listId)) continue; seen.add(a.listId); novos++;
        if (db) { try { ins.run(row(a, slug)); } catch (e) {} }
      }
      bairroCount += novos;
      if (novos === 0) break;      // página só repetiu -> fim
      await jitter(2500, 2000);     // 2.5-4.5s entre páginas
    }
    grand += bairroCount;
    resumo.push(`${slug.padEnd(20)} ${bairroCount} anúncios`);
    console.log(resumo[resumo.length - 1]);
    await jitter(3000, 3000);       // 3-6s entre bairros
    if (!DRY) { try { require("node:fs").writeFileSync(path.join(__dirname, "coleta_progress.txt"), resumo.join("\n") + `\nTOTAL ${grand}`); } catch(e){} }
  }
  console.log("\n=== RESUMO ===\n" + resumo.join("\n"));
  console.log(`\nTOTAL únicos: ${grand}${DRY ? " (DRY, nada inserido)" : " inseridos/atualizados"}`);
  if (db) db.close();
})();
