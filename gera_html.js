// Dashboard HTML com FILTROS-TOGGLE. Carrega TODOS os primários; os cortes viram
// controles com o padrão do que o user pediu, mas reversíveis (nada some de vez).
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const db = new DatabaseSync(path.join(__dirname, "aluguel.db"));

const cols = `list_id,nota_final,bairro,bairro_classe,fonte,titulo,url,aluguel,condominio,iptu,total,custo_vida,
  m2,quartos,banheiros,vagas,n_fotos,pet,area_servico,mobiliado,cozinha_score,comodo_extra,perto_metro,baixou_preco,
  categoria,tipo,rua,lat,lon,morro,dist_favela,favela_prox,tiros_300,tiros_1km,coord_aprox,telefone,whatsapp,anunciante,re_complex_features,dup_fontes,thumb,primeiro_visto`.replace(/\s+/g, "");
const data = db.prepare(`SELECT ${cols} FROM anuncios WHERE is_primary=1`).all();

const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ranking Aluguel RJ</title>
<style>
:root{--bg:#0f1115;--card:#1a1d24;--txt:#e6e6e6;--mut:#9aa0aa;--verde:#2ecc71;--amarelo:#f1c40f;--vermelho:#e74c3c;--azul:#3498db}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;background:#12141a;padding:12px 16px;border-bottom:1px solid #262a33;z-index:10}
h1{margin:0 0 8px;font-size:17px}
.controls{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.controls input,.controls select{background:#20242d;color:var(--txt);border:1px solid #333;border-radius:6px;padding:6px 8px}
.grp{display:flex;gap:6px;align-items:center;background:#181b21;padding:4px 8px;border-radius:8px;border:1px solid #262a33}
.grp .t{color:var(--mut);font-size:11px;text-transform:uppercase}
label{color:var(--txt);display:flex;gap:4px;align-items:center;cursor:pointer;font-size:13px}
#stats{color:var(--mut);margin-left:auto;font-size:13px}
.reset{background:#2a2f3a;border:none;color:var(--txt);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px}
.bairros{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.chip{font-size:12px;padding:3px 9px;border-radius:20px;background:#20242d;border:1px solid #333;color:var(--mut);cursor:pointer;user-select:none}
.chip.verde{border-color:#1c5836}.chip.amarelo{border-color:#5a5320}.chip.vermelho{border-color:#5a271f}.chip.fora{border-color:#3a3f4a}
.chip.on{background:var(--azul);color:#fff;border-color:var(--azul)}
.chip .n{opacity:.6;font-size:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;padding:16px}
.card{background:var(--card);border-radius:10px;padding:12px;border-left:4px solid #444;display:flex;flex-direction:column;gap:6px}
.card.verde{border-left-color:var(--verde)}.card.amarelo{border-left-color:var(--amarelo)}.card.vermelho{border-left-color:var(--vermelho)}.card.fora{border-left-color:#666}
.thumb{width:100%;height:150px;object-fit:cover;border-radius:6px;background:#20242d}
.top{display:flex;justify-content:space-between;align-items:center}
.nota{font-size:20px;font-weight:700}.pill{font-size:11px;padding:2px 7px;border-radius:20px;background:#2a2f3a;color:var(--mut)}
.pill.verde{background:#173d29;color:var(--verde)}.pill.amarelo{background:#3d3717;color:var(--amarelo)}.pill.vermelho{background:#3d1c17;color:var(--vermelho)}.pill.fora{background:#2a2f3a;color:var(--mut)}
.bairro{font-weight:600;font-size:15px}.rua{color:var(--mut);font-size:12px;min-height:15px}
.preco{font-size:14px}.preco b{font-size:17px}.mut{color:var(--mut);font-size:12px}
.specs{display:flex;gap:10px;flex-wrap:wrap;font-size:13px}
.badges{display:flex;gap:5px;flex-wrap:wrap}.b{font-size:11px;padding:2px 6px;border-radius:5px;background:#2a2f3a}
.b.pet{background:#173d29;color:var(--verde)}.b.no{background:#3d1c17;color:var(--vermelho)}.b.as{background:#17313d;color:var(--azul)}.b.bx{background:#3d3717;color:var(--amarelo)}.b.warn{background:#3d1c17;color:var(--vermelho)}.b.k{background:#2d2540;color:#b89cf0}
.btns{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.btns a{flex:1;min-width:80px;text-align:center;text-decoration:none;padding:7px;border-radius:6px;font-size:12px;font-weight:600}
.btns .ad{background:var(--azul);color:#fff}.btns .map{background:#2a2f3a;color:var(--txt)}.btns .zap{background:#25d366;color:#04310f}
</style></head><body>
<header>
<h1>🏠 Ranking Aluguel RJ <span class="mut" id="count"></span> <button class="reset" onclick="resetF()">↺ padrão</button></h1>
<div class="controls">
<input id="q" placeholder="🔎 bairro/rua/anunciante" style="min-width:150px">
<div class="grp"><span class="t">Pet</span>
  <select id="pet"><option value="ok">permite/desconhecido</option><option value="sim">só confirmado 🐾</option><option value="any">tanto faz</option></select></div>
<div class="grp"><span class="t">Tipo</span>
  <label><input type="checkbox" id="nocom" checked>sem comercial</label>
  <label><input type="checkbox" id="noquarto" checked>sem quarto</label></div>
<div class="grp"><span class="t">Segurança</span>
  <label><input type="checkbox" id="nofav" checked>sem favela</label>
  <label><input type="checkbox" id="viz">incluir vizinhos</label></div>
<div class="grp"><span class="t">Custo vida ≤</span><input id="maxcv" type="number" value="2500" style="width:75px"></div>
<div class="grp"><span class="t">m² ≥</span><input id="minm2" type="number" value="25" style="width:60px"></div>
<div class="grp"><span class="t">🔫 dist. favela ≥</span><input id="mindist" type="number" value="150" style="width:65px">m</div>
<div class="grp"><label><input type="checkbox" id="fas">área serviço</label>
  <label><input type="checkbox" id="fmob">mobiliado</label>
  <label><input type="checkbox" id="fbx">↓ baixou</label>
  <label><input type="checkbox" id="fzap">tem WhatsApp</label>
  <label><input type="checkbox" id="fnovo">🆕 só novos</label></div>
<div class="grp"><span class="t">💥 tiros/1km ≤</span><input id="maxtiros" type="number" style="width:55px" placeholder="∞"></div>
<select id="sort"><option value="nota">ordenar: nota</option><option value="cv">menor custo</option><option value="m2">maior m²</option><option value="fotos">mais fotos</option></select>
<span id="stats"></span>
</div>
<div class="bairros" id="bairros"></div>
</header>
<div class="grid" id="grid"></div>
<script>
const DATA=${JSON.stringify(data)};
const $=id=>document.getElementById(id);
const norm=s=>(s||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();
const VERDE=new Set(["meier","todos os santos","vila da penha","piedade","vista alegre","vila isabel","tijuca","grajau","maracana"]);
const AMAR=new Set(["cachambi","del castilho","agua santa"]);
const VERM=new Set(["engenho de dentro","engenho novo","lins de vasconcelos"]);
function classe(b){b=norm(b);return VERDE.has(b)?"verde":AMAR.has(b)?"amarelo":VERM.has(b)?"vermelho":"fora"}
const COM=/office|business|commercial|warehouse|deposit|shed|clinic|gallery|store|retail|land|building|floor/;
function isCom(d){const t=norm(d.tipo),c=norm(d.categoria);return COM.test(t)||/comerc|loja|sala|galp/.test(c)}
function isQuarto(d){return /quarto/.test(norm(d.categoria))}
function isFav(d){return d.morro&&d.morro!=="-"&&!d.morro.startsWith("?")}
function mapLink(d){if(d.lat&&d.lon)return "https://www.google.com/maps/search/?api=1&query="+d.lat+","+d.lon;return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent((d.rua?d.rua+", ":"")+(d.bairro||"")+", Rio de Janeiro")}
const DEF={pet:"ok",nocom:true,noquarto:true,nofav:true,viz:false,maxcv:2500,minm2:25,mindist:150,maxtiros:"",fas:false,fmob:false,fbx:false,fzap:false,fnovo:false,sort:"nota"};
const HOJE=new Date(),LIM=new Date(HOJE-3*864e5).toISOString().slice(0,10);
const isNovo=d=>d.primeiro_visto&&d.primeiro_visto>=LIM;
// chips de bairro (multi-seleção). Vazio = todos.
const bairroSel=new Set();
const ORD={verde:0,amarelo:1,vermelho:2,fora:3};
const bcount={};for(const d of DATA){const b=d.bairro||"?";bcount[b]=(bcount[b]||0)+1}
const bairros=Object.keys(bcount).sort((a,b)=>ORD[classe(a)]-ORD[classe(b)]||bcount[b]-bcount[a]);
function buildChips(){
  $("bairros").innerHTML=bairros.map(b=>\`<span class="chip \${classe(b)}" data-b="\${b.replace(/"/g,'')}">\${b} <span class="n">\${bcount[b]}</span></span>\`).join("");
  for(const c of $("bairros").querySelectorAll(".chip"))c.addEventListener("click",()=>{
    const b=c.dataset.b; if(bairroSel.has(b)){bairroSel.delete(b);c.classList.remove("on")}else{bairroSel.add(b);c.classList.add("on")}
    render();
  });
}
function resetF(){for(const k in DEF){const el=$(k);if(el.type==="checkbox")el.checked=DEF[k];else el.value=DEF[k]}$("q").value="";bairroSel.clear();for(const c of $("bairros").querySelectorAll(".chip"))c.classList.remove("on");render()}

function card(d){
  const cl=classe(d.bairro);
  const img=d.thumb?\`<img class="thumb" src="\${d.thumb}" loading="lazy" onerror="this.style.display='none'">\`:"";
  const warn=cl==="vermelho"?'<span class="b warn">⚠️ Maps</span>':(isFav(d)?'<span class="b warn">⚠️ '+d.morro+'</span>':"");
  const ds=d.dist_favela;
  const distB=ds==null?'':ds===0?'<span class="b warn">🔴 dentro favela</span>':ds<150?'<span class="b warn">🔴 '+ds+'m '+(d.favela_prox||'favela')+'</span>':ds<400?'<span class="b bx">🟠 '+ds+'m favela</span>':ds<800?'<span class="b">🟡 '+ds+'m favela</span>':'<span class="b as">🟢 '+ds+'m livre</span>';
  const aprox=d.coord_aprox===1?' <span class="mut" title="localização aproximada">~</span>':"";
  const wz=d.whatsapp?\`<a class="zap" href="https://wa.me/55\${(d.whatsapp+'').replace(/\\D/g,'')}" target="_blank">WhatsApp</a>\`:"";
  return \`<div class="card \${cl}">\${img}
    <div class="top"><span class="nota">\${d.nota_final??"—"}</span><span class="pill \${cl}">\${cl==="fora"?"vizinho":cl} · \${d.fonte}</span></div>
    <div class="bairro">\${d.bairro||"?"} \${d.m2?'· '+d.m2+'m²':''}\${aprox}</div>
    <div class="rua">\${d.rua||(d.re_complex_features||"")}\${d.anunciante?' · '+d.anunciante:''}</div>
    <div class="preco"><b>R$\${d.aluguel??"?"}</b> <span class="mut">+cond \${d.condominio??"?"} +iptu \${d.iptu??"?"} = vida ~R$\${d.custo_vida??"?"}</span></div>
    <div class="specs"><span>\${d.quartos||"?"}q</span><span>\${d.banheiros||"?"}ban</span><span>\${d.vagas||0}vaga</span><span>📷\${d.n_fotos||0}</span></div>
    <div class="badges">\${d.pet===1?'<span class="b pet">🐾 pet</span>':d.pet===0?'<span class="b no">sem pet</span>':''}\${d.area_servico===1?'<span class="b as">🧺 área serv</span>':''}\${d.mobiliado===1?'<span class="b k">mobiliado</span>':''}\${d.cozinha_score>0?'<span class="b k">🍳 cozinha</span>':''}\${d.perto_metro===1?'<span class="b as">🚇 metrô</span>':''}\${d.baixou_preco===1?'<span class="b bx">↓ baixou</span>':''}\${d.tiros_1km!=null?'<span class="b '+(d.tiros_1km<=3?'pet':d.tiros_1km<=8?'':'warn')+'">💥 '+(d.tiros_300||0)+'/'+d.tiros_1km+' (300m/1km)</span>':''}\${isNovo(d)?'<span class="b bx">🆕 novo</span>':''}\${distB}\${warn}</div>
    <div class="btns"><a class="ad" href="\${d.url}" target="_blank">Anúncio 📷</a><a class="map" href="\${mapLink(d)}" target="_blank">Rua 🗺️</a>\${wz}</div>
  </div>\`;
}
function render(){
  const q=norm($("q").value),pet=$("pet").value,nocom=$("nocom").checked,noquarto=$("noquarto").checked,nofav=$("nofav").checked,viz=$("viz").checked;
  const maxcv=+$("maxcv").value||9e9,minm2=+$("minm2").value||0,mindist=+$("mindist").value||0,maxtiros=$("maxtiros").value,fas=$("fas").checked,fmob=$("fmob").checked,fbx=$("fbx").checked,fzap=$("fzap").checked,fnovo=$("fnovo").checked,sort=$("sort").value;
  let rows=DATA.filter(d=>{
    const cl=classe(d.bairro);
    if(bairroSel.size){ if(!bairroSel.has(d.bairro))return false; }  // seleção explícita de bairros
    else if(!viz&&cl==="fora")return false;
    if(nocom&&isCom(d))return false;
    if(noquarto&&isQuarto(d))return false;
    if(nofav&&isFav(d))return false;
    if(pet==="ok"&&d.pet===0)return false;
    if(pet==="sim"&&d.pet!==1)return false;
    if(d.custo_vida&&d.custo_vida>maxcv)return false;
    if(d.m2&&d.m2<minm2)return false;
    if(d.dist_favela!=null&&d.dist_favela<mindist)return false;  // borda de favela (null=sem coord, não corta)
    if(fas&&d.area_servico!==1)return false;
    if(fmob&&d.mobiliado!==1)return false;
    if(fbx&&d.baixou_preco!==1)return false;
    if(fzap&&!d.whatsapp)return false;
    if(fnovo&&!isNovo(d))return false;
    if(maxtiros!==""&&d.tiros_1km!=null&&d.tiros_1km>+maxtiros)return false;
    if(q&&!(norm(d.bairro).includes(q)||norm(d.rua).includes(q)||norm(d.anunciante).includes(q)))return false;
    return true;
  });
  rows.sort((a,b)=> sort==="cv"?(a.custo_vida||9e9)-(b.custo_vida||9e9): sort==="m2"?(b.m2||0)-(a.m2||0): sort==="fotos"?(b.n_fotos||0)-(a.n_fotos||0):(b.nota_final||0)-(a.nota_final||0));
  $("grid").innerHTML=rows.map(card).join("");
  $("count").textContent="("+rows.length+" imóveis)";
  $("stats").textContent=DATA.length+" no total";
}
for(const el of document.querySelectorAll("header input,header select"))el.addEventListener("input",render);
buildChips();
render();
</script></body></html>`;
fs.writeFileSync(path.join(__dirname, "ranking.html"), html);
console.log("Dashboard toggle gerado:", data.length, "primários carregados (filtros no cliente)");
db.close();
