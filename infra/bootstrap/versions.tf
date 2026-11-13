# Socle de l'infrastructure, appliqué depuis le poste de l'administrateur (jamais par la CI) : bucket de l'état
# Terraform, connexion OIDC de GitHub Actions et rôles de la CI, alerte de budget. Tout le reste (infra/main) est
# appliqué par la pipeline.
#
# Premier apply avec un état local ; ensuite, l'état est migré dans le bucket créé (bloc backend « s3 » ajouté
# après coup, puis terraform init -migrate-state).
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "arena"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
