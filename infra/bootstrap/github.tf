# GitHub Actions s'authentifie auprès d'AWS par OIDC : aucune clé d'accès stockée dans GitHub.
#
# Règles pour les workflows (dépôt public) :
# - jamais de déclencheur pull_request_target, issue_comment ou workflow_run qui exécute du code d'une PR avec un
#   rôle AWS : un terraform plan exécute du code (providers, data "external") ;
# - l'environnement GitHub « production » doit exiger une validation manuelle (sans auto-validation), n'accepter que
#   la branche main et ne pas laisser les administrateurs contourner ces règles ; main est protégée.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_sub = "repo:${var.github_repository}"
}

# Rôle de lecture : terraform plan sur les pull requests internes (une PR venant d'un fork ne reçoit pas de jeton
# OIDC) et sur main. Lecture seule, sans accès aux données sensibles (voir plan_deny_secrets). Les plans de PR se font
# sans verrou (-lock=false) : ce rôle ne peut rien écrire, pas même le verrou de l'état.
data "aws_iam_policy_document" "plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.github_sub}:pull_request", "${local.github_sub}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "arena-github-plan"
  description          = "GitHub Actions - terraform plan (lecture seule)"
  assume_role_policy   = data.aws_iam_policy_document.plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess lit aussi des secrets (paramètres SSM, variables des Lambda, données des tables, objets S3…) :
# interdits explicitement. Seul l'état Terraform reste lisible dans S3.
data "aws_iam_policy_document" "plan_deny_secrets" {
  statement {
    sid    = "PasDeSecrets"
    effect = "Deny"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:GetParameterHistory",
      "secretsmanager:GetSecretValue",
      "lambda:GetFunction",
      "ec2:GetConsoleOutput",
      "ec2:GetConsoleScreenshot",
      "ec2:GetPasswordData",
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      # Adresse e-mail des abonnements aux alertes.
      "sns:GetSubscriptionAttributes",
      "sns:ListSubscriptions",
      "sns:ListSubscriptionsByTopic",
    ]
    resources = ["*"]
  }

  # Seul l'état de infra/main : celui du socle contient l'adresse e-mail des alertes.
  statement {
    sid           = "S3SeulementEtat"
    effect        = "Deny"
    actions       = ["s3:GetObject", "s3:GetObjectVersion"]
    not_resources = ["${aws_s3_bucket.state.arn}/main/*"]
  }
}

resource "aws_iam_role_policy" "plan_deny_secrets" {
  name   = "pas-de-secrets"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_deny_secrets.json
}

# Rôle de déploiement : terraform apply et mise en ligne, seulement depuis l'environnement GitHub « production »
# (protégé par une validation manuelle). Droits d'administration pour l'instant : ils seront réduits quand
# l'infrastructure sera stable.
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.github_sub}:environment:production"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "arena-github-deploy"
  description          = "GitHub Actions - terraform apply et deploiement (environnement production)"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy_admin" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Le déploiement ne peut pas toucher au socle : ses propres rôles et leur confiance, la connexion OIDC, la
# configuration du bucket d'état, l'alerte de budget, ni le sujet des alertes et son abonnement. Seul l'administrateur le fait, depuis infra/bootstrap.
data "aws_iam_policy_document" "deploy_protect_bootstrap" {
  statement {
    sid     = "RolesEtOidc"
    effect  = "Deny"
    actions = ["iam:*"]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/arena-github-*",
      aws_iam_openid_connect_provider.github.arn,
    ]
  }

  statement {
    sid    = "BucketEtat"
    effect = "Deny"
    actions = [
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:PutBucketPolicy",
      "s3:PutBucketVersioning",
      "s3:PutLifecycleConfiguration",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutEncryptionConfiguration",
      "s3:PutBucketOwnershipControls",
    ]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    sid    = "AlertesSujet"
    effect = "Deny"
    actions = [
      "sns:DeleteTopic",
      "sns:SetTopicAttributes",
      "sns:AddPermission",
      "sns:RemovePermission",
      "sns:PutDataProtectionPolicy",
      "sns:Subscribe",
      "sns:ListSubscriptionsByTopic",
    ]
    resources = [aws_sns_topic.alerts.arn]
  }

  # Actions sur les abonnements (ressource = abonnement, ou aucune) : infra/main n'utilise pas SNS.
  statement {
    sid    = "AlertesAbonnements"
    effect = "Deny"
    actions = [
      "sns:Unsubscribe",
      "sns:SetSubscriptionAttributes",
      "sns:GetSubscriptionAttributes",
      "sns:ListSubscriptions",
    ]
    resources = ["*"]
  }

  # L'état du socle (adresse e-mail des alertes) : jamais lu par la CI.
  statement {
    sid       = "EtatDuSocle"
    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/bootstrap/*"]
  }

  statement {
    sid       = "Budget"
    effect    = "Deny"
    actions   = ["budgets:ModifyBudget", "budgets:DeleteBudgetAction", "budgets:UpdateBudgetAction"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy_protect_bootstrap" {
  name   = "proteger-le-socle"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_protect_bootstrap.json
}
