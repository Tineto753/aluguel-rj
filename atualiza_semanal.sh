#!/bin/bash
# Refresh SEMANAL das camadas de risco que mudam devagar: tiroteios (Fogo Cruzado) + crime ISP.
# A pipeline diária (atualiza.sh) recalcula o cruzamento; este só atualiza os dados-fonte.
cd /home/argo/aluguel_rj || exit 1
mkdir -p logs data
LOG="logs/semanal_$(date +%F).log"; exec >>"$LOG" 2>&1
echo "===== $(date '+%F %T') SEMANAL INÍCIO ====="
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

# 1) tiroteios Fogo Cruzado (últimos 12 meses) -> tiroteios_rj.csv
echo "--- fc_pull (tiroteios)"; ./venv/bin/python fc_pull.py || echo "!! fc_pull falhou"

# 2) base de crime ISP (por CISP) -> data/isp_cisp.csv (atualiza mensalmente na fonte)
echo "--- ISP crime"
curl -s -m120 "https://www.ispdados.rj.gov.br/Arquivos/BaseDPEvolucaoMensalCisp.csv" -o data/isp_cisp.csv.tmp -w "  http %{http_code} %{size_download}b\n"
[ -s data/isp_cisp.csv.tmp ] && mv data/isp_cisp.csv.tmp data/isp_cisp.csv
curl -s -m120 "https://www.ispdados.rj.gov.br/Arquivos/PopulacaoEvolucaoMensalCisp.csv" -o data/pop_aisp.csv.tmp -w "  pop http %{http_code}\n"
[ -s data/pop_aisp.csv.tmp ] && mv data/pop_aisp.csv.tmp data/pop_aisp.csv

echo "===== $(date '+%F %T') SEMANAL FIM ====="
