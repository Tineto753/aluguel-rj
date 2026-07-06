// Mapa Leaflet de risco. Assalto/mortalidade = base layers (exclusivos, não se cobrem).
// Favela/grupos armados/tiroteios/imóveis = overlays. Símbolos distintos + anel de tiroteio + legenda dinâmica.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

const favelas = JSON.parse(fs.readFileSync(process.env.FAV || "/home/argo/favelas.json", "utf8"));
const bcrime = JSON.parse(fs.readFileSync(path.join(__dirname, "bairros_crime.geojson"), "utf8"));
const grupos = JSON.parse(fs.readFileSync(path.join(__dirname, "grupos_armados.geojson"), "utf8"));
const tl = fs.readFileSync(path.join(__dirname, "tiroteios_rj.csv"), "utf8").split(/\r?\n/).filter(Boolean);
const th = {}; tl[0].split(",").forEach((h, i) => th[h.trim()] = i);
const tiros = tl.slice(1).map(l => l.split(",")).map(r => ({ lat: +r[th.lat], lon: +r[th.lon], m: +r[th.mortos] || 0 })).filter(t => !isNaN(t.lat));
const COM = /office|business|commercial|warehouse|deposit|shed|clinic|gallery|store|retail|land|building|floor/i;
const pts = db.prepare(`SELECT nota_final,bairro,aluguel,custo_vida,m2,quartos,pet,dist_favela,favela_prox,taxa_assalto_bairro ta,taxa_mort_bairro tm,tiros_300 t3,tiros_1km t1,tiros_2km t2,lat,lon,url,whatsapp,fonte,categoria,tipo FROM anuncios WHERE is_primary=1 AND lat IS NOT NULL`).all()
  .filter(r => !(COM.test(r.tipo || "") || /comerc|loja|sala|galp|quarto/i.test(r.categoria || "")))
  .map(r => ({ n: r.nota_final, b: r.bairro, cv: r.custo_vida, al: r.aluguel, m: r.m2, q: r.quartos, pet: r.pet, d: r.dist_favela, fp: r.favela_prox, ta: r.ta, tm: r.tm, t3: r.t3, t1: r.t1, t2: r.t2, lat: r.lat, lon: r.lon, u: r.url, w: r.whatsapp, f: r.fonte }));
db.close();

const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Mapa de Risco — Aluguel RJ</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body{margin:0;height:100%}#map{height:100vh}
.legend,.leaflet-control-layers{background:#12141a!important;color:#e6e6e6!important;font:13px system-ui}
.legend{padding:10px 12px;border-radius:8px;line-height:1.7;max-width:210px}.legend b{font-size:13px}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:middle}
.sq{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:middle;border:1px solid #000}
.grad{height:10px;border-radius:3px;background:linear-gradient(90deg,#2ecc71,#f1c40f,#e67e22,#c0392b);margin:2px 0}
.pop{font:13px system-ui;min-width:190px}.pop b{font-size:15px}.pop a{color:#3498db}.pop .r{color:#e67e22}
.leaflet-control-layers label{color:#e6e6e6}.leaflet-control-layers-separator{border-color:#333}
.house svg{filter:drop-shadow(0 0 1px #000)}</style></head><body><div id="map"></div>
<script>
const FAV=${JSON.stringify(favelas)},BCRIME=${JSON.stringify(bcrime)},GRUPOS=${JSON.stringify(grupos)},TIROS=${JSON.stringify(tiros)},PTS=${JSON.stringify(pts)};
const map=L.map('map',{preferCanvas:true}).setView([-22.90,-43.32],11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OSM,© CARTO',maxZoom:19}).addTo(map);
function heat(v,max){if(v==null)return '#3a3a3a';const t=Math.min(v/max,1);const r=t<.5?Math.round(500*t):250;const g=t<.5?220:Math.round(500*(1-t));return 'rgb('+r+','+Math.max(g,40)+',50)'}

// ===== BASE LAYERS (exclusivos: assalto OU mortalidade OU nenhum) =====
const nenhum=L.layerGroup();
const assaltoLayer=L.geoJSON(BCRIME,{style:f=>({color:'#333',weight:.5,fillColor:heat(f.properties.taxa_assalto,600),fillOpacity:.55}),
  onEachFeature:(f,l)=>l.bindPopup('<b>'+f.properties.nome+'</b><br>🔫 assalto: '+(f.properties.taxa_assalto??'?')+'/100mil')});
const mortLayer=L.geoJSON(BCRIME,{style:f=>({color:'#333',weight:.5,fillColor:heat(f.properties.taxa_mort,50),fillOpacity:.55}),
  onEachFeature:(f,l)=>l.bindPopup('<b>'+f.properties.nome+'</b><br>💀 mortalidade: '+(f.properties.taxa_mort??'?')+'/100mil')});

// ===== OVERLAYS =====
const favLayer=L.geoJSON(FAV,{style:{color:'#c0392b',weight:.5,fillColor:'#c0392b',fillOpacity:.35}});
const GCOR={'Comando Vermelho':'#c0392b','Milicia':'#2980b9','Terceiro Comando Puro':'#e67e22','Amigo dos amigos':'#f1c40f','Em disputa':'#8e44ad'};
const grupoLayer=L.geoJSON(GRUPOS,{style:f=>({color:'#111',weight:.5,fillColor:GCOR[f.properties.grupo]||'#888',fillOpacity:.6}),
  onEachFeature:(f,l)=>l.bindPopup('<b>'+(f.properties.nome||'comunidade')+'</b><br>🔫 domínio: '+f.properties.grupo+'<br><small>(GENI ~2020)</small>')});
// 💥 tiroteios: anel de área afetada (300m) + centro
const tiroLayer=L.layerGroup();
for(const t of TIROS){L.circle([t.lat,t.lon],{radius:300,color:'#ff3b3b',weight:0,fillColor:'#ff3b3b',fillOpacity:.05}).addTo(tiroLayer);
  L.circleMarker([t.lat,t.lon],{radius:t.m>0?4:2.5,color:'#000',weight:.5,fillColor:t.m>0?'#ff1a1a':'#ff8c00',fillOpacity:.9}).bindPopup('💥 tiroteio'+(t.m>0?' · '+t.m+' morto(s)':'')).addTo(tiroLayer);}
// 🏠 imóveis (ícone de CASA, cor por dist favela)
function cor(d){return d==null?'#888':d===0?'#c0392b':d<150?'#e74c3c':d<400?'#e67e22':d<800?'#f1c40f':'#2ecc71'}
function houseIcon(c){return L.divIcon({className:'house',iconSize:[16,16],iconAnchor:[8,8],
  html:'<svg width=16 height=16><path d="M8 1L15 7H13V15H3V7H1Z" fill="'+c+'" stroke="#000" stroke-width=".8"/></svg>'})}
const ptLayer=L.layerGroup(PTS.map(p=>{
  const wz=p.w?' · <a href="https://wa.me/55'+(''+p.w).replace(/\\D/g,'')+'" target="_blank">WhatsApp</a>':'';
  const html='<div class="pop"><b>'+(p.b||'?')+'</b> · nota '+(p.n??'—')+'<br>R$'+(p.al??'?')+' (vida ~'+(p.cv??'?')+') · '+(p.m||'?')+'m² · '+(p.q||'?')+'q'+(p.pet===1?' 🐾':'')+
    '<br><span class="r">🟥 '+(p.d==null?'?':p.d===0?'DENTRO':p.d+'m')+' favela · 💥 tiros/12m: ≤300m '+(p.t3??'?')+' · ≤1km '+(p.t1??'?')+' · ≤2km '+(p.t2??'?')+'</span>'+
    '<br><span class="r">🔫 assalto '+(p.ta??'?')+' · 💀 mort '+(p.tm??'?')+'/100mil</span>'+
    '<br><a href="'+p.u+'" target="_blank">Ver anúncio 📷</a>'+wz+'</div>';
  return L.marker([p.lat,p.lon],{icon:houseIcon(cor(p.d))}).bindPopup(html);
}));

nenhum.addTo(map); ptLayer.addTo(map); favLayer.addTo(map);
L.control.layers(
  {'⬜ Nenhum':nenhum,'🔫 Assalto (bairro)':assaltoLayer,'💀 Mortalidade (bairro)':mortLayer},
  {'🏠 Imóveis':ptLayer,'🟥 Favelas':favLayer,'🔫 Grupos armados':grupoLayer,'💥 Tiroteios (+área)':tiroLayer},
  {collapsed:false}).addTo(map);

// ===== LEGENDA DINÂMICA =====
const legend=L.control({position:'bottomright'});
let baseSel='nenhum';
legend.onAdd=()=>{const d=L.DomUtil.create('div','legend');d.id='lg';return d};
legend.addTo(map);
function render(){
  let s='';
  if(baseSel==='assalto') s+='<b>🔫 Assalto (taxa/100mil)</b><div class="grad"></div><small>0 → 600+ · verde=seguro</small><br>';
  else if(baseSel==='mort') s+='<b>💀 Mortalidade (taxa/100mil)</b><div class="grad"></div><small>0 → 50+ · verde=seguro</small><br>';
  if(map.hasLayer(ptLayer)) s+='<b>🏠 Imóveis</b> (cor=dist favela)<br><span class="dot" style="background:#e74c3c"></span>&lt;150m <span class="dot" style="background:#f1c40f"></span>&lt;800m <span class="dot" style="background:#2ecc71"></span>livre<br>';
  if(map.hasLayer(grupoLayer)) s+='<b>🔫 Grupos armados</b><br><span class="sq" style="background:#c0392b"></span>CV <span class="sq" style="background:#2980b9"></span>Milícia <span class="sq" style="background:#e67e22"></span>TCP <span class="sq" style="background:#8e44ad"></span>disputa<br>';
  if(map.hasLayer(favLayer)) s+='<span class="sq" style="background:#c0392b;opacity:.5"></span>Favela<br>';
  if(map.hasLayer(tiroLayer)) s+='<span class="dot" style="background:#ff1a1a"></span>Tiroteio (anel=área 300m)<br>';
  s+='<small>'+PTS.length+' imóveis · '+TIROS.length+' tiroteios/12m</small>';
  document.getElementById('lg').innerHTML=s;
}
map.on('baselayerchange',e=>{baseSel=e.name.includes('Assalto')?'assalto':e.name.includes('Mortalidade')?'mort':'nenhum';render()});
map.on('overlayadd overlayremove',render);
render();
</script></body></html>`;
fs.writeFileSync(path.join(__dirname, "mapa.html"), html);
console.log("mapa.html:", pts.length, "imóveis,", favelas.features.length, "favelas,", grupos.features.length, "comunidades-grupo,", tiros.length, "tiroteios");
