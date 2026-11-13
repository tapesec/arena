output "state_bucket" {
  description = "Bucket de l'état Terraform (backend de infra/main)."
  value       = aws_s3_bucket.state.bucket
}

output "plan_role_arn" {
  description = "Rôle endossé par GitHub Actions pour terraform plan."
  value       = aws_iam_role.plan.arn
}

output "deploy_role_arn" {
  description = "Rôle endossé par GitHub Actions pour déployer (environnement production)."
  value       = aws_iam_role.deploy.arn
}
