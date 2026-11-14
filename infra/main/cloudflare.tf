# Adresses de Cloudflare, publiées par Cloudflare (sans authentification). Le serveur de jeu et le bucket des assets
# ne répondent qu'à elles : les joueurs passent forcément par le CDN.
data "http" "cloudflare_ips" {
  url = "https://api.cloudflare.com/client/v4/ips"

  retry {
    attempts = 3
  }

  # Une réponse vide ou tronquée supprimerait toutes les règles d'entrée : le plan s'arrête plutôt.
  lifecycle {
    postcondition {
      condition = (
        self.status_code == 200 &&
        try(jsondecode(self.response_body).success, false) &&
        length(try(jsondecode(self.response_body).result.ipv4_cidrs, [])) > 0 &&
        length(try(jsondecode(self.response_body).result.ipv6_cidrs, [])) > 0
      )
      error_message = "Impossible de lire la liste des adresses de Cloudflare."
    }
  }
}

locals {
  cloudflare_ipv4 = jsondecode(data.http.cloudflare_ips.response_body).result.ipv4_cidrs
  cloudflare_ipv6 = jsondecode(data.http.cloudflare_ips.response_body).result.ipv6_cidrs
}

# Zone du domaine (créée à la main dans Cloudflare avec le domaine ; Terraform ne gère que son contenu).
data "cloudflare_zone" "main" {
  filter = {
    name = var.domain
  }
}

# Le jeu et ses assets, derrière le proxy de Cloudflare (CDN, certificat public, IP d'origine masquée : marquée
# sensible pour ne pas paraître dans les plans, publics).
resource "cloudflare_dns_record" "game" {
  zone_id = data.cloudflare_zone.main.id
  name    = var.domain
  type    = "A"
  content = sensitive(aws_eip.server.public_ip)
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "assets" {
  zone_id = data.cloudflare_zone.main.id
  name    = "assets.${var.domain}"
  type    = "CNAME"
  content = aws_s3_bucket_website_configuration.assets.website_endpoint
  proxied = true
  ttl     = 1
}

# Cloudflare -> serveur de jeu en HTTPS vérifié (certificat Origin CA installé par deploy/install.sh), et visiteurs
# toujours redirigés vers HTTPS.
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = data.cloudflare_zone.main.id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = data.cloudflare_zone.main.id
  setting_id = "always_use_https"
  value      = "on"
}

# Exception pour assets.<domaine> : l'adresse « site web » de S3 ne répond qu'en HTTP (le trajet visiteur -> Cloudflare
# reste en HTTPS).
resource "cloudflare_ruleset" "config" {
  zone_id = data.cloudflare_zone.main.id
  name    = "arena - configuration"
  kind    = "zone"
  phase   = "http_config_settings"
  rules = [{
    description = "Assets S3 (site web en HTTP seulement)"
    expression  = "(http.host eq \"assets.${var.domain}\")"
    action      = "set_config"
    action_parameters = {
      ssl = "flexible"
    }
    enabled = true
  }]
}

# Les assets ont des noms à empreinte (jamais modifiés) : tout est mis en cache, y compris les types que Cloudflare
# ne met pas en cache d'office (.glb, .fbx, .m4a, .json), pour la durée annoncée par S3 (un an).
resource "cloudflare_ruleset" "cache" {
  zone_id = data.cloudflare_zone.main.id
  name    = "arena - cache"
  kind    = "zone"
  phase   = "http_request_cache_settings"
  rules = [{
    description = "Assets a empreinte"
    expression  = "(http.host eq \"assets.${var.domain}\")"
    action      = "set_cache_settings"
    action_parameters = {
      cache = true
      edge_ttl = {
        mode = "respect_origin"
      }
      browser_ttl = {
        mode = "respect_origin"
      }
    }
    enabled = true
  }]
}

# CORS des assets posé par Cloudflare sur toutes les réponses : le cache ne distingue pas les requêtes selon leur en-tête
# Origin, une réponse de S3 sans CORS mise en cache casserait le client.
resource "cloudflare_ruleset" "response_headers" {
  zone_id = data.cloudflare_zone.main.id
  name    = "arena - en-tetes de reponse"
  kind    = "zone"
  phase   = "http_response_headers_transform"
  rules = [{
    description = "CORS des assets pour le jeu"
    expression  = "(http.host eq \"assets.${var.domain}\")"
    action      = "rewrite"
    action_parameters = {
      headers = {
        "Access-Control-Allow-Origin" = {
          operation = "set"
          value     = "https://${var.domain}"
        }
      }
    }
    enabled = true
  }]
}
