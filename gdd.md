# Game Design Document — PvP de groupe inspiré de DAoC

> Document de référence du prototype. Les noms et les valeurs chiffrées sont provisoires et seront ajustés en test.

## Vision

Un jeu de combat PvP en groupes, inspiré du combat de groupe de Dark Age of Camelot.

- **Plateforme** : navigateur d'abord, puis client lourd (Electron/Tauri) pour Steam.
- **Vue** : 3D isométrique.
- **Combat** : tab-target (ciblage par Tab ou clic, pas de visée manuelle).
- **Déplacement** (contrôles à la DAoC) : Z/S avancent et reculent dans la direction du personnage, Q/D le font pivoter. Clic droit maintenu : la souris oriente le personnage et la caméra (haut/bas règle l'inclinaison de la caméra), Q/D deviennent des pas de côté. La caméra se place dans le dos du personnage ; V la recentre.
- **Verrous sur la cible** : F fait face à la cible en permanence, C la suit (stick) en lui faisant face. Rappuyer ne les annule pas : avancer, reculer ou pivoter les lâche, de même que la mort, un mez ou un stun (et un root pour le stick), ou la perte de la cible. Le pas de côté les conserve (tourner autour de sa cible pendant un stick).
- **Pivoter** n'interrompt pas une incantation ; avancer, reculer ou faire un pas de côté, si.
- **Attaque automatique** : R.
- **Stack** : TypeScript partout, Babylon.js côté client, serveur autoritaire en Node/Bun, logique de combat partagée.

## Format de jeu : arène 8v8 avec roaming

- **Matchmaking** : les joueurs rejoignent une file d'attente sans choisir de classe. La partie ne démarre que lorsque **16 joueurs** ont été trouvés, répartis en **2 équipes de 8**. Aucune notion de classement ni de niveau : les 16 premiers joueurs de la file forment la partie.
- **Choix des classes** : une fois les équipes formées, chaque joueur choisit sa classe en même temps que les autres. Il voit les choix de ses coéquipiers, mais **pas ceux de l'équipe adverse**, qui ne découvre la composition d'en face qu'en la croisant dans l'arène. 30 s pour choisir, classe aléatoire si le temps est écoulé.
- **Composition** : doublons autorisés sans limite.
- **Pas de score** pour le prototype : une partie se gagne ou se perd, c'est tout.
- **L'arène** : une grande carte simple (sol plat, obstacles basiques pour la ligne de vue, pas d'investissement dans les décors pour le moment), couverte d'un **brouillard de guerre**. Chaque équipe ne voit que ce que ses membres voient : il faut se déplacer et explorer pour trouver l'équipe adverse. À l'écran, le sol est assombri hors de la vue de son équipe (35 m autour de chaque allié vivant, masqué derrière les obstacles).
- **Les zones de départ** : chaque équipe commence dans sa propre zone, aux deux extrémités de l'arène.
- **La phase de préparation** : 10 s dans la zone de départ avant l'ouverture, pour former le plan et poser les buffs du Prêtre.
- **La mort** : un joueur mort reste au sol jusqu'à la fin de la partie, sauf s'il est ressuscité. Aucune réapparition.
- **La fin de partie** : dès qu'une équipe est entièrement morte, l'autre gagne.
- **Mode développement** : possibilité de lancer une partie avec moins de 16 joueurs, pour tester.

## Règles de combat communes

- **Incantation** : les sorts ont un temps d'incantation. Tout dégât reçu interrompt l'incantation.
- **Ressources** :
  - **Mana** pour les lanceurs de sorts : 1 000 points, régénération de 5/s.
  - **Endurance** pour les combattants de mêlée : 100 points, régénération de 2/s.
- **Ligne de vue** : obligatoire pour tout sort et toute attaque à distance.
- **Portées** : mêlée 3 m, sorts 30 m.
- **Contrôle de foule** :
  - **Mez** : la cible ne peut plus rien faire. Cassé par le moindre dégât.
  - **Stun** : la cible ne peut plus rien faire. Non cassé par les dégâts.
  - **Root** : la cible ne peut plus se déplacer mais peut agir. Cassé par les dégâts.
  - **Snare** : ralentissement.
- **Immunités** : dès qu'un mez, un stun ou un root est appliqué, la cible devient immunisée contre ce même type de contrôle, pendant la durée du contrôle plus 30 s. Relancer un contrôle ne peut donc pas le prolonger.

## Classes

| Classe | Rôle | Points de vie | Ressource |
|---|---|---|---|
| Gardien | Tank | 1 600 | Endurance |
| Lame | Dégâts mêlée | 1 300 | Endurance |
| Prêtre | Healer | 1 100 | Mana |
| Barde | Contrôle de foule | 1 000 | Mana |
| Arcaniste | Dégâts magiques | 900 | Mana |

### 1. Gardien — tank (épée et bouclier)

Protège les alliés vulnérables et tient la ligne de front.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Garde | 50 % de chances de bloquer les attaques de mêlée visant l'allié protégé (à 4 m maximum). | Instantané | — | — |
| Interception | Encaisse à la place d'un allié le prochain coup qui le vise. | Instantané | 15 endurance | 20 s |
| Coup de bouclier | Stun de 4 s au contact. | Instantané | 40 endurance | — |
| Passif | 30 % de chances de bloquer avec le bouclier. | — | — | — |

### 2. Arcaniste — mage dégâts

Gros dégâts à distance, à condition d'être protégé.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Trait de feu | 250 dégâts sur une cible. | 2,5 s | 80 mana | — |
| Déflagration | 150 dégâts dans une zone de 5 m de rayon. | 3,5 s | 150 mana | — |
| Gel | Root de 10 s. | 1,5 s | 60 mana | — |
| Concentration | Le prochain sort ne peut pas être interrompu. | Instantané | — | 3 min |
| Bulle | Bloque un coup de mêlée. Se reforme 10 s après avoir été consommée. | Passif | — | 10 s |

### 3. Prêtre — healer

Garde le groupe en vie, le libère des contrôles et le renforce.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Soin | Rend 300 points de vie à un allié. | 2 s | 80 mana | — |
| Soin de groupe | Rend 200 points de vie aux membres du groupe à 20 m. | 3 s | 200 mana | — |
| Soin instantané | Rend 200 points de vie à un allié. | Instantané | 60 mana | 3 min |
| Purification | Retire le mez ou le stun d'un allié. | Instantané | 30 mana | 5 s |
| Buff de vie | +200 points de vie maximum. Dure jusqu'à la mort du Prêtre ou de la cible. | 2 s | 100 mana | — |
| Buff de force | +15 % de dégâts de mêlée. Dure jusqu'à la mort du Prêtre ou de la cible. | 2 s | 100 mana | — |
| Aura de régénération | Les alliés à 30 m régénèrent +5 mana/s et +2 endurance/s. | Permanent | — | — |
| Résurrection | Relève un allié mort à 50 % de vie, sans aucun buff. Utilisable en combat. | 4 s | 400 mana | — |

### 4. Barde — contrôle de foule

Neutralise le groupe adverse et contrôle le rythme du combat.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Mez de zone | Mez de 20 s sur les ennemis dans une zone de 6 m de rayon. | 3 s | 200 mana | — |
| Mez ciblé | Mez de 20 s sur une cible. | 2 s | 100 mana | — |
| Root de zone | Root de 12 s sur les ennemis dans une zone de 6 m de rayon. | 2,5 s | 120 mana | — |
| Silence | Façon amnésie : interrompt l'incantation en cours de la cible. | 1 s | 40 mana | — |
| Chant de vitesse | +40 % de vitesse pour le groupe à 30 m. Coupé pendant 5 s quand le Barde attaque ou est attaqué. | Permanent | — | — |

### 5. Lame — dégâts au corps à corps

Traque et élimine les cibles fragiles, en priorité les casters.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Attaque dans le dos | 200 dégâts. Uniquement de dos. | Instantané | 25 endurance | — |
| Attaque de flanc | 120 dégâts et snare de 40 % pendant 8 s. Uniquement de côté. | Instantané | 20 endurance | — |
| Évasion | 75 % d'esquive contre la mêlée pendant 8 s. | Instantané | 20 endurance | 1 min |
| Rage | Tous les coups sont critiques pendant 10 s. | Instantané | — | 3 min |
| *(option future)* Furtivité | Devenir invisible, pour un rôle d'assassin. | — | — | — |

## Points ouverts

- **Parties qui s'éternisent** : si une équipe se cache ou fuit sans arrêt, la partie peut ne jamais finir. Piste possible : une zone qui rétrécit après quelques minutes, ou une durée maximale.
- **Taille de l'arène** : à caler en test, assez grande pour que la recherche prenne un peu de temps sans devenir ennuyeuse.
- **Progression** : hors périmètre du prototype.
- **Valeurs chiffrées** : toutes à valider en prototype.
- **Contrôles** : passés aux contrôles à la DAoC (voir Déplacement). On recule à 70 % de la vitesse normale, comme dans DAoC.

## Choix faits pendant le prototype (provisoires, à valider en test)

- **Incantation** : bouger interrompt l'incantation, et on ne peut pas commencer à incanter en bougeant (comme dans DAoC).
- **Orientation** : pour attaquer ou lancer un sort offensif, la cible doit être dans un cône de 180° devant soi.
- **Positions** (Lame) : devant = ±60° face à la cible, dans le dos = ±60° derrière, flanc = entre les deux.
- **Zones d'effet** : Déflagration, Mez de zone et Root de zone sont centrés sur la cible (et non sur un point du sol choisi à la souris).
- **Attaque automatique** : Gardien 55 dégâts / 2 s, Lame 70 / 2 s, Arcaniste, Prêtre et Barde 30 / 2,5 s.
- **Critiques** : 10 % de chances en mêlée, dégâts × 1,5 (la Rage rend tous les coups critiques).
- **Interception** : dure 10 s ou jusqu'au premier coup, le Gardien doit être à 4 m maximum de l'allié.
- **Garde** : utiliser Garde sur l'allié déjà protégé retire la protection.
- **Chant de vitesse** : s'active et se désactive avec sa touche.
- **Soins et buffs** : sans allié ciblé, ils s'appliquent au lanceur.
- **Équipes provisoires** : attribuées automatiquement à l'arrivée (l'équipe la moins nombreuse), en attendant le matchmaking.
