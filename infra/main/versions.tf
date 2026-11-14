# Infrastructure du jeu (réseau, serveur de jeu, bucket des assets, zone Cloudflare). Appliquée par la pipeline de
# déploiement (rôle arena-github-deploy) ; sur le poste, seulement terraform plan.
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "arena"
      ManagedBy = "terraform"
      Stack     = "main"
    }
  }
}

# Jeton lu dans CLOUDFLARE_API_TOKEN (jamais dans le code ni dans le plan enregistré) : jeton de lecture pour les
# plans (secret de dépôt CLOUDFLARE_API_TOKEN_READ ; sur le poste, trousseau macOS « cloudflare-api-token-read »),
# jeton d'écriture pour l'apply (secret CLOUDFLARE_API_TOKEN de l'environnement production).
provider "cloudflare" {}
