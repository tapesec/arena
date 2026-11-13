# État dans le bucket créé par le socle (infra/bootstrap). Le nom du bucket, qui contient le numéro du compte, n'est
# pas versionné : terraform init -backend-config="bucket=arena-tfstate-<compte>".
terraform {
  backend "s3" {
    key          = "main/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}
