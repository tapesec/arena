# Direction artistique des personnages — Win or Wipe

Choix validés en novembre 2026 sur le casting des 10 personnages (5 classes × 2 camps). À relire **avant de générer tout nouveau personnage**, pour qu'il appartienne au même jeu que les autres.

## Le principe : un même jeu, des personnages singuliers

Tous les personnages partagent le **même style et les mêmes proportions**, mais chacun doit être **reconnaissable au premier coup d'œil** par sa **classe** (sa silhouette) et par son **camp** (son peuple et sa palette). Un nouveau personnage ne doit jamais être une variante de couleur d'un autre : il doit avoir sa propre identité.

En vue de dessus, en pleine mêlée, un joueur doit savoir **qui est quoi** et **dans quel camp** sans lire de nom.

## Le style commun

- Aplats de couleur peints à la main, avec des dégradés doux ; aspect 3D low-poly stylisé ; matières mates.
- Très peu de petits détails, pas de textures bruitées : seules les grandes formes comptent en vue de dessus.
- Palette limitée à 3 ou 4 couleurs par personnage.
- Équipement surdimensionné et lisible (casques, épaulières, chapeaux, cols).
- Proportions semi-réalistes un peu stylisées, **les mêmes pour tous** :
  - jambes courtes, environ un tiers de la hauteur (entrejambe vers 63 % depuis le haut de la tête) ;
  - mains et bottes un peu grosses, tête un peu grosse mais pas « chibi » ;
  - personnages jeunes (ados ou jeunes adultes) côté camp 1.
- Visage neutre et calme, bouche fermée : les expressions viendront des animations, pas du modèle.
- **Pas de cape** ni rien qui pende dans le dos ou entre les jambes (sinon ça se déforme avec les animations). Les robes longues jusqu'au mollet sont acceptées.

## Une silhouette par classe

| Classe | Rôle | Silhouette |
|---|---|---|
| Gardien | tank | **Bloc** massif : épaules très larges, grosses mains, jambes courtes |
| Arcaniste | mage dégâts | **Cône** : épaules étroites, vêtement qui s'évase vers le bas |
| Lame | dégâts au corps à corps | **V** : épaules larges, taille très fine, agile |
| Prêtre | healer | **Rond**, doux, enveloppé (cols de fourrure, ponchos, robes) |
| Barde | contrôle | **Léger** et vif, vêtements courts et près du corps |

Deux personnages de classes différentes ne doivent pas avoir la même silhouette, même dans le même camp. Un nouveau personnage d'une classe existante reprend la silhouette de sa classe.

## Une identité par camp

| | Camp 1 | Camp 2 |
|---|---|---|
| Peuple | Héros humains et elfes, d'après l'illustration de la page d'accueil | Monstres et barbares : viking, cultiste, gobelins, diablotin |
| Ton | Jeune, héroïque, avenant | Sauvage, inquiétant, rusé |
| Couleurs | Franches et nobles : bleu, violet, rouge, crème, or | Sourdes et sauvages : peaux vertes ou violettes, os, fourrure, vert mousse, sarcelle, cuir sombre |

Casting actuel :

| Classe | Camp 1 | Camp 2 |
|---|---|---|
| Gardien | Chevalier au casque arrondi, tabard bleu | Viking à casque à cornes, cotte de mailles, kilt rouge |
| Arcaniste | Jeune femme, chapeau pointu et manteau court violets | Cultiste au masque de crâne de bouc, robe couleur os, mantelet de fourrure noire |
| Lame | Ado au chapeau à plume, foulard rouge, tunique violette | Gobelin au casque cabossé, cuir et capuche-écharpe |
| Prêtre | Jeune elfe, robe bleu roi et or, col de fourrure blanche | Chaman gobelin, coiffe en crâne et plumes, poncho de feuilles |
| Barde | Ado blond, tunique crème brodée de vert, écharpe rouge | Diablotin violet à capuche sarcelle, petites ailes repliées |

Un nouveau personnage du camp 1 doit pouvoir figurer dans l'illustration d'accueil ; un nouveau du camp 2 doit avoir l'air d'en être l'adversaire.

## Contraintes techniques des modèles

- Pose A : bras tendus vers le bas, écartés d'environ 30°, jambes un peu écartées, vue de face à hauteur des yeux, fond blanc, sans ombre.
- **Mains vides** : les armes sont des objets séparés, ajoutés et placés dans l'éditeur d'apparence.
- Les accessoires collés au corps passent (petites ailes repliées contre le dos), tout ce qui flotte ou pend ne passe pas.

## Méthode de génération (Tripo)

1. **Image** : génération image à partir d'images (modèle banana_pro), avec en références de style le Gardien, l'Arcaniste et la Lame du camp 1 (image[1] à image[3]), plus une image d'inspiration pour le design (image[4]). Le prompt commence toujours par le même bloc :

   > image[1], image[2] and image[3] show three characters of the same game in ONE shared art style and proportions: hand-painted flat color areas with soft gradients, low-poly stylized 3D look, matte materials, slightly stylized proportions (slightly big hands and head, rather short legs), very little fine detail, neutral calm faces, front view, A-pose, plain white background. Draw a NEW character of this game in EXACTLY that style and proportions.

   puis décrit le design (en précisant « ignore its cartoon style and expression » pour l'image d'inspiration), la silhouette de la classe, l'équipement, la palette limitée, et finit par :

   > NO cape, nothing hanging behind the back. Full body, straight FRONT view at eye level, neutral A-pose with both arms straight down and slightly away from the body at about 30 degrees, both hands open and EMPTY, legs slightly apart, plain white background, no shadow.

2. **Vérifier les proportions** sur l'image avant la 3D. Le générateur refuse souvent de raccourcir les jambes : on les raccourcit alors localement en écrasant la bande du pantalon (gratuit).
3. **3D** : image_to_3d v3.1, smart low poly, 12 000 faces, texture v3.5, éclairage retiré.
4. **Squelette** : rig v3.0, biped, spécification unreal, puis `node scripts/align-tripo-skeleton.mjs <rig> <corps de référence> <sortie> <hauteur>`.
5. **Dans l'éditeur d'apparence**, en Vue de jeu : armes et placements, luminosité, écart des bras. Puis « applique ».

Les modèles générés ne sont pas versionnés (dépôt public) : ils vont dans le bucket S3 des assets.
