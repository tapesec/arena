variable "region" {
  description = "Région AWS du jeu."
  type        = string
  default     = "eu-west-3"
}

variable "github_repository" {
  description = "Dépôt GitHub autorisé à déployer (propriétaire/nom)."
  type        = string
  default     = "tapesec/arena"
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
