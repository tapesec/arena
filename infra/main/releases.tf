data "aws_caller_identity" "current" {}

# Versions du serveur de jeu (archives construites par la CI) : privé, lu par le serveur au déploiement. Les archives
# sont gardées 30 jours (de quoi revenir en arrière).
resource "aws_s3_bucket" "releases" {
  bucket = "arena-releases-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_ownership_controls" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "releases" {
  bucket                  = aws_s3_bucket.releases.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    id     = "anciennes-versions"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "releases" {
  bucket = aws_s3_bucket.releases.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "HttpsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.releases.arn, "${aws_s3_bucket.releases.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.releases]
}

# Le serveur lit les archives des versions et le certificat Origin CA de Cloudflare (paramètres SSM chiffrés
# /arena/origin/*, créés à la main : ils ne passent ni par Terraform ni par la CI), écrit ses événements de jeu
# (observability.tf) et publie ses alertes (sujet SNS arena-alerts, créé par infra/bootstrap).
resource "aws_iam_role_policy" "server_deploy" {
  name = "deploiement"
  role = aws_iam_role.server.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadReleases"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.releases.arn}/releases/*"
      },
      {
        Sid      = "ReadOriginCertificate"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/arena/origin/*"
      },
      {
        Sid      = "DecryptOriginCertificate"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${var.region}.amazonaws.com" }
        }
      },
      {
        Sid    = "WriteGameEvents"
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
        # Le groupe et ses flux (arn:…:log-group:/arena/events:log-stream:…).
        Resource = ["${aws_cloudwatch_log_group.events.arn}", "${aws_cloudwatch_log_group.events.arn}:*"]
      },
      {
        Sid      = "PublishAlerts"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = "arn:aws:sns:${var.region}:${data.aws_caller_identity.current.account_id}:arena-alerts"
      },
    ]
  })
}
