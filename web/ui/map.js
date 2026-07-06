// Aba Mapa: Leaflet. Imoveis vêm filtrados da lista (filteredRows via app.js);
// camadas de risco (favelas/grupos/tiroteios/assalto/mortalidade) sao arquivos
// estaticos em /data/, carregados sob demanda (lazy) ao ligar a camada.
let _map, _imovelLayer, _legend, _baseSel = "nenhum";
const _loaded = {}; // cache de camadas ja carregadas

const heat = (v, max) => {
  if (v == null) return "#3a3a3a";
  const t = Math.min(v / max, 1);
  const r = t < .5 ? Math.round(500 * t) : 250;
  const g = t < .5 ? 220 : Math.round(500 * (1 - t));
  return "rgb(" + r + "," + Math.max(g, 40) + ",50)";
};
const corDist = (d) => d == null ? "#888" : d === 0 ? "#c0392b" : d < 150 ? "#e74c3c" : d < 400 ? "#e67e22" : d < 800 ? "#f1c40f" : "#2ecc71";
const houseIcon = (c) => L.divIcon({
  className: "house", iconSize: [16, 16], iconAnchor: [8, 8],
  html: '<svg width=16 height=16><path d="M8 1L15 7H13V15H3V7H1Z" fill="' + c + '" stroke="#000" stroke-width=".8"/></svg>',
});
const GCOR = { "Comando Vermelho": "#c0392b", "Milicia": "#2980b9", "Terceiro Comando Puro": "#e67e22", "Amigo dos amigos": "#f1c40f", "Em disputa": "#8e44ad" };

async function fetchJSON(u) { const r = await fetch(u); return r.json(); }

// popula uma camada lazy na 1a vez que é ligada
async function lazyLoad(key, layer, builder) {
  if (_loaded[key]) return;
  _loaded[key] = true;
  try { await builder(layer); } catch (e) { console.error("falha carregando", key, e); _loaded[key] = false; }
}

window.initMap = function () {
  if (_map) { setTimeout(() => _map.invalidateSize(), 60); return; }
  _map = L.map("map", { preferCanvas: true }).setView([-22.90, -43.32], 11);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "© OSM, © CARTO", maxZoom: 19 }).addTo(_map);

  _imovelLayer = L.layerGroup().addTo(_map);

  // --- overlays lazy ---
  const favLayer = L.geoJSON(null, { style: { color: "#c0392b", weight: .5, fillColor: "#c0392b", fillOpacity: .35 } });
  const grupoLayer = L.geoJSON(null, {
    style: (f) => ({ color: "#111", weight: .5, fillColor: GCOR[f.properties.grupo] || "#888", fillOpacity: .6 }),
    onEachFeature: (f, l) => l.bindPopup("<b>" + (f.properties.nome || "comunidade") + "</b><br>🔫 domínio: " + f.properties.grupo + "<br><small>(GENI ~2020)</small>"),
  });
  const tiroLayer = L.layerGroup();

  // --- base layers (exclusivos): assalto OU mortalidade OU nenhum (bairros_crime) ---
  const nenhum = L.layerGroup().addTo(_map);
  const assaltoLayer = L.geoJSON(null, {
    style: (f) => ({ color: "#333", weight: .5, fillColor: heat(f.properties.taxa_assalto, 600), fillOpacity: .55 }),
    onEachFeature: (f, l) => l.bindPopup("<b>" + f.properties.nome + "</b><br>🔫 assalto: " + (f.properties.taxa_assalto ?? "?") + "/100mil"),
  });
  const mortLayer = L.geoJSON(null, {
    style: (f) => ({ color: "#333", weight: .5, fillColor: heat(f.properties.taxa_mort, 50), fillOpacity: .55 }),
    onEachFeature: (f, l) => l.bindPopup("<b>" + f.properties.nome + "</b><br>💀 mortalidade: " + (f.properties.taxa_mort ?? "?") + "/100mil"),
  });

  _map.on("overlayadd", async (e) => {
    if (e.layer === favLayer) await lazyLoad("fav", favLayer, async (l) => l.addData(await fetchJSON("data/favelas.json")));
    else if (e.layer === grupoLayer) await lazyLoad("grupo", grupoLayer, async (l) => l.addData(await fetchJSON("data/grupos_armados.geojson")));
    else if (e.layer === tiroLayer) await lazyLoad("tiros", tiroLayer, async (l) => {
      const txt = await (await fetch("data/tiroteios_rj.csv")).text();
      const lines = txt.split(/\r?\n/).filter(Boolean);
      const h = {}; lines[0].split(",").forEach((c, i) => h[c.trim()] = i);
      for (const line of lines.slice(1)) {
        const r = line.split(","); const lat = +r[h.lat], lon = +r[h.lon], m = +r[h.mortos] || 0;
        if (isNaN(lat)) continue;
        L.circle([lat, lon], { radius: 300, color: "#ff3b3b", weight: 0, fillColor: "#ff3b3b", fillOpacity: .05 }).addTo(l);
        L.circleMarker([lat, lon], { radius: m > 0 ? 4 : 2.5, color: "#000", weight: .5, fillColor: m > 0 ? "#ff1a1a" : "#ff8c00", fillOpacity: .9 }).bindPopup("💥 tiroteio" + (m > 0 ? " · " + m + " morto(s)" : "")).addTo(l);
      }
    });
    _renderLegend();
  });
  _map.on("overlayremove", _renderLegend);

  // base layers compartilham bairros_crime.geojson (carrega 1x)
  async function loadCrime(layer, which) {
    await lazyLoad("crime_" + which, layer, async (l) => l.addData(await fetchJSON("data/bairros_crime.geojson")));
  }
  _map.on("baselayerchange", async (e) => {
    _baseSel = e.name.includes("Assalto") ? "assalto" : e.name.includes("Mortalidade") ? "mort" : "nenhum";
    if (_baseSel === "assalto") await loadCrime(assaltoLayer, "assalto");
    if (_baseSel === "mort") await loadCrime(mortLayer, "mort");
    _renderLegend();
  });

  L.control.layers(
    { "⬜ Nenhum": nenhum, "🔫 Assalto (bairro)": assaltoLayer, "💀 Mortalidade (bairro)": mortLayer },
    { "🟥 Favelas": favLayer, "🔫 Grupos armados": grupoLayer, "💥 Tiroteios (+área)": tiroLayer },
    { collapsed: false }
  ).addTo(_map);

  _legend = L.control({ position: "bottomright" });
  _legend.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.id = "lg"; return d; };
  _legend.addTo(_map);
  _renderLegend();

  setTimeout(() => _map.invalidateSize(), 60);
};

// imoveis: recebe as linhas JA filtradas pela lista
window.updateMap = function (rows) {
  if (!_imovelLayer) return;
  _imovelLayer.clearLayers();
  let n = 0;
  for (const p of rows) {
    if (p.lat == null || p.lon == null) continue;
    n++;
    const wz = p.whatsapp ? ' · <a href="https://wa.me/55' + String(p.whatsapp).replace(/\D/g, "") + '" target="_blank">WhatsApp</a>' : "";
    const st = p.anot_status ? ' · <b style="color:#f1c40f">' + p.anot_status + "</b>" : "";
    const fav = p.favorito ? " ⭐" : "";
    const html = '<div class="pop"><b>' + (p.bairro || "?") + "</b> · nota " + (p.nota_final ?? "—") + fav +
      "<br>R$" + (p.aluguel ?? "?") + " (vida ~" + (p.custo_vida ?? "?") + ") · " + (p.m2 || "?") + "m² · " + (p.quartos || "?") + "q" + (p.pet === 1 ? " 🐾" : "") +
      '<br><span class="r">🟥 ' + (p.dist_favela == null ? "?" : p.dist_favela === 0 ? "DENTRO" : p.dist_favela + "m") + " favela · 💥 tiros/12m ≤300m " + (p.tiros_300 ?? "?") + " · ≤1km " + (p.tiros_1km ?? "?") + "</span>" + st +
      '<br><a href="' + p.url + '" target="_blank">Ver anúncio 📷</a>' + wz + "</div>";
    L.marker([p.lat, p.lon], { icon: houseIcon(corDist(p.dist_favela)) }).bindPopup(html).addTo(_imovelLayer);
  }
  _mapCount = n;
  _renderLegend();
};

let _mapCount = 0;
function _renderLegend() {
  const el = document.getElementById("lg");
  if (!el) return;
  let s = "";
  if (_baseSel === "assalto") s += "<b>🔫 Assalto (taxa/100mil)</b><div class='grad'></div><small>0 → 600+ · verde=seguro</small><br>";
  else if (_baseSel === "mort") s += "<b>💀 Mortalidade (taxa/100mil)</b><div class='grad'></div><small>0 → 50+ · verde=seguro</small><br>";
  s += "<b>🏠 Imóveis</b> (cor=dist favela)<br><span class='dot' style='background:#e74c3c'></span>&lt;150m <span class='dot' style='background:#f1c40f'></span>&lt;800m <span class='dot' style='background:#2ecc71'></span>livre<br>";
  s += "<small>" + _mapCount + " imóveis no filtro</small>";
  el.innerHTML = s;
}
