variable "region" {
  description = "Région AWS du jeu."
  type        = string
  default     = "eu-west-3"
}

variable "github_repository" {
  description = <<-EOT
    Dépôt GitHub autorisé à déployer, tel que GitHub le nomme dans le sujet de ses jetons OIDC :
    « propriétaire@id/nom@id » (identifiants numériques immuables : un dépôt recréé sous le même nom n'y a pas accès).
  EOT
  type        = string
  default     = "tapesec@4386903/arena@1456928709"
}

variable "budget_limit_usd" {
  description = "Plafond mensuel de l'alerte de budget, en dollars (AWS facture en USD)."
  type        = number
  default     = 45
}

# Donnée personnelle : renseignée dans terraform.tfvars (non versionné), jamais dans le dépôt public.
variable "budget_email" {
  description = "Adresse qui reçoit les alertes de budget."
  type        = string
  sensitive   = true
}
