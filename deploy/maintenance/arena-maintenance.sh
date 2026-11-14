#!/bin/bash
# Chaque nuit à 4 h, heure de Paris (arena-maintenance.timer), après les mises à jour de sécurité de 3 h 30 (l'unité
# attend la fin de dnf-automatic et d'un déploiement en cours) : redémarre la machine si une mise à jour l'exige
# (noyau, glibc, systemd…), sinon redémarre seulement nginx et le serveur de jeu s'ils utilisent encore une
# bibliothèque remplacée. Les parties en cours sont coupées dans les deux cas. Toute erreur fait échouer l'unité
# (visible dans journalctl -u arena-maintenance) au lieu de redémarrer à l'aveugle.
set -uo pipefail

# Code 1 + message = redémarrage nécessaire ; tout autre code non nul est une erreur de dnf.
out=$(dnf -q needs-restarting -r 2>&1); rc=$?
if [ $rc -eq 1 ] && grep -q "Reboot is required" <<< "$out"; then
  echo "Redémarrage de la machine (mise à jour du noyau ou d'une bibliothèque centrale)."
  systemctl reboot
  exit 0
elif [ $rc -ne 0 ]; then
  echo "needs-restarting -r a échoué ($rc) : $out"
  exit 1
fi

services=$(dnf -q needs-restarting -s) || { echo "needs-restarting -s a échoué."; exit 1; }
status=0
for service in nginx arena; do
  if grep -qx "$service.service" <<< "$services"; then
    echo "Redémarrage de $service (bibliothèque mise à jour)."
    systemctl restart "$service" || status=1
  fi
done

# Le serveur de jeu doit répondre après un redémarrage.
if grep -qx "arena.service" <<< "$services"; then
  for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:2567/ && exit $status; sleep 1; done
  echo "Le serveur de jeu ne répond pas après son redémarrage."
  exit 1
fi
exit $status
