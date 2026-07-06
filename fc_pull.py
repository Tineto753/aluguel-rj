#!/usr/bin/env python3
# Puxa tiroteios do Fogo Cruzado via API v2 (stdlib only). Lê credenciais de ~/.env.
import json, urllib.request, urllib.parse, os, sys, csv, datetime

BASE = "https://api-service.fogocruzado.org.br/api/v2"

def load_env(p):
    d = {}
    for line in open(p):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); d[k] = v
    return d

def req(url, data=None, token=None, method=None):
    headers = {"Content-Type": "application/json", "Accept": "application/json",
               "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
    if token: headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, headers=headers, method=method or ("POST" if data else "GET"))
    with urllib.request.urlopen(r, timeout=40) as resp:
        return json.loads(resp.read().decode())

env = load_env(os.path.expanduser("~/.env"))
# 1) login
try:
    auth = req(BASE + "/auth/login", {"email": env["FOGOCRUZADO_EMAIL"], "password": env["FOGOCRUZADO_PASSWORD"]})
except Exception as e:
    print("LOGIN FALHOU:", e); sys.exit(1)
token = (auth.get("data") or auth).get("accessToken") or auth.get("accessToken")
print("login OK, token:", "sim" if token else "NÃO", "| chaves:", list((auth.get("data") or auth).keys())[:6])
if not token: print(json.dumps(auth)[:300]); sys.exit(1)

# 2) states -> achar RJ
states = req(BASE + "/states", token=token)
sl = states.get("data", states)
rj = next((s for s in sl if "janeiro" in (s.get("name","" ).lower())), None)
print("RJ id:", rj and rj.get("id"))
if not rj: print([s.get("name") for s in sl][:10]); sys.exit(1)

# 3) occurrences último 12 meses (paginado)
fim = datetime.date.today(); ini = fim - datetime.timedelta(days=365)
rows = []; page = 1
while True:
    q = urllib.parse.urlencode({"idState": rj["id"], "initialdate": ini.isoformat(), "finaldate": fim.isoformat(), "page": page})
    j = req(BASE + "/occurrences?" + q, token=token)
    data = j.get("data", [])
    if not data: break
    for o in data:
        lat = o.get("latitude"); lon = o.get("longitude")
        if lat and lon:
            rows.append({"id": o.get("id"), "lat": lat, "lon": lon, "data": o.get("date"),
                         "mortos": (o.get("victims") and len([v for v in o["victims"] if v.get("deathDate")])) or 0,
                         "policia": o.get("policeAction"), "massacre": o.get("massacre")})
    meta = j.get("pageMeta") or j.get("meta") or {}
    print(f"  página {page}: +{len(data)} (total {len(rows)})")
    if meta.get("hasNextPage") is False or page > 200: break
    page += 1

with open(os.path.join(os.path.dirname(__file__), "tiroteios_rj.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["id","lat","lon","data","mortos","policia","massacre"]); w.writeheader(); w.writerows(rows)
print(f"\nTIROTEIOS salvos: {len(rows)} ({ini} a {fim})")
