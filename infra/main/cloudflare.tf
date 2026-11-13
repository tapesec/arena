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
