# État du socle dans le bucket qu'il a créé (migré après le premier apply). Le nom du bucket, qui contient le numéro
# du compte, n'est pas versionné : terraform init -backend-config="bucket=arena-tfstate-<compte>".
terraform {
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}
