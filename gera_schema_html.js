// Gera schema.html = dicionário de dados visual do banco (tabela anuncios + views).
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

const total = db.prepare("SELECT count(*) c FROM anuncios").get().c;
// fill % por coluna (não-nulo e não-vazio)
const info = db.prepare("PRAGMA table_info(anuncios)").all();
const fill = {};
for (const c of info) {
  const q = `SELECT count(*) c FROM anuncios WHERE "${c.name}" IS NOT NULL AND "${c.name}" != ''`;
  fill[c.name] = Math.round(100 * db.prepare(q).get().c / total);
}

// meta: grupo + descrição por coluna
const M = {
  list_id: ["id", "🔑 PK. Namespace por fonte: OLX<2e9, QA 2e12+, CNM 3e12+, ZAP 4e12+, VR 5e12+"],
  fonte: ["id", "OLX / ZAP / VR / QA / CNM"],
  coletado_em: ["id", "timestamp ISO da coleta"],
  url: ["id", "link do anúncio original"],
  titulo: ["id", "título do anúncio"],
  bairro: ["loc", "bairro real do imóvel"],
  bairro_alvo: ["loc", "slug do bairro pesquisado (pode diferir do real = bleed da busca)"],
  bairro_classe: ["loc", "verde / amarelo / vermelho / fora (por bairro real)"],
  rua: ["loc", "logradouro (+nº quando tem)"],
  cep: ["loc", "CEP"],
  lat: ["loc", "latitude"],
  lon: ["loc", "longitude"],
  morro: ["loc", "favela (SABREN) ou '-' fora ou '?…' sem geo"],
  aluguel: ["preco", "aluguel base"],
  condominio: ["preco", "condomínio"],
  iptu: ["preco", "IPTU mensal"],
  total: ["preco", "aluguel+cond+iptu (corte ≤2200)"],
  contas_est: ["preco", "estimativa energia+água+gás (~220 ap / 300 casa)"],
  custo_vida: ["preco", "total + contas_est (usado no ranking)"],
  old_price: ["preco", "preço anterior"],
  baixou_preco: ["preco", "1 se baixou de preço (barganha)"],
  categoria: ["fis", "Apartamentos / Casas / Aluguel de quartos…"],
  tipo: ["fis", "unitType (APARTMENT, OFFICE…) — filtro comercial usa isto"],
  m2: ["fis", "área útil (corte ≤25, cap >1000=inválido)"],
  quartos: ["fis", "nº de quartos"],
  banheiros: ["fis", "nº de banheiros"],
  vagas: ["fis", "vagas de garagem"],
  pet: ["amen", "🐾 1 permitido · 0 proibido · null desconhecido"],
  area_servico: ["amen", "🧺 1 tem área de serviço"],
  re_features: ["amen", "features do imóvel (texto)"],
  re_complex_features: ["amen", "features do condomínio / prédio"],
  n_fotos: ["amen", "nº de fotos (corte ≥1)"],
  thumb: ["amen", "URL da imagem de capa"],
  descricao: ["amen", "descrição textual (fonte p/ minerar features)"],
  cozinha_score: ["spec", "⏳ cozinha equipada (0–3) — A COMPUTAR"],
  comodo_extra: ["spec", "⏳ tem escritório/cômodo extra — A COMPUTAR"],
  mobiliado: ["spec", "⏳ mobiliado — A COMPUTAR"],
  dup_group: ["dup", "id do grupo de duplicatas (mesmo imóvel)"],
  is_primary: ["dup", "1 = registro representante do grupo"],
  dup_n: ["dup", "quantos anúncios no grupo"],
  dup_fontes: ["dup", "fontes que anunciam o mesmo imóvel (ex OLX+VR)"],
  fontes_dado: ["dup", "fontes de onde vieram os campos consolidados"],
  completude: ["dup", "nº de campos-chave preenchidos"],
  nota_final: ["score", "⭐ nota 0–100 do ranking"],
};
const GROUPS = {
  id: ["🔑 Identidade", "#3498db"], loc: ["📍 Localização", "#2ecc71"], preco: ["💰 Preço", "#f1c40f"],
  fis: ["📐 Físico", "#9b59b6"], amen: ["🏠 Amenidades / mídia", "#1abc9c"], spec: ["🍳 Features do spec (a computar)", "#e67e22"],
  dup: ["🔗 Dedup / consolidação", "#e74c3c"], score: ["⭐ Score", "#f39c12"],
};

const views = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name").all();
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all();
const typeOf = n => info.find(c => c.name === n).type;
const isPK = n => info.find(c => c.name === n).pk === 1;

function bar(pct) {
  const col = pct >= 80 ? "#2ecc71" : pct >= 40 ? "#f1c40f" : pct >= 1 ? "#e67e22" : "#e74c3c";
  return `<div class="bar"><div style="width:${pct}%;background:${col}"></div></div><span class="pct">${pct}%</span>`;
}

let rowsHtml = "";
for (const g of Object.keys(GROUPS)) {
  const cols = Object.keys(M).filter(k => M[k][0] === g);
  if (!cols.length) continue;
  const [label, color] = GROUPS[g];
  rowsHtml += `<div class="group"><h2 style="border-color:${color}">${label} <span class="gn">${cols.length} col</span></h2><table>`;
  rowsHtml += `<tr><th>coluna</th><th>tipo</th><th>descrição</th><th style="width:150px">preenchido</th></tr>`;
  for (const c of cols) {
    rowsHtml += `<tr><td><code>${c}</code>${isPK(c) ? ' <span class="pk">PK</span>' : ''}</td><td class="ty">${typeOf(c)}</td><td>${M[c][1]}</td><td class="fillcell">${bar(fill[c])}</td></tr>`;
  }
  rowsHtml += `</table></div>`;
}

const viewsHtml = views.map(v => {
  const cnt = (() => { try { return db.prepare(`SELECT count(*) c FROM "${v.name}"`).get().c; } catch (e) { return "?"; } })();
  const where = (v.sql.split(/\bWHERE\b/i)[1] || "").replace(/</g, "&lt;").trim();
  return `<div class="view"><h3><code>${v.name}</code> <span class="vn">${cnt} linhas</span></h3><pre>WHERE ${where}</pre></div>`;
}).join("");

const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Schema do banco — Aluguel RJ</title><style>
:root{--bg:#0f1115;--card:#1a1d24;--txt:#e6e6e6;--mut:#9aa0aa;--line:#262a33}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 system-ui,sans-serif;padding:24px;max-width:1150px;margin:0 auto}
h1{font-size:24px;margin:0 0 2px}.sub{color:var(--mut);margin-bottom:20px}
.group{background:var(--card);border-radius:10px;padding:4px 18px 14px;margin-bottom:14px}
.group h2{font-size:16px;border-left:4px solid;padding-left:10px;margin:14px 0 8px}.gn{color:var(--mut);font-size:12px;font-weight:400}
table{width:100%;border-collapse:collapse}
th{text-align:left;color:var(--mut);font-size:11px;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid var(--line)}
td{padding:6px 8px;border-bottom:1px solid #20242d;vertical-align:middle}
code{background:#20242d;padding:2px 6px;border-radius:5px;font-size:12px;color:#9ecbff}
.ty{color:var(--mut);font-size:11px}.pk{background:#3498db;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;vertical-align:middle}
.fillcell{display:flex;align-items:center;gap:8px}.bar{flex:1;height:8px;background:#20242d;border-radius:4px;overflow:hidden}.bar div{height:100%}.pct{font-size:11px;color:var(--mut);width:34px;text-align:right}
.view{background:var(--card);border-radius:10px;padding:12px 18px;margin-bottom:10px}
.view h3{margin:0 0 6px;font-size:15px}.vn{color:var(--mut);font-size:12px;font-weight:400}
pre{background:#12141a;padding:10px 12px;border-radius:6px;overflow-x:auto;font-size:12px;color:#c8d0da;margin:0;white-space:pre-wrap}
.hdr{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:20px;color:var(--mut);font-size:13px}
.hdr b{color:var(--txt)}
</style></head><body>
<h1>🗄️ Schema do banco — <code>aluguel.db</code></h1>
<div class="sub">SQLite · dicionário de dados. Barras = % preenchido nas ${total} linhas.</div>
<div class="hdr"><span><b>1 tabela:</b> anuncios (${info.length} colunas)</span><span><b>4 views</b></span><span><b>2 índices:</b> ${idx.map(i => i.name).join(", ")}</span><span><b>${total}</b> anúncios → <b>1.665</b> únicos</span></div>
<h2 style="font-size:18px">📋 Tabela <code>anuncios</code></h2>
${rowsHtml}
<h2 style="font-size:18px;margin-top:24px">👁️ Views (o filtro vive aqui — SELECT sobre a tabela)</h2>
${viewsHtml}
</body></html>`;

require("fs").writeFileSync(path.join(__dirname, "schema.html"), html);
console.log("schema.html gerado:", info.length, "colunas,", views.length, "views");
db.close();
