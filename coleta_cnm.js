// Coletor ChavesNaMão -> SQLite (via array RSC "itemsForTracking").
// Uso: node coleta_cnm.js [--dry]
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const DRY = process.argv.includes("--dry");
const ID_OFFSET = 3_000_000_000_000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "pt-BR,pt;q=0.9",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (b, s) => sleep(b + Math.floor(Math.random() * s));
const BAIRROS = ["meier","todos-os-santos","cachambi","engenho-novo","del-castilho","piedade",
  "engenho-de-dentro","agua-santa","vila-da-penha","vista-alegre","tijuca","maracana","vila-isabel","grajau"];

async function getHtml(url) {
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { headers: HEADERS });
      if (r.status === 200) return { ok: true, html: await r.text() };
      if (r.status === 403 || r.status === 429) { await sleep(10000 + a * 12000); continue; }
      return { ok: false, status: r.status };
    } catch (e) { await sleep(4000); }
  }
  return { ok: false, status: 403 };
}
function rscOf(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m, r = ""; while ((m = re.exec(html))) { try { r += JSON.parse('"' + m[1] + '"'); } catch (e) {} }
  return r;
}
function extractArray(txt, key) {
  const k = txt.indexOf('"' + key + '":['); if (k < 0) return null;
  let s = txt.indexOf("[", k), i = s, d = 0, q = false;
  for (; i < txt.length; i++) { const c = txt[i]; if (q) { if (c === "\\") { i++; continue; } if (c === '"') q = false; continue; } if (c === '"') q = true; else if (c === "[") d++; else if (c === "]") { d--; if (d === 0) { i++; break; } } }
  try { return JSON.parse(txt.slice(s, i)); } catch (e) { return null; }
}
const ruaDe = t => { const m = (t || "").match(/na ((?:Rua|Avenida|Av\.?|Estrada|Travessa|Praça|Alameda)[^,]+)/i); return m ? m[1].trim() : null; };
const m2De = (t, u) => { let m = (t || "").match(/(\d+)\s*m²/) || (u || "").match(/-(\d+)m2/); return m ? +m[1] : null; };
const qDe = t => { const m = (t || "").match(/(\d+)\s*quartos?/i); return m ? m[1] : ""; };

(async () => {
  const db = DRY ? null : new DatabaseSync(path.join(__dirname, "aluguel.db"));
  let ins;
  if (db) {
    const cols = "list_id,fonte,coletado_em,bairro,bairro_alvo,categoria,titulo,url,aluguel,total,contas_est,custo_vida,m2,quartos,rua,completude".split(",");
    ins = db.prepare(`INSERT INTO anuncios (${cols.join(",")}) VALUES (${cols.map(c => "@" + c).join(",")})
      ON CONFLICT(list_id) DO UPDATE SET coletado_em=@coletado_em, aluguel=@aluguel, total=@total, custo_vida=@custo_vida, rua=@rua`);
  }
  const seen = new Set(); let grand = 0; const resumo = [];
  for (const slug of BAIRROS) {
    const url = `https://www.chavesnamao.com.br/imoveis-para-alugar/rj-rio-de-janeiro/${slug}/`;
    const res = await getHtml(url);
    if (!res.ok) { resumo.push(`${slug}: HTTP ${res.status}`); console.log(resumo.at(-1)); await jitter(2500, 2500); continue; }
    const items = extractArray(rscOf(res.html), "itemsForTracking") || [];
    let novos = 0;
    for (const a of items) {
      const rt = (a.realtyType && a.realtyType.name) || "";
      if (a.transaction !== "RENT") continue;
      if (!/apart|casa|kitnet|studio|cobertura/i.test(rt)) continue;   // fora prédio/comercial/terreno
      if (!a.id || seen.has(a.id)) continue; seen.add(a.id); novos++;
      if (db) {
        const aluguel = (a.prices && a.prices.rawPrice) || null;
        const contas = /casa/i.test(rt) ? 300 : 220;
        const rua = ruaDe(a.title), m2 = m2De(a.title, a.url);
        const key = [m2, rua, aluguel, a.title].filter(Boolean).length;
        try {
          ins.run({ list_id: ID_OFFSET + Number(a.id), fonte: "CNM", coletado_em: new Date().toISOString(),
            bairro: (a.location && a.location.neighborhoodName) || slug, bairro_alvo: slug, categoria: rt,
            titulo: (a.title || "").slice(0, 120), url: a.url && a.url.startsWith("http") ? a.url : "https://www.chavesnamao.com.br" + a.url,
            aluguel, total: aluguel, contas_est: contas, custo_vida: aluguel == null ? null : aluguel + contas,
            m2, quartos: qDe(a.title), rua, completude: key });
        } catch (e) {}
      }
    }
    grand += novos; resumo.push(`${slug.padEnd(20)} ${novos} anúncios`); console.log(resumo.at(-1));
    await jitter(2500, 2500);
  }
  console.log("\n=== RESUMO CNM ===\n" + resumo.join("\n") + `\nTOTAL ${grand}${DRY ? " (DRY)" : ""}`);
  if (db) db.close();
})();
