# Authenticated Origin Pulls : Cloudflare présente un certificat client à chaque connexion vers le serveur de jeu, et
# nginx refuse toute connexion sans lui (deploy/nginx.conf). Certificat propre à la zone (et non le certificat commun
# à tous les clients de Cloudflare) : une autre zone Cloudflare pointée sur l'IP du serveur est refusée aussi.
#
# Deux niveaux : une autorité (vingt ans), seule connue de nginx, signe le certificat feuille que Cloudflare présente
# (Cloudflare refuse une racine). La feuille est renouvelée par un plan ordinaire trente jours avant son expiration
# (early_renewal_hours) sans toucher nginx, qui fait confiance à l'autorité.
#
# Les clés privées n'existent que dans l'état Terraform (bucket privé, chiffré) et le plan enregistré (chiffré) ; le
# certificat public de l'autorité est remis au serveur par la pipeline (sortie origin_pull_ca).
resource "tls_private_key" "origin_pull_ca" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "origin_pull_ca" {
  private_key_pem = tls_private_key.origin_pull_ca.private_key_pem

  subject {
    common_name  = "Win or Wipe origin pull CA"
    organization = "Win or Wipe"
  }

  validity_period_hours = 175200
  is_ca_certificate     = true
  allowed_uses          = ["cert_signing", "crl_signing"]
}

resource "tls_private_key" "origin_pull" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_cert_request" "origin_pull" {
  private_key_pem = tls_private_key.origin_pull.private_key_pem

  subject {
    common_name  = "origin-pull.${var.domain}"
    organization = "Win or Wipe"
  }
}

resource "tls_locally_signed_cert" "origin_pull" {
  cert_request_pem   = tls_cert_request.origin_pull.cert_request_pem
  ca_private_key_pem = tls_private_key.origin_pull_ca.private_key_pem
  ca_cert_pem        = tls_self_signed_cert.origin_pull_ca.cert_pem

  # Cinq ans, remplacé trente jours avant la fin (le plan le propose de lui-même).
  validity_period_hours = 43800
  early_renewal_hours   = 720
  allowed_uses          = ["digital_signature", "key_encipherment", "client_auth"]
}

# Renouvellement : le nouveau certificat est envoyé avant la suppression de l'ancien ; Cloudflare le déploie en
# quelques minutes (pendant ce court délai il peut présenter son certificat commun, refusé par nginx).
resource "cloudflare_authenticated_origin_pulls_certificate" "main" {
  zone_id     = data.cloudflare_zone.main.id
  certificate = tls_locally_signed_cert.origin_pull.cert_pem
  private_key = tls_private_key.origin_pull.private_key_pem

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_authenticated_origin_pulls_settings" "main" {
  zone_id = data.cloudflare_zone.main.id
  enabled = true

  depends_on = [cloudflare_authenticated_origin_pulls_certificate.main]
}
