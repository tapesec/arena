# Alerte de budget mensuelle : e-mails à 50 %, 80 % et 100 % de la dépense réelle, et à 100 % de la dépense prévue.
resource "aws_budgets_budget" "monthly" {
  name         = "arena-mensuel"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Coût réel, sans déduire les crédits AWS ni les remboursements : sinon l'alerte ne part jamais tant qu'il reste des
  # crédits.
  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
