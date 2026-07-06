// Enriquece as linhas do QuintoAndar (página individual __NEXT_DATA__).
// v2: pega TUDO que a API cede — pet(acceptsPets), mobiliado(hasFurniture), metro,
//     amenities→cozinha/comodo, fotos reais, custo real, coords.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));
for (const c of ["thumb TEXT"]) { try { db.exec("ALTER TABLE anuncios ADD COLUMN " + c); } catch (e) {} }

const HEADERS = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txts = arr => Array.isArray(arr) ? arr.map(x => x && (x.text || x.name || x.key || x)).filter(Boolean).join(", ") : "";
const KIT = /cozinha|cooktop|fog[ãa]o|arm[áa]ri|planejad|gourmet|forno|coifa|pia\b/i;
const OFFICE = /escrit[óo]ri|home ?office|depend[êe]ncia|escritorio/i;

function findListing(o, d) {
  if (d > 12 || !o || typeof o !== "object") return null;
  if (("totalCost" in o || "condoPrice" in o) && ("acceptsPets" in o || "area" in o)) return o;
  for (const k of Object.keys(o)) { const r = findListing(o[k], d + 1); if (r) return r; }
  return null;
}

(async () => {
  const rows = db.prepare("SELECT list_id, url, contas_est FROM anuncios WHERE fonte='QA'").all();
  const upd = db.prepare(`UPDATE anuncios SET condominio=@cond, iptu=@iptu, total=@total, custo_vida=@cv,
    pet=@pet, mobiliado=@mob, perto_metro=@metro, lat=@lat, lon=@lon, rua=COALESCE(@rua,rua), cep=COALESCE(@cep,cep),
    re_complex_features=@predio, re_features=@amen, descricao=@desc, thumb=@thumb,
    cozinha_score=@coz, comodo_extra=@extra, m2=COALESCE(@area,m2), completude=@compl WHERE list_id=@id`);
  let ok = 0, pet = 0, mob = 0, coz = 0, i = 0;
  for (const r of rows) {
    i++; let j;
    try {
      const res = await fetch(r.url, { headers: HEADERS });
      if (res.status !== 200) { await sleep(1200); continue; }
      const m = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) { await sleep(1000); continue; }
      j = JSON.parse(m[1]);
    } catch (e) { await sleep(2000); continue; }
    const L = findListing(j, 0);
    if (!L) { await sleep(700); continue; }
    const cond = L.condoPrice ?? null, iptu = L.iptu ?? null;
    const aluguel = L.rentPrice ?? null;
    const total = aluguel != null ? aluguel + (cond || 0) + (iptu || 0) : null;
    const cv = total != null ? total + (r.contas_est || 220) : null;
    const petV = L.acceptsPets === true ? 1 : L.acceptsPets === false ? 0 : null;
    const mobV = L.hasFurniture === true ? 1 : L.hasFurniture === false ? 0 : null;
    const amenTxt = [txts(L.amenities), txts(L.installations), txts(L.comfortCommodities), txts(L.practicalityCommodities), L.remarks || ""].filter(Boolean).join(", ");
    const cozV = ((amenTxt + " " + (L.remarks || "")).match(KIT) ? 1 : 0) + (/cooktop|planejad|gourmet/i.test(amenTxt) ? 1 : 0);
    const extraV = OFFICE.test(amenTxt) ? 1 : 0;
    const predio = L.condominium && L.condominium.name ? "Prédio: " + L.condominium.name : "";
    const ad = L.address || {};
    const ph = (L.photos && L.photos[0] && (L.photos[0].url || L.photos[0])) || null;
    const thumb = ph ? "https://www.quintoandar.com.br/img/med/" + (typeof ph === "string" ? ph : ph.url) : null;
    const compl = [cond != null, iptu != null, L.area, ad.lat, petV != null, mobV != null, amenTxt].filter(Boolean).length + 1;
    upd.run({ cond, iptu, total, cv, pet: petV, mob: mobV, metro: L.isNearSubway ? 1 : 0,
      lat: ad.lat ?? null, lon: ad.lng ?? null, rua: ad.street || null, cep: ad.zipCode || null,
      predio, amen: amenTxt.slice(0, 300), desc: ((L.remarks || "") + " " + amenTxt).slice(0, 500).trim() || null,
      thumb, coz: cozV, extra: extraV, area: L.area || null, compl, id: r.list_id });
    ok++; if (petV === 1) pet++; if (mobV != null) mob++; if (cozV) coz++;
    await sleep(850);
  }
  console.log(`QA v2: ${ok}/${rows.length} | pet=sim:${pet} | mobiliado(def):${mob} | cozinha>0:${coz}`);
  db.close();
})();
