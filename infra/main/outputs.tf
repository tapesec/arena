# Masquée dans les journaux (publics) : derrière le proxy de Cloudflare, l'adresse d'origine ne doit pas circuler.
# Lecture : terraform output -raw server_ip.
output "server_ip" {
  description = "Adresse publique du serveur de jeu (entrée DNS « A » de Cloudflare)."
  value       = aws_eip.server.public_ip
  sensitive   = true
}

output "server_instance_id" {
  description = "Identifiant du serveur de jeu (Session Manager : aws ssm start-session --target <id>)."
  value       = aws_instance.server.id
}

output "assets_bucket" {
  description = "Bucket des assets de production (cible de deploy-assets)."
  value       = aws_s3_bucket.assets.bucket
}

output "assets_origin" {
  description = "Adresse site web du bucket (entrée DNS « CNAME » assets de Cloudflare)."
  value       = aws_s3_bucket_website_configuration.assets.website_endpoint
}

output "releases_bucket" {
  description = "Bucket des versions du serveur de jeu (archives envoyées par la CI)."
  value       = aws_s3_bucket.releases.bucket
}

output "origin_pull_ca" {
  description = "Autorité (publique) du certificat client que Cloudflare présente au serveur de jeu ; nginx n'accepte que les certificats qu'elle a signés."
  value       = tls_self_signed_cert.origin_pull_ca.cert_pem
}

output "origin_pull_certificate_id" {
  description = "Identifiant du certificat dans Cloudflare (la pipeline attend qu'il soit actif avant d'installer)."
  value       = cloudflare_authenticated_origin_pulls_certificate.main.id
}

output "cloudflare_zone_id" {
  description = "Identifiant de la zone Cloudflare."
  value       = data.cloudflare_zone.main.id
}
