#!/bin/bash
# Envoie une alerte par e-mail (sujet SNS arena-alerts, créé par infra/bootstrap) quand un service surveillé échoue :
# lancé par systemd (OnFailure= -> arena-alert@<service>.service), avec le rôle IAM de l'instance.
#   arena-alert <unité en échec>
set -euo pipefail

unit=$1
imds() {
  local token
  token=$(curl -fsS --max-time 5 --retry 3 --retry-connrefused -X PUT http://169.254.169.254/latest/api/token \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -fsS --max-time 5 --retry 3 --retry-connrefused -H "X-aws-ec2-metadata-token: $token" \
    "http://169.254.169.254/latest/$1"
}
identity=$(imds dynamic/instance-identity/document) || { echo "Alerte non envoyée : métadonnées de l'instance illisibles." >&2; exit 1; }
region=$(jq -r .region <<< "$identity")
account=$(jq -r .accountId <<< "$identity")

message=$(
  echo "Le service $unit a échoué sur le serveur de Win or Wipe ($(date -u '+%Y-%m-%d %H:%M UTC'))."
  echo
  echo "Dernières lignes du journal (journalctl -u $unit) :"
  echo
  journalctl -u "$unit" -n 40 --no-pager -o short-iso 2>&1 || true
)
aws sns publish --region "$region" --topic-arn "arn:aws:sns:$region:$account:arena-alerts" \
  --subject "Win or Wipe : échec de ${unit:0:70}" --message "$message" --output text --query MessageId
