#!/bin/bash
# Pipeline diária: re-coleta aluguéis das 5 fontes -> enriquece -> dedup -> risco -> ranking -> HTML/mapa.
# Marca anúncios novos (primeiro_visto). Camadas de risco recalculam (dados-fonte em data/, estáticos).
# Tiroteios (Fogo Cruzado) e ISP: refresh semanal via atualiza_semanal.sh.
cd /home/argo/aluguel_rj || exit 1
mkdir -p logs
LOG="logs/atualiza_$(date +%F).log"
exec >>"$LOG" 2>&1
echo "========== $(date '+%F %T') INÍCIO =========="
N=node

step(){ echo "--- $1  $(date +%T)"; $N "$1.js" ${2:-} || echo "!! FALHOU $1"; }

# 1) coleta das 5 fontes (cada uma tem backoff/anti-403 próprio; sequencial p/ não bater no mesmo grupo)
for c in coleta_olx coleta_zap coleta_vivareal coleta_qa coleta_cnm; do
  echo "--- $c  $(date +%T)"; $N "$c.js" || echo "!! FALHOU $c"
done

# 2) enriquece QuintoAndar (páginas individuais: pet/mobiliado/cozinha/coords/custo)
step enrich_qa

# 3) marca os NOVOS de hoje (inseridos agora ainda estão sem primeiro_visto)
sqlite3 aluguel.db "UPDATE anuncios SET primeiro_visto=date('now') WHERE primeiro_visto IS NULL;"
NOVOS=$(sqlite3 aluguel.db "SELECT count(*) FROM anuncios WHERE primeiro_visto=date('now');")
TOTAL=$(sqlite3 aluguel.db "SELECT count(*) FROM anuncios;")
echo ">> NOVOS hoje: $NOVOS  | total no banco: $TOTAL"

# 4) processamento: dedup -> consolida -> risco -> ranking
for s in dedup merge_grupos sabren buffer build_bairro_crime tiros_freq rank; do step "$s"; done

# 5) saídas visuais
step gera_html
step gera_mapa

# 6) sync online: empurra os imóveis pro Supabase (dashboard web). Só roda se houver .env.
if [ -f web/.env ]; then
  echo "--- push_to_supabase  $(date +%T)"
  $N web/sync/push_to_supabase.js || echo "!! FALHOU push_to_supabase"
else
  echo "--- push_to_supabase: pulado (sem web/.env)"
fi

echo "========== $(date '+%F %T') FIM ($NOVOS novos) =========="
