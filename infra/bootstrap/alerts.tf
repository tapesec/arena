# Alertes du serveur de jeu (échec des mises à jour automatiques, de la maintenance de nuit ou du serveur de jeu),
# publiées par le serveur (deploy/alerts) et envoyées par e-mail. Dans le socle, appliqué depuis le poste : l'adresse
# (variable budget_email, non versionnée) ne passe jamais par le dépôt public ni par la CI. L'abonnement est à confirmer
# une fois, par le lien de l'e-mail envoyé par AWS.
resource "aws_sns_topic" "alerts" {
  name              = "arena-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.budget_email
}
