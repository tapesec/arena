# Mise en ligne

Le jeu tourne sur un serveur EC2 (eu-west-3) derrière Cloudflare ; ses assets (modèles, sons, musique) sont dans le
bucket S3 `assets.winorwipe.com`, servis par Cloudflare. L'infrastructure est décrite en Terraform :

- `infra/bootstrap` : socle (bucket de l'état, accès OIDC de GitHub Actions, alerte de budget), appliqué à la main
  depuis le poste ;
- `infra/main` : réseau, serveur, buckets des assets et des versions, appliqué par la pipeline.

## Pipeline (GitHub Actions)

- `ci.yml` : typage et tests sur chaque pull request.
- `terraform-plan.yml` : plan de `infra/main` en lecture seule sur les pull requests qui le touchent.
- `deploy.yml` : à chaque push sur `main`, tests puis plan (à relire dans le résumé du run), puis, après validation
  dans l'environnement `production`, apply de `infra/main`, build du client et installation du serveur
  (`deploy/install.sh`, lancé par Session Manager : Node 22, nginx en HTTPS, service systemd `arena`).

## Réglages à faire une fois

### GitHub (Settings du dépôt)

1. **Branches** : protéger `main` (pull request obligatoire, pas de contournement par les administrateurs).
2. **Environments** : créer `production`, avec validation obligatoire (« Required reviewers », en interdisant
   l'auto-validation si d'autres personnes peuvent valider) et déploiement limité à la branche `main`.
3. **Secrets and variables → Actions** :
   secrets du dépôt (masqués dans les journaux, qui sont publics) :
   - `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` et `TF_STATE_BUCKET` (sorties de `terraform output` dans
     `infra/bootstrap`) ;
   - `VITE_SOUND_KEY` (clé des sons protégés, la même que dans `packages/client/.env.local`).
4. **Actions → General** : « Require approval for all external contributors » (les pull requests venues de forks
   n'exécutent rien sans accord).

### Certificat Origin CA (Cloudflare → AWS)

Dans Cloudflare : SSL/TLS → Origin Server → Create Certificate (noms `winorwipe.com` et `*.winorwipe.com`). Ranger
le certificat et la clé privée dans deux paramètres SSM chiffrés, lus par le serveur à chaque déploiement :

```sh
aws ssm put-parameter --profile lionnel-perso --region eu-west-3 --type SecureString \
  --name /arena/origin/certificate --value file://origin.pem
aws ssm put-parameter --profile lionnel-perso --region eu-west-3 --type SecureString \
  --name /arena/origin/private-key --value file://origin.key
```

puis supprimer les deux fichiers du poste.

### Cloudflare (une fois l'infrastructure créée)

- DNS, en mode proxy (nuage orange) : `winorwipe.com` → enregistrement `A` vers `terraform output server_ip` ;
  `assets` → `CNAME` vers `terraform output assets_origin`.
- SSL/TLS : mode **Full (strict)**.
- Règle de configuration pour `assets.winorwipe.com` : SSL **Flexible** (l'adresse site web de S3 ne parle que HTTP).
- Règle de modification des en-têtes de réponse pour `assets.winorwipe.com` :
  `Access-Control-Allow-Origin: https://winorwipe.com`.

## Ordre du premier déploiement

1. Environnement `production`, variables, secret et certificat ci-dessus **avant le premier push** (sinon GitHub
   crée l'environnement à la volée, sans validation obligatoire), puis protection de `main` une fois la branche
   poussée.
2. Push sur `main` : la pipeline crée l'infrastructure (le serveur n'est pas encore installé : manifeste des assets
   vide).
3. `npm run deploy-assets`, puis commit et push du manifeste : la pipeline installe le serveur.
4. Réglages Cloudflare, puis https://winorwipe.com.
