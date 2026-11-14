# Mise en ligne

Le jeu tourne sur un serveur EC2 (eu-west-3) derrière Cloudflare ; ses assets (modèles, sons, musique) sont dans le
bucket S3 `assets.winorwipe.com`, servis par Cloudflare. L'infrastructure est décrite en Terraform :

- `infra/bootstrap` : socle (bucket de l'état, accès OIDC de GitHub Actions, alerte de budget), appliqué à la main
  depuis le poste ;
- `infra/main` : réseau, serveur, buckets des assets et des versions, réglages de la zone Cloudflare (DNS, SSL,
  règles), appliqué par la pipeline.

## Pipeline (GitHub Actions)

- `ci.yml` : typage et tests sur chaque pull request.
- `terraform-plan.yml` : plan de `infra/main` en lecture seule sur les pull requests qui le touchent.
- `deploy.yml` : à chaque push sur `main`, tests puis plan (à relire dans le résumé du run), puis, après validation
  dans l'environnement `production`, apply de `infra/main`, build du client et installation du serveur
  (`deploy/install.sh`, lancé par Session Manager : Node 22, nginx en HTTPS, service systemd `arena`, mises à jour
  automatiques).

## Mises à jour du serveur

Amazon Linux 2023 suit les dépôts `latest` (`/etc/dnf/vars/releasever`) ; `deploy/maintenance/` :

- chaque nuit à 3 h 30 (heure de Paris), `dnf-automatic` installe les correctifs de sécurité ;
- à 4 h, `arena-maintenance` redémarre la machine si une mise à jour l'exige (noyau, glibc, systemd…), sinon
  seulement nginx et le serveur de jeu s'ils utilisent une bibliothèque remplacée. Les parties en cours sont coupées.
  Elle attend la fin des mises à jour et d'un déploiement en cours (verrou `/run/arena-deploy.lock`, pris aussi par
  `install.sh`) ; en cas d'erreur, elle échoue sans rien redémarrer.
- si la machine était éteinte à 3 h 30, les correctifs s'installent à son démarrage ; le redémarrage éventuel des
  services attend 4 h.

Journaux : `journalctl -u dnf-automatic -u arena-maintenance` (Session Manager).

## Réglages à faire une fois

### GitHub (Settings du dépôt)

1. **Branches** : protéger `main` (pull request obligatoire, pas de contournement par les administrateurs).
2. **Environments** : créer `production`, avec validation obligatoire (« Required reviewers », en interdisant
   l'auto-validation si d'autres personnes peuvent valider) et déploiement limité à la branche `main`.
3. **Secrets and variables → Actions** :
   secrets du dépôt (masqués dans les journaux, qui sont publics) :
   - `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN` et `TF_STATE_BUCKET` (sorties de `terraform output` dans
     `infra/bootstrap`) ;
   - `VITE_SOUND_KEY` (clé des sons protégés, la même que dans `packages/client/.env.local`) ;
   - `CLOUDFLARE_API_TOKEN_READ` (jeton Cloudflare de lecture, pour les plans) ;
   - `TFPLAN_KEY` (phrase de chiffrement du plan enregistré, aléatoire : les artefacts d'un dépôt public sont
     téléchargeables par tous).

   Secret de l'**environnement** `production` (donné seulement après validation du déploiement) :
   - `CLOUDFLARE_API_TOKEN` (jeton Cloudflare d'écriture, pour l'apply).
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

### Jetons d'API Cloudflare

Dans Cloudflare : Manage account → Account API tokens → Create Token → Start from scratch, limités à la zone
`winorwipe.com` (jamais la « Global API key ») :

- `arena-terraform-read` : Zone, DNS, Zone Settings, Config Settings, Zone Transform Rules, Cache Settings et
  Zone SSL & Certificates en **Read** ;
- `arena-terraform-edit` : Zone en Read ; les six autres en **Edit**.

Le nom du compte Cloudflare est lu par Terraform : ne pas y laisser d'adresse e-mail (nom par défaut « …'s Account »,
à changer dans Manage account → Configurations).

Pour les plans sur le poste, le jeton de lecture est rangé dans le trousseau macOS (jeton copié dans le
presse-papiers) :

```sh
security add-generic-password -U -a arena -s cloudflare-api-token-read -w "$(pbpaste)" && pbcopy < /dev/null
```

puis, pour un plan : `CLOUDFLARE_API_TOKEN=$(security find-generic-password -a arena -s cloudflare-api-token-read -w)
terraform plan -lock=false`.

### Cloudflare (géré par Terraform, `infra/main/cloudflare.tf`)

La zone `winorwipe.com` est créée à la main avec le domaine ; Terraform gère son contenu (rien à créer à la main,
sinon l'apply échoue sur un doublon) :

- DNS en mode proxy : `winorwipe.com` (`A` vers l'IP du serveur) et `assets` (`CNAME` vers le bucket) ;
- SSL **Full (strict)** et redirection vers HTTPS ;
- règle de configuration : SSL **Flexible** pour `assets.winorwipe.com` (l'adresse site web de S3 ne parle que HTTP) ;
- règle d'en-têtes de réponse : `Access-Control-Allow-Origin: https://winorwipe.com` sur `assets.winorwipe.com` ;
- règle de cache : tout `assets.winorwipe.com` en cache (noms à empreinte), pour la durée annoncée par S3 ;
- Authenticated Origin Pulls (`infra/main/origin_pull.tf`) : Cloudflare présente au serveur un certificat client
  propre à la zone, signé par une autorité générée par Terraform ; nginx n'accepte que les certificats de cette
  autorité. La pipeline attend que Cloudflare ait activé le certificat, puis joint l'autorité (publique) à la version
  installée. Le certificat (cinq ans) est renouvelé par un plan ordinaire trente jours avant son expiration, sans
  changer l'autorité (vingt ans).

Une règle ajoutée à la main dans le tableau de bord dans ces phases (configuration, en-têtes de réponse, cache) est
effacée au prochain apply : passer par `cloudflare.tf`. L'IP du serveur est masquée dans les journaux
(`terraform output -raw server_ip` pour la lire).

## Ordre du premier déploiement

1. Environnement `production`, secrets, jetons et certificat ci-dessus **avant le premier push** (sinon GitHub
   crée l'environnement à la volée, sans validation obligatoire), puis protection de `main` une fois la branche
   poussée.
2. Push sur `main` : la pipeline crée l'infrastructure et règle Cloudflare (le serveur n'est pas encore installé :
   manifeste des assets vide).
3. `npm run deploy-assets`, puis commit et push du manifeste : la pipeline installe le serveur.
4. https://winorwipe.com.
