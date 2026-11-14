# Assets de production (modèles, sons, musique), envoyés par le script deploy-assets. Servis aux joueurs par
# Cloudflare depuis l'adresse « site web » du bucket : son nom doit être le nom d'hôte (assets.<domaine>) pour que
# Cloudflare le serve sans réécrire l'en-tête Host. Lecture publique, mais seulement depuis les adresses de Cloudflare.
# Côté Cloudflare (SSL Flexible et en-tête CORS pour assets.<domaine>) : voir cloudflare.tf.
resource "aws_s3_bucket" "assets" {
  bucket = "assets.${var.domain}"
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Les ACL publiques restent bloquées ; seule la politique du bucket (limitée à Cloudflare) ouvre la lecture.
resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

# Envois interrompus (gros fichiers audio et modèles) supprimés au bout de 7 jours.
resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    id     = "envois-interrompus"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_website_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  index_document {
    suffix = "index.html"
  }
}

# Le client, servi par winorwipe.com, charge les assets depuis assets.winorwipe.com.
resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["https://${var.domain}"]
    allowed_headers = ["*"]
    max_age_seconds = 86400
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudflareRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.assets.arn}/*"
      Condition = {
        IpAddress = { "aws:SourceIp" = concat(local.cloudflare_ipv4, local.cloudflare_ipv6) }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.assets]
}
