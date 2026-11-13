variable "region" {
  description = "Région AWS du jeu."
  type        = string
  default     = "eu-west-3"
}

# Zone fixe : changer de zone remplace le sous-réseau et le serveur.
variable "availability_zone" {
  description = "Zone de disponibilité du sous-réseau et du serveur de jeu."
  type        = string
  default     = "eu-west-3a"
}

variable "domain" {
  description = "Domaine du jeu (géré par Cloudflare)."
  type        = string
  default     = "winorwipe.com"
}

# Burstable en mode unlimited : la machine accumule des crédits CPU hors partie et les dépense en partie ; au-delà, le
# surplus est facturé (surveillé par l'alerte de budget). Passer à c7g.medium si la charge reste élevée.
variable "server_instance_type" {
  description = "Type d'instance du serveur de jeu (ARM/Graviton)."
  type        = string
  default     = "t4g.small"
}

variable "server_volume_gb" {
  description = "Taille du disque du serveur de jeu, en Go."
  type        = number
  default     = 20
}
