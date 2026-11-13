# Infrastructure du jeu (réseau, serveur de jeu, bucket des assets). Appliquée par la pipeline de déploiement
# (rôle arena-github-deploy) ; sur le poste, seulement terraform plan.
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
