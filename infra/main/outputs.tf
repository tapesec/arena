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
