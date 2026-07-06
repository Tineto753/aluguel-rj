# 🏠 Aluguel RJ — busca de imóvel com filtro de segurança

Sistema pessoal pra achar aluguel no Rio priorizando **segurança acima de tudo**.
Coleta 5+ sites, cruza com 5 camadas de risco reais, ranqueia e mostra em dashboard + mapa.

> **Handoff pro próximo Claude:** leia este README + a memória do projeto
> (`~/.claude/projects/-home-argo/memory/project_busca_aluguel_rj.md`). Tudo roda em `~/aluguel_rj/`.

---

## 👤 Quem é o usuário (contexto)
- Solteiro **+ pet** ("a pequena", inegociável — só imóvel que aceita animais).
- **Sem carro.** Trabalha 2x/semana em **Santo Cristo/Zona Portuária**, horário flexível, usa transporte pra lazer também → trem/metrô ≤20min a pé.
- **Mora HOJE na Ilha do Governador (casa do pai)** → objetivo é INDEPENDÊNCIA, sair pro próprio canto. **Ilha = catalogada mas NUNCA entra como candidato.**
- Orçamento: teto **R$2500 somando tudo** (aluguel+cond+IPTU+energia+água estimados). Filtro prático: (aluguel+cond+iptu) ≤ 2200.
- Spec do imóvel: cozinha equipada (req nº1), quarto folgado (cama Queen+TV+PC+impressora 3D), lugar pra máquina de lavar, banheiro. Escritório/sala = legal de ter. Kitnet serve se cozinha boa. Quarto compartilhado/comercial NÃO.
- **Prioridade absoluta = SEGURANÇA.** No Rio, errar bairro custa a vida (bala perdida, milícia). Ele valida os finalistas no olho (Street View/local) depois.

## 🔒 As 3 regras de portão (a filosofia)
1. **SITE** só entra se der **dado geolocalizável** (endereço/coords) — senão não dá pra avaliar risco → não coleta.
2. **IMÓVEL** só é mostrado onde há **camadas de segurança** (Rio-município = completo; Niterói/SG só se tiver os dados).
3. **Dado faltando NÃO elimina** no cadastro, mas **afunda no ranking** (completude). Filtrar em SQL, nunca descartar por falta de dado.

---

## 🗄️ Arquitetura
Banco único **`aluguel.db`** (SQLite, `node:sqlite` — sem servidor). Tabela `anuncios` (todas as fontes, coluna `fonte`) + views.
Namespace de `list_id` por fonte p/ não colidir: OLX `<2e9`, QA `2e12+`, CNM `3e12+`, ZAP `4e12+`, VR `5e12+`.

### Fluxo (é o que `atualiza.sh` roda em ordem)
```
coleta 5 fontes → enrich_qa → [marca NOVOS] → dedup → merge_grupos →
sabren → buffer → build_bairro_crime → tiros_freq → rank → gera_html → gera_mapa
```

### Scripts (cada um em ~/aluguel_rj/)
| Script | O quê |
|---|---|
| `db_init.js` | cria schema (tabela `anuncios` + views) |
| `coleta_olx/zap/vivareal/qa/cnm.js` | coletores por fonte (ver SCHEMA_FONTES.md) |
| `enrich_qa.js` | visita página individual do QuintoAndar (pet/mobiliado/cozinha/coords/custo real) |
| `dedup.js` | union-find por endereço+preço → marca `dup_group`/`is_primary` (NÃO apaga) |
| `merge_grupos.js` | consolida: primário herda campos faltantes dos gêmeos de outras fontes |
| `sabren.js` | point-in-polygon favela (favelas.json) → coluna `morro` |
| `buffer.js` | distância (m) à favela mais próxima → `dist_favela` (a BORDA é o perigo) |
| `build_bairro_crime.js` | taxa per-capita assalto/mortalidade por CISP → atribuída a cada bairro |
| `tiros_freq.js` | frequência de tiroteios (Fogo Cruzado) em 3 faixas: `tiros_300`/`tiros_1km`/`tiros_2km` |
| `rank.js` | `nota_final` 0-100 (pesos: preço, bairro, borda-favela, m², etc.) + `bairro_classe` |
| `gera_html.js` | dashboard `ranking.html` (filtros-toggle no cliente) |
| `gera_mapa.js` | mapa de risco `mapa.html` (Leaflet, 5 camadas) |
| `fc_pull.py` | puxa tiroteios da API Fogo Cruzado (roda no venv) |
| `build_assalto.js` | ⚠️ OBSOLETO (usava AISP grossa/bugada; substituído por build_bairro_crime) |

### Dados-fonte persistidos (`~/aluguel_rj/data/`)
`bairros.geojson` (166 bairros Rio, do arcgis pgeo3), `cisp.kml` (137 delegacias), `isp_cisp.csv` (crime ISP), `pop_aisp.csv` (população p/ per-capita).
Fora do data/: `~/favelas.json` (1010 favelas SABREN), `tiroteios_rj.csv`, `grupos_armados.geojson` (681 comunidades por facção), `aisp.geojson`/`bairros_crime.geojson` (gerados).

---

## 🛡️ As 5 camadas de segurança
1. **Favela + buffer** (SABREN, só município Rio) — `dist_favela`, `morro`. Faixas: <150m🔴/<400m🟠/<800m🟡/>800m🟢.
2. **Assalto** (ISP roubo a transeunte, per capita/100mil por bairro) — `taxa_assalto_bairro`.
3. **Mortalidade** (ISP letalidade violenta, per capita) — `taxa_mort_bairro`. ⚠️ assalto ≠ mortalidade (Tijuca=muito assalto/pouca morte).
4. **Tiroteio** (Fogo Cruzado, DENSIDADE não per-capita) — `tiros_300/1km/2km`. Não existe distância segura de fuzil (bala perdida 1-3km) → o que vale é FREQUÊNCIA.
5. **Grupos armados** (GENI ~2020) — `grupos_armados.geojson`, comunidades por CV/Milícia/TCP/ADA.

## 📊 Views SQL
- `candidatos_unicos` — is_primary=1 + cortes (≤2200, m²>25, foto, pet≠0, fora favela, sem comercial `NOT LIKE office/business/...`, sem quarto-compartilhado `NOT LIKE %quarto%`).
- `ranking` — candidatos no escopo (verde/amarelo/vermelho) ORDER BY nota. `vizinhos` — fora-escopo (bleed da busca).

---

## ⏰ Pipeline automática (systemd USER timers)
- `atualiza.sh` — **diário 06:00**, timer `aluguel-diario.timer`. Coleta + processa + gera saídas. Loga em `logs/`.
- `atualiza_semanal.sh` — **domingo 05:00**, timer `aluguel-semanal.timer`. Refresca tiroteios (fc_pull) + crime ISP.
- Units em `~/.config/systemd/user/`. Gerenciar: `systemctl --user list-timers`.
- ⚠️ **Linger=NO** → só roda com sessão do user ativa. P/ rodar sem login: `sudo loginctl enable-linger argo` (PENDENTE, precisa senha).
- Coluna `primeiro_visto` marca anúncio novo (badge 🆕 + filtro "só novos" no dashboard).

## 🚀 Como rodar manual
```bash
cd ~/aluguel_rj
./atualiza.sh                 # pipeline completa (re-scrape, ~15-20min)
node gera_html.js && node gera_mapa.js   # só regerar saídas
xdg-open ranking.html         # dashboard
xdg-open mapa.html            # mapa de risco
sqlite3 aluguel.db "SELECT * FROM ranking LIMIT 20"
```

## ⚙️ Gotchas técnicos (aprendidos na marra)
- **WAF/403:** OLX/ZAP/VR/FogoCruzado/IBGE bloqueiam sem **User-Agent de navegador**. Sempre mandar UA.
- **RSC (`self.__next_f`)** é o padrão novo (OLX/ZAP/VR/CNM): concatenar chunks, desescapar, bracket-match. Só QuintoAndar usa `__NEXT_DATA__` clássico.
- **AISP era grossa/bugada** (polígonos de 100km) → crime é por **bairro via CISP** agora.
- **Per-capita:** assalto/mortalidade DIVIDIR por população (senão área grande/populosa parece pior). Tiroteio NÃO (densidade local).
- **Fogo Cruzado:** credenciais em `~/.env` (chmod 600, NUNCA na memória/git). API v2, pandas não compila no py3.14 → usar urllib stdlib. Dado 2087/12m está COMPLETO (soma das 57 cidades bate).
- **py3.14** — usar o venv em `~/aluguel_rj/venv` só pro fc_pull.

## 📋 Pendências / roadmap (ver memória p/ detalhe)
1. **Expandir escopo:** Rio-município inteiro (coleta nível ZONA, não 14 bairros) → Niterói/SG (falta favela+bairro: tentar IBGE aglomerados subnormais; GENI grupos já cobre 118 comunidades do lado de lá).
2. **Mais sites** (Imovelweb/Loft/etc) — só se passarem dado localizável.
3. **Pesos de risco no ranking** — hoje só favela pesa; meter assalto/mortalidade/tiroteio/milícia.
4. **Geocodar OLX** — ~parte sem coordenada (via CEP da página individual).
5. **Mapa de transporte** — estações trem/metrô + tempo até Santo Cristo.
6. **Colocar online** — deploy do dashboard+mapa.
7. **Enable linger** (sudo) p/ pipeline rodar sem login.

## 📄 Docs
- `SCHEMA_FONTES.md` — como cada site é raspado (URLs, campos).
- `AREAS_BOAS_RJ.md` — pesquisa de bairros bons/armadilhas (milícia, assalto).
- `schema.html` — dicionário de dados visual do banco.
