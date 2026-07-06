// Coletor QuintoAndar -> SQLite (via ld+json @type Apartment/House).
// Traz RUA exata de brinde. Uso: node coleta_qa.js [--dry]
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const DRY = process.argv.includes("--dry");
const ID_OFFSET = 2_000_000_000_000; // namespace QA

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (b, s) => sleep(b + Math.floor(Math.random() * s));

// slug do QA = <bairro>-rio-de-janeiro-rj-brasil
const BAIRROS = ["meier","todos-os-santos","cachambi","engenho-novo","del-castilho","piedade",
  "engenho-de-dentro","agua-santa","vila-da-penha","vista-alegre","tijuca","maracana","vila-isabel","grajau"];

async function getHtml(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 200) return { ok: true, html: await r.text() };
      if (r.status === 403 || r.status === 429) { await sleep(12000 + a * 12000); continue; }
      return { ok: false, status: r.status };
    } catch (e) { await sleep(4000); }
  }
  return { ok: false, status: 403 };
}

function parseLd(html) {
  const lds = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  const out = [];
  for (const l of lds) {
    let o; try { o = JSON.parse(l[1]); } catch (e) { continue; }
    if (!/Apartment|House/.test(o["@type"] || "")) continue;
    const idm = (o.url || "").match(/imovel\/(\d+)/);
    if (!idm) continue;
    out.push({
      id: +idm[1], titulo: o.name, url: o.url,
      rua: o.address, descricao: o.description,
      m2: o.floorSize || null, quartos: o.numberOfBedrooms != null ? "" + o.numberOfBedrooms : "",
      banheiros: o.numberOfFullBathrooms || null,
      aluguel: (o.potentialAction && o.potentialAction.price) || null,
      cat: o["@type"] === "House" ? "Casas" : "Apartamentos",
    });
  }
  return out;
}

(async () => {
  const db = DRY ? null : new DatabaseSync(path.join(__dirname, "aluguel.db"));
  let ins;
  if (db) {
    const cols = "list_id,fonte,coletado_em,bairro,bairro_alvo,categoria,titulo,url,aluguel,total,contas_est,custo_vida,m2,quartos,banheiros,rua,descricao,completude".split(",");
    ins = db.prepare(`INSERT INTO anuncios (${cols.join(",")}) VALUES (${cols.map(c => "@" + c).join(",")})
      ON CONFLICT(list_id) DO UPDATE SET coletado_em=@coletado_em, aluguel=@aluguel, total=@total, custo_vida=@custo_vida, rua=@rua`);
  }
  const seen = new Set(); let grand = 0; const resumo = [];
  for (const slug of BAIRROS) {
    const url = `https://www.quintoandar.com.br/alugar/imovel/${slug}-rio-de-janeiro-rj-brasil/casa-apartamento`;
    const res = await getHtml(url);
    if (!res.ok) { resumo.push(`${slug}: HTTP ${res.status}`); console.log(resumo.at(-1)); await jitter(3000, 3000); continue; }
    const ads = parseLd(res.html);
    let novos = 0;
    for (const a of ads) {
      if (seen.has(a.id)) continue; seen.add(a.id); novos++;
      if (db) {
        const contas = a.cat === "Casas" ? 300 : 220;
        const total = a.aluguel;                       // QA: preço já é aluguel (all-in aprox)
        const key = [a.m2, a.quartos, a.banheiros, a.rua, a.descricao].filter(Boolean).length;
        try {
          ins.run({ list_id: ID_OFFSET + a.id, fonte: "QA", coletado_em: new Date().toISOString(),
            bairro: (a.rua || "").split(",")[1]?.trim() || slug, bairro_alvo: slug, categoria: a.cat,
            titulo: (a.titulo || "").slice(0, 120), url: a.url, aluguel: a.aluguel, total,
            contas_est: contas, custo_vida: total == null ? null : total + contas,
            m2: a.m2, quartos: a.quartos, banheiros: a.banheiros, rua: a.rua,
            descricao: (a.descricao || "").slice(0, 500), completude: key });
        } catch (e) {}
      }
    }
    grand += novos;
    resumo.push(`${slug.padEnd(20)} ${novos} anúncios`); console.log(resumo.at(-1));
    await jitter(2500, 2500);
  }
  console.log("\n=== RESUMO QA ===\n" + resumo.join("\n") + `\nTOTAL ${grand}${DRY ? " (DRY)" : ""}`);
  if (db) db.close();
})();
