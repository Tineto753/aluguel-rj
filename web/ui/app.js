// Dashboard aluguel RJ — busca da API (Render), login por senha, anotacoes por imovel.
const API = window.API_BASE;
const $ = (id) => document.getElementById(id);
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------- auth ----------
const tokenKey = "aluguel_token";
let TOKEN = localStorage.getItem(tokenKey);

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
      ...(opts.headers || {}),
    },
  });
  if (r.status === 401) { logout(); throw new Error("nao autorizado"); }
  return r;
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginErr").textContent = "";
  try {
    const r = await fetch(API + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("pw").value }),
    });
    if (!r.ok) { $("loginErr").textContent = "senha incorreta"; return; }
    const { token } = await r.json();
    TOKEN = token;
    localStorage.setItem(tokenKey, token);
    boot();
  } catch {
    $("loginErr").textContent = "erro de conexão com a API";
  }
});

function logout() {
  localStorage.removeItem(tokenKey);
  TOKEN = null;
  $("app").hidden = true;
  $("login").style.display = "flex";
  $("pw").value = "";
}

// ---------- dados ----------
let DATA = [];
const VERDE = new Set(["meier", "todos os santos", "vila da penha", "piedade", "vista alegre", "vila isabel", "tijuca", "grajau", "maracana"]);
const AMAR = new Set(["cachambi", "del castilho", "agua santa"]);
const VERM = new Set(["engenho de dentro", "engenho novo", "lins de vasconcelos"]);
const classe = (b) => { b = norm(b); return VERDE.has(b) ? "verde" : AMAR.has(b) ? "amarelo" : VERM.has(b) ? "vermelho" : "fora"; };
const COM = /office|business|commercial|warehouse|deposit|shed|clinic|gallery|store|retail|land|building|floor/;
const isCom = (d) => COM.test(norm(d.tipo)) || /comerc|loja|sala|galp/.test(norm(d.categoria));
const isQuarto = (d) => /quarto/.test(norm(d.categoria));
const isFav = (d) => d.morro && d.morro !== "-" && !String(d.morro).startsWith("?");
const HOJE = new Date(), LIM = new Date(HOJE - 3 * 864e5).toISOString().slice(0, 10);
const isNovo = (d) => d.primeiro_visto && d.primeiro_visto >= LIM;
function mapLink(d) {
  if (d.lat && d.lon) return "https://www.google.com/maps/search/?api=1&query=" + d.lat + "," + d.lon;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((d.rua ? d.rua + ", " : "") + (d.bairro || "") + ", Rio de Janeiro");
}

const DEF = { pet: "ok", nocom: true, noquarto: true, nofav: true, viz: false, maxcv: 2500, minm2: 25, mindist: 150, maxtiros: "", fas: false, fmob: false, fbx: false, fzap: false, fnovo: false, ffav: false, fstatus: "", sort: "nota" };
const bairroSel = new Set();
const ORD = { verde: 0, amarelo: 1, vermelho: 2, fora: 3 };

function resetF() {
  for (const k in DEF) { const el = $(k); if (!el) continue; if (el.type === "checkbox") el.checked = DEF[k]; else el.value = DEF[k]; }
  $("q").value = ""; bairroSel.clear();
  for (const c of $("bairros").querySelectorAll(".chip")) c.classList.remove("on");
  render();
}

function buildChips() {
  const bcount = {};
  for (const d of DATA) { const b = d.bairro || "?"; bcount[b] = (bcount[b] || 0) + 1; }
  const bairros = Object.keys(bcount).sort((a, b) => ORD[classe(a)] - ORD[classe(b)] || bcount[b] - bcount[a]);
  $("bairros").innerHTML = bairros.map((b) => `<span class="chip ${classe(b)}" data-b="${b.replace(/"/g, "")}">${b} <span class="n">${bcount[b]}</span></span>`).join("");
  for (const c of $("bairros").querySelectorAll(".chip")) c.addEventListener("click", () => {
    const b = c.dataset.b;
    if (bairroSel.has(b)) { bairroSel.delete(b); c.classList.remove("on"); } else { bairroSel.add(b); c.classList.add("on"); }
    render();
  });
}

// ---------- anotacoes ----------
const saveTimers = {};
function saveAnot(d, patch, savedEl) {
  Object.assign(d, patch);
  clearTimeout(saveTimers[d.list_id]);
  saveTimers[d.list_id] = setTimeout(async () => {
    try {
      await api("/api/anotacoes/" + d.list_id, {
        method: "PUT",
        body: JSON.stringify({ favorito: d.favorito, status: d.anot_status, nota: d.anot_nota }),
      });
      if (savedEl) { savedEl.classList.add("show"); setTimeout(() => savedEl.classList.remove("show"), 1200); }
    } catch (e) { console.error(e); }
  }, 500);
}

const STATUS = ["", "contatei", "agendado", "descartado"];

function card(d) {
  const cl = classe(d.bairro);
  const el = document.createElement("div");
  el.className = "card " + cl + (d.anot_status === "descartado" ? " st-descartado" : "");
  const img = d.thumb ? `<img class="thumb" src="${d.thumb}" loading="lazy" onerror="this.style.display='none'">` : "";
  const warn = cl === "vermelho" ? '<span class="b warn">⚠️ Maps</span>' : (isFav(d) ? '<span class="b warn">⚠️ ' + d.morro + "</span>" : "");
  const ds = d.dist_favela;
  const distB = ds == null ? "" : ds === 0 ? '<span class="b warn">🔴 dentro favela</span>' : ds < 150 ? '<span class="b warn">🔴 ' + ds + "m " + (d.favela_prox || "favela") + "</span>" : ds < 400 ? '<span class="b bx">🟠 ' + ds + "m favela</span>" : ds < 800 ? '<span class="b">🟡 ' + ds + "m favela</span>" : '<span class="b as">🟢 ' + ds + "m livre</span>";
  const aprox = d.coord_aprox === 1 ? ' <span class="mut" title="localização aproximada">~</span>' : "";
  const wz = d.whatsapp ? `<a class="zap" href="https://wa.me/55${String(d.whatsapp).replace(/\D/g, "")}" target="_blank">WhatsApp</a>` : "";

  el.innerHTML = `${img}
    <div class="top"><span class="nota">${d.nota_final ?? "—"}</span><span class="pill ${cl}">${cl === "fora" ? "vizinho" : cl} · ${d.fonte}</span></div>
    <div class="bairro">${d.bairro || "?"} ${d.m2 ? "· " + d.m2 + "m²" : ""}${aprox}</div>
    <div class="rua">${d.rua || (d.re_complex_features || "")}${d.anunciante ? " · " + d.anunciante : ""}</div>
    <div class="preco"><b>R$${d.aluguel ?? "?"}</b> <span class="mut">+cond ${d.condominio ?? "?"} +iptu ${d.iptu ?? "?"} = vida ~R$${d.custo_vida ?? "?"}</span></div>
    <div class="specs"><span>${d.quartos || "?"}q</span><span>${d.banheiros || "?"}ban</span><span>${d.vagas || 0}vaga</span><span>📷${d.n_fotos || 0}</span></div>
    <div class="badges">${d.pet === 1 ? '<span class="b pet">🐾 pet</span>' : d.pet === 0 ? '<span class="b no">sem pet</span>' : ""}${d.area_servico === 1 ? '<span class="b as">🧺 área serv</span>' : ""}${d.mobiliado === 1 ? '<span class="b k">mobiliado</span>' : ""}${d.cozinha_score > 0 ? '<span class="b k">🍳 cozinha</span>' : ""}${d.perto_metro === 1 ? '<span class="b as">🚇 metrô</span>' : ""}${d.baixou_preco === 1 ? '<span class="b bx">↓ baixou</span>' : ""}${d.tiros_1km != null ? '<span class="b ' + (d.tiros_1km <= 3 ? "pet" : d.tiros_1km <= 8 ? "" : "warn") + '">💥 ' + (d.tiros_300 || 0) + "/" + d.tiros_1km + " (300m/1km)</span>" : ""}${isNovo(d) ? '<span class="b bx">🆕 novo</span>' : ""}${distB}${warn}</div>
    <div class="btns"><a class="ad" href="${d.url}" target="_blank">Anúncio 📷</a><a class="map" href="${mapLink(d)}" target="_blank">Rua 🗺️</a>${wz}</div>`;

  // --- bloco de anotacoes ---
  const anot = document.createElement("div");
  anot.className = "anot";
  const savedEl = document.createElement("span");
  savedEl.className = "saved";
  savedEl.textContent = "✓ salvo";

  const star = document.createElement("span");
  star.className = "star" + (d.favorito ? " on" : "");
  star.textContent = "★";
  star.title = "favoritar";
  star.onclick = () => { const v = d.favorito ? 0 : 1; star.classList.toggle("on", !!v); saveAnot(d, { favorito: v }, savedEl); };

  const sel = document.createElement("select");
  sel.innerHTML = STATUS.map((s) => `<option value="${s}">${s || "— status —"}</option>`).join("");
  sel.value = d.anot_status || "";
  sel.onchange = () => { saveAnot(d, { anot_status: sel.value || null }, savedEl); el.classList.toggle("st-descartado", sel.value === "descartado"); };

  const row = document.createElement("div");
  row.className = "anot-row";
  row.append(star, sel, savedEl);

  const ta = document.createElement("textarea");
  ta.placeholder = "anotações…";
  ta.value = d.anot_nota || "";
  ta.oninput = () => saveAnot(d, { anot_nota: ta.value }, savedEl);

  anot.append(row, ta);
  el.append(anot);
  return el;
}

function filteredRows() {
  const q = norm($("q").value), pet = $("pet").value, nocom = $("nocom").checked, noquarto = $("noquarto").checked, nofav = $("nofav").checked, viz = $("viz").checked;
  const maxcv = +$("maxcv").value || 9e9, minm2 = +$("minm2").value || 0, mindist = +$("mindist").value || 0, maxtiros = $("maxtiros").value;
  const fas = $("fas").checked, fmob = $("fmob").checked, fbx = $("fbx").checked, fzap = $("fzap").checked, fnovo = $("fnovo").checked, ffav = $("ffav").checked, fstatus = $("fstatus").value, sort = $("sort").value;
  let rows = DATA.filter((d) => {
    const cl = classe(d.bairro);
    if (bairroSel.size) { if (!bairroSel.has(d.bairro)) return false; }
    else if (!viz && cl === "fora") return false;
    if (nocom && isCom(d)) return false;
    if (noquarto && isQuarto(d)) return false;
    if (nofav && isFav(d)) return false;
    if (pet === "ok" && d.pet === 0) return false;
    if (pet === "sim" && d.pet !== 1) return false;
    if (d.custo_vida && d.custo_vida > maxcv) return false;
    if (d.m2 && d.m2 < minm2) return false;
    if (d.dist_favela != null && d.dist_favela < mindist) return false;
    if (fas && d.area_servico !== 1) return false;
    if (fmob && d.mobiliado !== 1) return false;
    if (fbx && d.baixou_preco !== 1) return false;
    if (fzap && !d.whatsapp) return false;
    if (fnovo && !isNovo(d)) return false;
    if (ffav && !d.favorito) return false;
    if (fstatus === "_none" && d.anot_status) return false;
    if (fstatus && fstatus !== "_none" && d.anot_status !== fstatus) return false;
    if (maxtiros !== "" && d.tiros_1km != null && d.tiros_1km > +maxtiros) return false;
    if (q && !(norm(d.bairro).includes(q) || norm(d.rua).includes(q) || norm(d.anunciante).includes(q))) return false;
    return true;
  });
  rows.sort((a, b) => sort === "cv" ? (a.custo_vida || 9e9) - (b.custo_vida || 9e9) : sort === "m2" ? (b.m2 || 0) - (a.m2 || 0) : sort === "fotos" ? (b.n_fotos || 0) - (a.n_fotos || 0) : (b.nota_final || 0) - (a.nota_final || 0));
  return rows;
}

let currentView = "lista";
function setView(v) {
  currentView = v;
  $("tab-lista").classList.toggle("on", v === "lista");
  $("tab-mapa").classList.toggle("on", v === "mapa");
  $("grid").hidden = v !== "lista";
  $("map").hidden = v !== "mapa";
  if (v === "mapa" && window.initMap) window.initMap();
  render();
}

function render() {
  const rows = filteredRows();
  $("count").textContent = "(" + rows.length + " imóveis)";
  $("stats").textContent = DATA.length + " no total";
  if (currentView === "mapa") {
    if (window.updateMap) window.updateMap(rows);
    return;
  }
  const grid = $("grid");
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const d of rows) frag.append(card(d));
  grid.append(frag);
}

// ---------- boot ----------
async function boot() {
  $("login").style.display = "none";
  $("app").hidden = false;
  try {
    const r = await api("/api/imoveis");
    DATA = await r.json();
    buildChips();
    render();
    for (const el of document.querySelectorAll("header input,header select")) el.addEventListener("input", render);
  } catch (e) {
    console.error(e);
  }
}

if (TOKEN) boot();
