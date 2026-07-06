# Schema de extração por fonte — Aluguel RJ

Como cada site é coletado, onde vivem os dados, e quais campos saem. Todos os coletores
concatenam o payload, extraem um array de anúncios e fazem UPSERT na tabela `anuncios`
(namespace de `list_id` por fonte pra não colidir).

| Fonte | `list_id` base | Script |
|---|---|---|
| OLX | `< 2e9` (nativo) | `coleta_olx.js` |
| QuintoAndar | `2e12 + id` | `coleta_qa.js` + `enrich_qa.js` |
| ChavesNaMão | `3e12 + id` | `coleta_cnm.js` |
| ZAP | `4e12 + id` | `coleta_zap.js` |
| VivaReal | `5e12 + id` | `coleta_vivareal.js` |

---

## 1. OLX
- **URL busca:** `https://www.olx.com.br/imoveis/aluguel/estado-rj/rio-de-janeiro-e-regiao/{regiao}/{slug}?o={pág}`
- **Onde o dado vive:** React Server Components — `self.__next_f.push([1,"…"])` (11 pushes).
- **Extração:** concatena todos os pushes[1] desescapando (`JSON.parse('"'+payload+'"')`), depois bracket-match no `"ads":[…]` (o array cruza 2 chunks → por isso concatenar antes). 50 ads/página.
- **Campos (do objeto ad):** `subject`→titulo, `priceValue`→aluguel, `oldPrice`→baixou_preco, `listId`, `url`, `imageCount`→n_fotos, `locationDetails.neighbourhood`→bairro, `categoryName`→categoria, `properties[]`: `condominio`, `iptu`, `size`→m², `rooms`→quartos, `bathrooms`, `garage_spaces`→vagas, `re_features`→**area_servico** (contém "Área de serviço"), `re_complex_features`→**pet** (contém "Permitido animais").
- **Anti-bot:** 403 por throttle → backoff+retry, delays 2.5–6s + jitter.
- **Buracos:** SEM rua, SEM coordenadas, SEM descrição (ficam na página individual, via CEP).

## 2. ZAP
- **URL busca:** `https://www.zapimoveis.com.br/aluguel/imoveis/rj+rio-de-janeiro+{regiao}+{slug}/?pagina={pág}`
- **Onde o dado vive:** RSC — array `"listings":[…]` (30/página).
- **Campos:** `id`, `prices.rental`{`value`→aluguel, `condominium`, `iptu`}, `title`, `href`→url, `address`{`street`+`streetNumber`→rua, `neighborhood`, `coordinates`{`latitude`,`longitude`}→**coords**}, `amenities`{`usableAreas`→m², `bedrooms`→quartos, `bathrooms`, `suites`, `parkingSpaces`→vagas, `values[]`→**area_servico** (SERVICE_AREA)}, `medias.images`→n_fotos, `description`, `condominiumName`→prédio, `unitType`→tipo.
- **Buracos:** SEM campo pet. Região errada em `vila-da-penha`/`vila-isabel` → 404 (VivaReal cobriu).

## 3. VivaReal
- **URL busca:** `https://www.vivareal.com.br/aluguel/rj/rio-de-janeiro/{regiao}/{slug}/?pagina={pág}`
- **Idêntico ao ZAP** (mesmo grupo, mesmo código RSC `listings`). Coletor é cópia do ZAP com URL/id/fonte trocados.
- **Mesmos campos e buracos** do ZAP. Coords + rua+nº 100%.

## 4. QuintoAndar (2 passos)
- **Busca:** `https://www.quintoandar.com.br/alugar/imovel/{slug}-rio-de-janeiro-rj-brasil/casa-apartamento`
  - **Dado:** ld+json `@type: Apartment|House` (~12/página, só a 1ª). Campos: `name`→titulo, `url`→id, `address`→rua, `description`, `floorSize`→m², `numberOfBedrooms`→quartos, `numberOfFullBathrooms`→banheiros, `potentialAction.price`→aluguel.
- **Enriquecimento (`enrich_qa.js`, página individual):** `__NEXT_DATA__` tem objeto com `condoPrice`→condominio, `iptu`, `totalCost`, `area`, `address`{`lat`,`lng`→coords, `street`, `zipCode`}, `condominium.name`→prédio + `images`→**thumb**, `type`.
- **Buracos:** `acceptsPet` não veio no JSON (pet fica desconhecido). Só página 1 da busca.

## 5. ChavesNaMão
- **URL busca:** `https://www.chavesnamao.com.br/imoveis-para-alugar/rj-rio-de-janeiro/{slug}/`
- **Onde o dado vive:** RSC — array `"itemsForTracking":[…]` (~14/página, só a 1ª).
- **Campos:** `id`, `title`→titulo (regex extrai rua/m²/quartos do texto), `url`, `prices.rawPrice`→aluguel, `transaction` (filtra RENT), `realtyType.name`→categoria (filtra residencial), `location.neighborhoodName`→bairro.
- **Buracos:** SEM condomínio/iptu/coords/pet/fotos; rua só ~36% (extraída do título).

---

## Padrões comuns
- **User-Agent de navegador** + headers `sec-fetch-*` pra passar 403.
- **RSC (`self.__next_f`)** é o padrão novo (OLX/ZAP/VR/CNM). `__NEXT_DATA__` clássico só sobrou no QA. ld+json onde disponível.
- **Namespace de id por fonte** evita colisão no `list_id` (PK).
- **Coletar tudo, filtrar em SQL** (views) — nunca descartar por falta de dado.
- **Escopo:** 14 bairros-alvo (núcleo Méier–Todos os Santos–Cachambi + Tijuca/região).
