#!/bin/bash
# Installe une version du serveur de jeu sur l'EC2 (Amazon Linux 2023), lancé en root par la CI via Session Manager :
#   install.sh <dossier de la version extraite>
# Idempotent : installe Node 22 et nginx au premier passage, met le certificat Origin CA à jour depuis SSM
# (/arena/origin/certificate et /arena/origin/private-key, créés à la main), installe les dépendances, bascule
# /opt/arena/current sur la nouvelle version et redémarre le service. Si le serveur ne répond pas, revient à la
# version précédente et échoue.
set -euo pipefail

RELEASE_DIR=$(realpath "$1")
BASE=/opt/arena
REGION=$(TOKEN=$(curl -sS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60") \
  && curl -sS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)

echo "== Paquets système"
dnf install -y -q nodejs22 nodejs22-npm nginx
# « node » (scripts d'installation des dépendances) = Node 22.
alternatives --set node /usr/bin/node-22 >/dev/null 2>&1 || true
[ "$(node -v)" = "$(node-22 -v)" ] || { echo "« node » n'est pas Node 22"; exit 1; }
id arena >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /sbin/nologin arena

echo "== Certificat Origin CA"
install -d -m 750 -o root -g nginx /etc/nginx/arena
param() { aws ssm get-parameter --region "$REGION" --with-decryption --name "$1" --query Parameter.Value --output text; }
umask 077
param /arena/origin/certificate > /etc/nginx/arena/origin.pem.new
param /arena/origin/private-key > /etc/nginx/arena/origin.key.new
chgrp nginx /etc/nginx/arena/origin.pem.new /etc/nginx/arena/origin.key.new
chmod 640 /etc/nginx/arena/origin.pem.new /etc/nginx/arena/origin.key.new
mv /etc/nginx/arena/origin.pem.new /etc/nginx/arena/origin.pem
mv /etc/nginx/arena/origin.key.new /etc/nginx/arena/origin.key
umask 022

echo "== nginx"
install_nginx() {
  install -m 644 "$1/deploy/nginx.conf" /etc/nginx/conf.d/arena.conf
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}
install_nginx "$RELEASE_DIR"

echo "== Dépendances du serveur"
cd "$RELEASE_DIR"
npm-22 ci --omit=dev --workspace @arena/server --no-audit --no-fund --loglevel=error
chown -R root:root "$RELEASE_DIR"

echo "== Bascule et redémarrage"
PREVIOUS=$(readlink "$BASE/current" || true)
if [ "$PREVIOUS" = "$RELEASE_DIR" ]; then echo "Cette version est déjà en service"; exit 1; fi
activate() {
  install -m 644 "$1/deploy/arena.service" /etc/systemd/system/arena.service
  systemctl daemon-reload
  ln -sfn "$1" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
  systemctl enable arena
  systemctl restart arena
}
activate "$RELEASE_DIR"

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null http://127.0.0.1:2567/ && return 0
    sleep 1
  done
  return 1
}
if ! healthy; then
  echo "Le serveur ne répond pas :"
  journalctl -u arena -n 50 --no-pager || true
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    echo "Retour à la version précédente : $PREVIOUS"
    install_nginx "$PREVIOUS"
    activate "$PREVIOUS"
    rm -rf "$RELEASE_DIR"
    healthy && echo "Version précédente rétablie." || echo "La version précédente ne répond pas non plus."
  fi
  exit 1
fi

echo "== Nettoyage (trois dernières versions gardées, dont celle en service)"
ls -1dt "$BASE"/releases/*/ | tail -n +4 | while read -r old; do
  [ "$(realpath "$old")" = "$RELEASE_DIR" ] || rm -rf "$old"
done
echo "Version en ligne : $RELEASE_DIR"
