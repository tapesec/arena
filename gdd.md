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
- **Barre d'action** : en bas au centre, une case carrée par compétence avec son icône (game-icons.net) à la couleur de son école, sa touche et son coût. Recharge en cadran qui se découvre dans le sens des aiguilles d'une montre, secondes au centre. État visible d'un coup d'œil : icône pâlie si la ressource manque, voile rouge hors de portée ou hors de vue, bord rouge en mauvaise position (pas face à la cible, pas dans le dos ou sur le flanc qu'exige la technique), grisée sans cible valide ou quand on est neutralisé. Infobulle au survol (nom, coût, incantation, portée, recharge, description, et ce qui empêche de lancer). Clic pour lancer, en plus des touches. Technique de mêlée en attente et Chant actif : case en surbrillance. Les techniques positionnelles portent dans le coin haut droit un pictogramme de la position exigée (la cible vue de dessus, avant plein, et une flèche par l'arrière ou par le côté), qui passe au rouge quand on est mal placé.
- **Jauge de coup d'arme** : juste au-dessus de la barre, visible seulement quand l'attaque automatique est active. Elle se remplit jusqu'au prochain coup d'arme et éclate en blanc quand il part. Avec une technique en attente, elle prend la couleur de la technique et son icône s'affiche au bout. Pleine et clignotant en rouge quand le coup est prêt mais ne peut pas partir (hors de portée, hors de vue, pas face à la cible). Le serveur envoie au joueur le temps restant avant son prochain coup à chaque coup et à l'activation de l'attaque.
- **Fenêtre de groupe** : à gauche, sous son panneau, une ligne par coéquipier (classe, vie, mana ou endurance, sort en cours, afflictions puis buffs puis immunités). Clic ou F2 à F8 pour le cibler ; un coéquipier mort est grisé, un coéquipier hors de portée de sort ou hors de vue est atténué.
- **Stack** : TypeScript partout, Babylon.js côté client, serveur autoritaire en Node/Bun, logique de combat partagée.

## Format de jeu : arène 8v8 avec roaming

- **Matchmaking** : les joueurs rejoignent une file d'attente sans choisir de classe. La partie ne démarre que lorsque **16 joueurs** ont été trouvés, répartis en **2 équipes de 8**. Aucune notion de classement ni de niveau : les 16 premiers joueurs de la file forment la partie.
- **Choix des classes** : une fois les équipes formées, chaque joueur choisit sa classe en même temps que les autres. Il voit les choix de ses coéquipiers, mais **pas ceux de l'équipe adverse**, qui ne découvre la composition d'en face qu'en la croisant dans l'arène. 30 s pour choisir, classe aléatoire si le temps est écoulé.
- **Composition** : doublons autorisés sans limite.
- **Pas de score** pour le prototype : une partie se gagne ou se perd, c'est tout.
- **L'arène** : une grande carte de 100 × 100 m, symétrique par rotation de 180°. Au centre, un **hameau** : une grande place pavée dégagée (28 m de diamètre, deux étals sur ses bords) entourée de six maisons fermées (deux grandes de 8 × 8 m face aux départs, deux moyennes, deux petites). Par moitié de carte, la place a une large entrée, un coin ouvert et une ruelle étroite de 3 m ; la grande maison cache la place à qui arrive de son départ. Autour : piles de caisses sur les approches, murets et cabanes sur les flancs, une palissade près de chaque départ. La carte est couverte d'un **brouillard de guerre**. Chaque équipe ne voit que ce que ses membres voient : il faut se déplacer et explorer pour trouver l'équipe adverse. À l'écran, le sol est assombri hors de la vue de son équipe (35 m autour de chaque allié vivant, masqué derrière les obstacles).
- **Les zones de départ** : chaque équipe commence dans sa propre zone, aux deux extrémités de l'arène.
- **La carte** (100 × 100 m, symétrique par rotation de 180°) : des ruines carrées au centre (une entrée par côté, un pilier au milieu), des piliers sur les approches, des murs et des blocs sur les flancs pour contourner à couvert, deux grandes zones ouvertes où un groupe est exposé, et un seul abri près de chaque zone de départ.
- **Le relief** : un grand plateau de 3 m sur chaque flanc (dessus plat d'environ 14 × 16 m, rampes douces), une longue crête basse de 2 m entre chaque zone de départ et un flanc, et un large vallonnement de 1,5 m sur les approches du centre. Le centre, les zones de départ, les zones ouvertes et les abords des obstacles restent plats. Le relief bloque la ligne de vue (sorts et brouillard), calculée à hauteur des yeux (1,6 m) : on se cache derrière un plateau, on voit loin depuis son sommet. Les pentes ne ralentissent pas.
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
  - **Stun** : la cible ne peut plus rien faire. Non cassé par les dégâts, ni retiré par la Purification.
  - Un personnage neutralisé (mez, stun) n'esquive pas et ne bloque pas au bouclier ; la bulle et la Garde d'un autre Gardien le protègent toujours.
  - **Techniques de mêlée** (Coup de bouclier, attaque dans le dos, attaque de flanc), comme les styles de DAoC : la technique part au prochain coup d'arme, à la place du coup normal (aussitôt si l'arme est prête). Elle est mise en attente et s'allume sur la barre ; une autre technique la remplace ; couper l'attaque l'annule ; la lancer active l'attaque. Ses conditions (portée, position, face à la cible, endurance) sont vérifiées au moment du coup : si elles manquent, le coup reste normal et un message l'indique. Une technique au plus par coup d'arme (toutes les 2 s pour la Lame et le Gardien).
  - **Attaques spéciales de mêlée** (Coup de bouclier, attaque dans le dos, attaque de flanc) : esquivées, bloquées au bouclier (Gardien ou Garde) ou absorbées par une bulle, elles s'arrêtent en entier, dégâts et effets (stun, ralentissement).
  - **Root** : la cible est arrêtée net, puis sa vitesse remonte régulièrement jusqu'à la normale à la fin de l'effet (à mi-durée, elle avance à 50 %). Elle peut agir. Cassé par les dégâts, qui rendent aussitôt la pleine vitesse.
  - **Snare** : ralentissement de 40 % (tous les snares). Un seul snare à la fois : le plus puissant reste jusqu'à la fin de son effet, un snare plus faible reçu entre-temps est ignoré (pas mis en attente) ; à puissance égale, on garde celui qui dure le plus longtemps. Pas d'immunité.
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
| Garde | 75 % de chances de bloquer les attaques de mêlée visant l'allié protégé (à 4 m maximum), si l'allié et le Gardien sont immobiles au moment du coup. Portée 10 m. | Instantané | 15 endurance | — |
| Interception | Encaisse à la place d'un allié (à 4 m) le prochain coup qui le vise, pendant 10 s. Portée 20 m. | Instantané | 25 endurance | 10 s |
| Coup de bouclier | Stun de 2 s au contact. Technique de mêlée. | Prochain coup | 40 endurance | 10 s |
| Charge | Fonce sur un ennemi entre 10 et 30 m (vitesse +500 %), s'arrête au contact : 100 dégâts et stun 4 s, impossibles à esquiver ou bloquer, même sur une cible immunisée au stun (l'immunité est quand même donnée). Impossible rooté. | Instantané | 30 endurance | 20 s |
| Coup puissant | 100 dégâts, toutes positions. Technique de mêlée. | Prochain coup | 20 endurance | — |
| Provocation | 6 s : la cible inflige 50 % de dégâts en moins (mêlée et sorts) à tout autre que le Gardien. Sur le coup : arrêt net 0,5 s, incantation interrompue, attaque automatique arrêtée, cible tournée vers le Gardien. Pas d'immunité. Portée 30 m. | Instantané | 30 endurance | 20 s |
| Cri de ralliement | Le Gardien et les alliés à 20 m sont immunisés aux contrôles magiques 6 s ; ceux déjà en place sont retirés. Contrôle magique = venu d'un sort (mana, hors technique de mêlée). | Instantané | 30 endurance | 60 s |
| Frappe handicapante | 100 dégâts et snare 8 s, dans le dos. Technique de mêlée. | Prochain coup | 15 endurance | — |
| Rempart (ultime) | 10 s : le Gardien et les alliés à 30 m (y compris ceux qui arrivent) ne subissent aucune attaque de mêlée. Le Gardien ne peut plus rien faire ; l'effet s'arrête s'il meurt ou s'il est mez ou stun. | Instantané | 50 endurance | 3 min |
| Passif | 30 % de chances de bloquer avec le bouclier. | — | — | — |

### 2. Arcaniste — mage dégâts

Gros dégâts à distance, à condition d'être protégé.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Trait de feu | 250 dégâts sur une cible. | 2 s | 100 mana | — |
| Déflagration | Explosion autour du lanceur, sans cible ni ligne de vue : touche tous les ennemis à 7 m (pas les alliés), 450 dégâts au centre, décroissant jusqu'à 100 au bord. | 2 s | 150 mana | — |
| Concentration | Le prochain sort ne peut pas être interrompu. | Instantané | — | 90 s |
| Trait de givre | 150 dégâts de givre et snare 4 s (contrôle magique). | 2 s | 100 mana | — |
| Near sight | 15 s : la portée des sorts de la cible est réduite de 75 % (30 m → 7,5 m) ; une incantation en cours échoue si la cible est trop loin à la fin. Pas un contrôle magique : le Cri de ralliement ne l'empêche ni ne le retire. | 1,5 s | 100 mana | — |
| Brûlure | Dot de feu : 400 dégâts en 10 s, un tic par seconde. Comme dans DAoC, chaque tic libère du mez et du root mais n'interrompt pas l'incantation (et n'est pas intercepté). Relancée, elle repart de zéro. | 2 s | 200 mana | — |
| Nova de givre | Root 12 s sur les ennemis à 15 m autour du lanceur, sans cible. | 1,5 s | 200 mana | 60 s |
| Puissance arcanique (ultime) | 15 s : tous les sorts de dégâts de l'Arcaniste sont critiques (× 1,5), tics de la Brûlure compris. | Instantané | 400 mana | 3 min |

À débloquer (programmés, pas encore dans la barre) :

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Gel | Root de 10 s. | 1,5 s | 60 mana | — |
| Bulle | Sur l'Arcaniste seulement (comme le bladeturn de DAoC) : absorbe entièrement le prochain coup de mêlée, puis disparaît. Seul un coup au corps à corps la casse : elle ne protège pas des sorts. Elle arrête l'attaque entière, effets compris (le Coup de bouclier ne stun pas, l'attaque de flanc ne ralentit pas) ; si un Gardien intercepte le coup, c'est lui qui le prend et la bulle reste. Cassée, elle n'interrompt pas l'incantation en cours. À relancer. | 2 s | 80 mana | 10 s |
| Transfert | Téléportation de 10 m vers l'avant ; possible rooté, sans retirer le root. Pas encore programmé. | Instantané | 100 mana | 30 s |

### 3. Prêtre — healer

Garde le groupe en vie, le libère des contrôles et le renforce.

| Compétence | Effet | Incantation | Coût | Recharge |
|---|---|---|---|---|
| Soin | Rend 300 points de vie à un allié. | 2 s | 80 mana | — |
| Soin de groupe | Rend 200 points de vie aux membres du groupe à 20 m. | 3 s | 200 mana | — |
| Soin instantané | Rend 200 points de vie à un allié. | Instantané | 60 mana | 3 min |
| Purification | Retire le mez d'un allié (pas le stun). | Instantané | 30 mana | 5 s |
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
| Attaque dans le dos | 270 dégâts, à la place du coup normal. Uniquement de dos. Technique de mêlée. | Prochain coup | 25 endurance | — |
| Attaque de flanc | 190 dégâts, à la place du coup normal, et snare de 40 % pendant 8 s. Uniquement de côté. Technique de mêlée. | Prochain coup | 20 endurance | — |
| Évasion | 75 % d'esquive contre la mêlée pendant 8 s. | Instantané | 20 endurance | 1 min |
| Rage | Tous les coups sont critiques pendant 10 s. | Instantané | — | 3 min |
| *(option future)* Furtivité | Devenir invisible, pour un rôle d'assassin. | — | — | — |

## Points ouverts

- **Parties qui s'éternisent** : si une équipe se cache ou fuit sans arrêt, la partie peut ne jamais finir. Piste possible : une zone qui rétrécit après quelques minutes, ou une durée maximale.
- **Taille de l'arène** : à caler en test, assez grande pour que la recherche prenne un peu de temps sans devenir ennuyeuse.
- **Progression** (décidée le 2026-11-09, à construire plus tard) : **horizontale**. Monter en rang débloque des compétences de puissance équivalente (des options), jamais de la puissance brute, pour qu'un débutant reste compétitif face à un vétéran sans matchmaking par niveau. Barre de **8 compétences** par classe : **3 fixes**, les compétences de base données à l'ouverture du compte, et **5 au choix** parmi le catalogue de la classe, débloqué au fil des rangs (une compétence « ultime » au plus). Les rangs exigent des comptes persistants : en attendant, on conçoit et équilibre le catalogue avec tout débloqué.
- **Valeurs chiffrées** : toutes à valider en prototype.
- **Statistiques de combat** (décidé le 2026-11-09) : pas de caractéristiques de base (force, intelligence…), inutiles sans équipement ni répartition de points. Chaque classe a directement des statistiques de combat : PV, ressource, dégâts et vitesse de l'arme, critique mêlée et sorts, plus tard armure et résistances. Les dégâts et soins des sorts, et leurs temps d'incantation, se règlent compétence par compétence. Buffs et debuffs agissent de façon générique sur ces statistiques, et aussi sur deux multiplicateurs internes, puissance des sorts et vitesse d'incantation (100 % par défaut, pas réglés par classe). Des caractéristiques de base pourront s'ajouter au-dessus si l'équipement arrive. Les valeurs de travail sont dans le tableur « Arena — Compétences des classes » (Google Drive).
- **Contrôles** : passés aux contrôles à la DAoC (voir Déplacement). On recule à 70 % de la vitesse normale, comme dans DAoC.

## Choix faits pendant le prototype (provisoires, à valider en test)

- **Incantation** : bouger interrompt l'incantation, et on ne peut pas commencer à incanter en bougeant (comme dans DAoC).
- **Orientation** : pour attaquer ou lancer un sort offensif, la cible doit être dans un cône de 180° devant soi.
- **Positions** (Lame) : devant = ±60° face à la cible, dans le dos = ±60° derrière, flanc = entre les deux.
- **Zones d'effet** : Mez de zone et Root de zone sont centrés sur la cible (et non sur un point du sol choisi à la souris) ; Déflagration est centrée sur le lanceur.
- **Attaque automatique** : Gardien 55 dégâts / 2 s, Lame 70 / 2 s, Arcaniste, Prêtre et Barde 30 / 2,5 s.
- **Critiques** : 10 % de chances en mêlée, dégâts × 1,5 (la Rage rend tous les coups critiques).
- **Interception** : dure 10 s ou jusqu'au premier coup, le Gardien doit être à 4 m maximum de l'allié.
- **Garde** : utiliser Garde sur l'allié déjà protégé retire la protection.
- **Chant de vitesse** : s'active et se désactive avec sa touche.
- **Soins et buffs** : sans allié ciblé, ils s'appliquent au lanceur.
- **Équipes provisoires** : attribuées automatiquement à l'arrivée (l'équipe la moins nombreuse), en attendant le matchmaking.

## Bots
- Ils jouent avec les mêmes commandes que les joueurs et ne voient que ce que leur équipe voit. Un bouton permet de compléter la partie avec des bots.
- Priorités par classe : les Lames visent les lanceurs de sorts, puis les Lames, puis les Gardiens. Les lanceurs de sorts visent les lanceurs de sorts, puis les Lames, puis les Gardiens. Les Prêtres soignent en priorité. Les Bardes cherchent le mez de zone, puis le root de zone, puis le silence. Les Gardiens protègent les lanceurs de sorts attaqués. Les lanceurs de sorts fuient la mêlée.
- **Erreur humaine** : un ennemi qui apparaît n'est remarqué qu'après 0,3 à 0,8 s. Une décision sur sept environ est sautée (hésitation), ce qui retarde aussi soins, fuites et interruptions. En changeant de cible, un bot prend parfois (15 %) un ennemi au hasard.
- Pas de niveau de difficulté pour le moment.

## Assets
- **Source** : packs Quaternius, licence CC0 (libre, même commercialement). Tous partagent le même squelette humanoïde (65 os), donc toutes les animations vont sur tous les personnages.
  - Modular Character Outfits – Fantasy (version Source) : 5 styles de tenue (chevalier, noble, mage, rôdeur, paysan), homme et femme, 3 variantes de couleur.
  - Universal Base Characters (gratuit) : têtes, corps, coiffures.
  - Universal Animation Library 1 (Pro, 120 animations, dont des sorts à deux mains) et 2 (Source).
  - Animations Mixamo (Adobe), téléchargées en FBX « Without Skin » et reciblées au chargement du jeu sur le squelette Quaternius (game/mixamo.ts : correspondance des os, déplacement du bassin recalculé, sur place). Ajouter une animation : déposer le fichier dans public/models/mixamo/ et l'inscrire dans MIXAMO_ANIMATIONS. Licence : utilisables dans le jeu, pas redistribuables comme fichiers séparés. En jeu : Mixamo_Cast_1H (Standing 1H Cast Spell 01) pour les buffs du Prêtre, Mixamo_Idle_03 (Standing Idle 03) pour l'incantation des buffs du Prêtre (les autres sorts gardent Spell_Simple_Idle_Loop ; l'incantation se règle par sort, CharacterAnimationSet.casts).
  - Page de visualisation des animations (développement) : `/animations.html` joue en boucle, en même temps, toutes les animations d'une page (18 par page) sur des personnages de classes tirées au hasard (ou d'une classe choisie), avec filtres (catégorie, déjà dans le jeu, recherche), vue (face, trois-quarts, profil, dos) et vitesse ; un clic sur un nom le copie. Elle charge les bibliothèques complètes (254 animations), à produire avec `node scripts/build-animation-catalog.mjs` (non versionnées).
  - Armes : packs gratuits (épée, bouclier, dagues, luth ; bâtons en FBX, à convertir).
- **Chaîne de production** : `scripts/import-assets.sh` extrait des archives téléchargées les fichiers utiles vers `assets-source/` (non versionné, ~730 Mo). `node scripts/build-assets.mjs` produit les modèles du jeu dans `packages/client/public/models/` : textures ramenées à 1024 px en WebP, animations triées et sans maillage (~4 Mo au total).
- **Personnages** : la tenue de chaque classe reçoit la tête du corps de base (découpée à la préparation, avec yeux et sourcils) et des cheveux teintés.
  | Classe | Tenue | Équipement |
  |---|---|---|
  | Gardien | Chevalier (homme), heaume | Épée, bouclier |
  | Lame | Rôdeur (homme), capuche | Deux dagues |
  | Arcaniste | Mage (femme), cheveux longs roux | Bâton de glace |
  | Prêtre | Noble (femme), chignon blond | Bâton à gemme dorée |
  | Barde | Paysan (homme), barbe | Dague, luth en bandoulière |
- **Couleurs d'équipe** : chaque joueur voit ses alliés en tenue bleue et ses ennemis en tenue rouge, quelle que soit son équipe (pas d'anneau de couleur aux pieds). Prêtre et Arcaniste utilisent les variantes du pack ; pour le Gardien (même armure argent dans les deux camps), la Lame et le Barde, le tissu est recoloré à la préparation des assets. Le Gardien, presque tout en armure, porte en plus un bouclier peint à la couleur de son équipe.
- **Au-dessus des têtes** : le pictogramme de la classe, suivi du pseudo en bleu pour un allié, ou du nom de la classe en rouge pour un ennemi.
- **Animations** : au repos, course avant (vitesse de lecture calée sur la vitesse réelle), recul (course jouée à l'envers), marche sous 2,5 m/s (reprise après un root, par exemple), pas de côté (marche latérale accélérée, les pieds glissent un peu), un coup d'auto-attaque par classe (prioritaire, joué sur tout le corps même en courant), compétences, incantation, mort. Les packs n'ont pas de course latérale ni arrière ; la bibliothèque 1 en version Source en a.
- **Réactions aux coups** : léger recul sur un dégât, coup marqué sur un critique ou au-delà de 200 dégâts, projection quand on est stun, parade quand un Gardien bloque (jamais quand il est stun). Stun : après la projection, un « non » de la tête (Idle_No), puis il titube (Zombie_Idle) jusqu'à la fin ; il recule toujours sous les coups. Root : marche entravée (Zombie_Walk_Fwd) tant qu'il avance lentement. Rage : transformation (MonsterTransformation, 2,2 s) jouée une fois au lancement, à la place du déplacement ; une auto-attaque ne coupe pas l'animation d'une compétence. Une réaction au plus toutes les 0,5 s, jamais par-dessus un coup ou une compétence du personnage (sauf le stun) ; elles se jouent aussi en courant. Rien de particulier pour le mez (on le confondrait avec la mort), l'esquive, la bulle et l'interception.
- **Armes en main** : épée et dagues tenues dans le poing (poignée perpendiculaire aux doigts, lame côté pouce). Bâtons de l'Arcaniste et du Prêtre tenus verticaux au repos ; pendant l'incantation et le geste du sort, le bâton passe dans le dos (en travers, le haut au-dessus de l'épaule droite), puis revient en main.
- **Calage des animations de compétence** : réglé sur la page `/animation-lab.html` (développement), pour toutes les classes. Pour chaque compétence on choisit l'animation (parmi toutes celles chargées), la portion jouée sur une timeline de l'animation entière et la vitesse (réglette). Sort incanté : une fenêtre de la longueur du temps d'incantation × vitesse se déplace sur la timeline ; son début part avec l'incantation, sa fin est le départ du sort ; une seconde poignée règle jusqu'où le geste continue après (à la même vitesse), puis retour en fondu à la pose normale ; si l'incantation est interrompue, le geste s'arrête aussitôt. Compétence instantanée : début, fin et vitesse de la portion jouée. Effets à particules portés par le personnage, réglés sur la même page : plusieurs par compétence (incantée ou instantanée), chacun sur sa ligne d'une piste « Effets » sous la timeline (début et fin dans la portion jouée, à glisser), avec l'effet choisi parmi ceux du jeu (formation de feu ou de givre, traînées, éclats, spirale de buff, notes…), un point d'accroche (entre les mains, main droite ou gauche, bout de l'arme, tête, poitrine, pieds) et un décalage en mètres (gauche/droite, bas/haut, arrière/avant, par curseurs) dans le repère du personnage. Des points clés de position (losanges sur la barre de l'effet, posés à l'instant montré, déplaçables) font bouger l'effet pendant le geste : chacun a son accroche et son décalage, et la position va de l'un à l'autre à vitesse constante, en passant progressivement d'une accroche à l'autre (par exemple d'entre les mains à la main qui lance) ; avant le premier et après le dernier, l'effet reste sur celui-ci. En jeu, ils suivent la progression du geste (ralentis ou accélérés avec lui) et s'arrêtent avec lui si l'incantation est interrompue. Un sort dont les effets n'ont pas été réglés garde ceux prévus dans le code (formation du Trait de feu et du Trait de givre entre les mains pendant toute l'incantation). Un bouton rejoue la séquence comme en jeu (même code d'animation et d'effets, barre d'incantation). Les réglages sont gardés en brouillon dans le navigateur puis enregistrés dans `packages/client/src/game/animationTuning.json`, qui fait foi pour le timing ; le tableur garde le nom de l'animation. Sans réglage, un sort incanté garde son calage du code : pour l'Arcaniste, un seul geste (moment fort mesuré, calé sur le départ du sort, vitesse 0,6 à 1,6, 0,5 s après) ; pour les autres, la pose d'incantation commune puis le geste du lancement. Les postures tenues (course de la Charge, garde du Rempart) ne se règlent pas sur cette page.
- **Décor** : un hameau autour d'une grande place pavée au centre, de la nature autour (Medieval Village MegaKit, Stylized Nature MegaKit, Fantasy Props MegaKit). Règle : ce qui a l'air de bloquer la vue la bloque vraiment ; dans la zone jouable, le décor qui n'est pas un obstacle reste sous le genou, les arbres restent hors de l'arène.
  - Ombres portées du soleil : personnages (armes comprises) et décor bâti (maisons, murets, cabanes, caisses, étals, camps) les projettent ; le sol et le décor les reçoivent. Une carte d'ombres de 2048 px sur 60 m autour de ce que regarde la caméra, bords adoucis. La nature et les effets n'en projettent pas, ni les petites pièces de tenue posées sur le corps (yeux, sourcils, barbe, accessoires, ceintures, brassards) : vues du soleil, elles restent dans la silhouette du corps. Coût mesuré en 8v8 : 0,6 ms par image, 60 images/s.
  - Performance (mesurée le 2026-11-10, 8v8, caméra dans la mêlée) : 60 images/s, rendu de 2,7 ms par image (médiane) ; serveur 0,04 ms par tick (médiane, budget 50 ms). Appels de dessin : environ 550 par image, dont deux tiers pour les personnages (environ 11 pièces chacun, chaque pièce dessinée pour l'image et pour l'ombre) ; environ 450 après le retrait des petites pièces des ombres. À faire quand les tenues seront stables : fusionner au chargement les pièces d'un personnage qui partagent un matériau (environ 190 appels de moins), en gardant à part les pièces qu'on voudrait modifier seules en cours de partie, avec un interrupteur pour travailler sur les tenues. Plus tard : ombre du décor bâti calculée une seule fois (environ 60 appels).
  - Fait : sol (herbe, chemins de terre des départs vers la place, pavés de la place), ciel avec soleil, brume au loin, lumière chaude. Le sol déborde de 50 m autour de l'arène pour accueillir la forêt.
  - Fait : hameau. Les maisons sont assemblées en jeu à partir des pièces du village (murs de 2 m, pierre en bas et colombages à l'étage pour les grandes, porte face à la place, fenêtres à volets, toit de tuiles, intérieur sombre derrière les ouvertures). Une maison entre la caméra et son personnage devient transparente. Murets et palissades : deux rangées de murs dos à dos (0,8 m d'épaisseur).
  - Fait : campements des zones de départ. Un anneau fin marque la limite du camp (on y est confiné pendant la préparation), deux bannières sur mât encadrent les sorties vers l'arène, une réserve basse (caisses, tonneaux, banc) occupe le fond du camp. Comme les tenues, anneau et bannières sont bleus pour son camp et rouges pour celui d'en face.
  - Fait : nature. Forêt dense autour de l'arène (arbres à partir de 8 m au-delà du bord, grands arbres tordus au fond), lisière de buissons et de rochers entre le bord et la forêt. Dans l'arène, sur l'herbe seulement : touffes d'herbe et cailloux, herbes hautes et fleurs dans les prairies, petits rochers sur les pentes, le tout sous le genou. Placement tiré d'une graine fixe (le même pour tous) ; chaque pièce est dessinée en une fois pour toutes ses copies (environ 3 000 copies, 60 images/s).
- **Effets visuels des sorts** (particules lumineuses, textures générées par le jeu) :
  - Fait (phase 1) : Trait de feu (boule de feu, traînée de flammes et fumée, explosion), Gel (traînée de givre, gerbe de cristaux), mez (traînée violette, éclat), silence (trait gris, bouffée éteinte), Déflagration (anneau de feu qui s'étend jusqu'au bord, flammes dans la zone), root de zone (vague d'éclats de glace), mez de zone (brume violette), soins (gerbe d'étincelles vertes ; Soin de groupe : étincelles sur toute la zone). Le disque qui montre la portée d'une zone reste, plus discret.
  - Mesuré en 8v8, caméra sur la mêlée : 60 images/s, jusqu'à 1 300 particules, rendu de 2,2 ms par image (médiane).
  - Fait (phase 2) : états qui durent. Mez : volutes violettes autour de la tête (en plus des « Zzz »). Stun : trois étoiles dorées en 3D qui tournent autour de la tête. Root : couronne de cristaux de glace et brume froide aux pieds ; les cristaux rapetissent à mesure que la vitesse revient. Bulle : c'est un buff (comme le bladeturn de DAoC) ; sa sphère, à peine teintée et cerclée d'un anneau lumineux aux reflets bleu-violet-rose, n'apparaît que 2 s (puis fondu) quand l'Arcaniste la lance ; pas quand un adversaire entre dans le champ de vision avec sa bulle déjà posée. Le reste du temps, seule l'icône du buff la signale. Quand elle absorbe un coup, elle éclate : anneau lumineux qui s'élargit et éclats irisés. Le silence n'a pas d'état qui dure (il interrompt seulement l'incantation).
  - Dégâts magiques subis : la cible d'un sort de feu (Trait de feu, Déflagration) brûle 1,2 s, flammes et fumée sur tout le corps, qui la suivent ; à l'arrivée de la boule pour le Trait de feu. Chaque sort de dégâts est associé à un type (feu, et plus tard glace, arcane…), chaque type à son effet. Aujourd'hui, seuls des sorts de feu infligent des dégâts magiques.
  - Fait (phase 3) : estafilade lumineuse en croissant et étincelles pour l'attaque dans le dos et l'attaque de flanc ; gerbe d'étincelles dorées sur tout coup critique ; spirale dorée pour les buffs ; rayon de lumière qui descend du ciel avec une pluie d'étincelles pour la résurrection ; notes de musique au lancement du Chant de vitesse et autour du Barde tant qu'il chante ; poussière aux pieds des joueurs accélérés qui courent ; flammèches rouges autour de la Lame pendant la Rage.
  - Fait : Rempart. Grandes flammes rouges autour du Gardien ; la zone de 30 m est marquée au sol pour tous les joueurs (bord crénelé, comme le sommet d'une tour vu de dessus, et léger voile vers l'intérieur ; elle épouse le relief). Les créneaux tournent le long du bord, dans le même sens pour tous : très vite à l'apparition, comme un rempart qui se dresse, puis ils ralentissent en 0,8 s jusqu'à environ 4,5 m/s (un tour en 40 s environ) ; l'icône du Rempart (tour crénelée) palpite au-dessus de la tête de chaque joueur protégé, Gardien compris. Zone et icône sont bleues pour son camp et rouges pour l'adversaire, comme les tenues. Un dôme sur la zone a été essayé puis abandonné : à 30 m de rayon, la caméra se retrouve dedans et on ne le lit pas.
  - Fait : Trait de feu et Trait de givre en incantation. Le trait se forme entre les mains de l'Arcaniste : des particules convergent vers un petit cœur lumineux, de feu (orange à jaune-blanc) ou de givre (bleu à blanc).
- **Musique** (crédits obligatoires, affichés sur l'écran d'accueil ; voir CREDITS.md) : « Woodland Fantasy » de Matthew Pablo dans les menus (accueil, file d'attente, choix de classe), en boucle sans son silence final ; « The Last Encounter » d'Eric Matyas (soundimage.org ; version originale, boucle de 169 s) à partir de la préparation, doucement, puis à volume normal en combat et de nouveau doucement à la fin de la partie. Fondus enchaînés de 2 s. Le navigateur interdit le son avant la première interaction : la musique démarre au premier clic ou à la première touche.
- **Sons** : packs gratuits du dossier « sounds effect » (Kenney, OpenGameArt, itch.io…), convertis en AAC mono au volume harmonisé (scripts/build-sounds.mjs, catalogue src/audio/samples.json, écoute sur soundboard.html). Chaque son a des variantes tirées au hasard, à vitesse légèrement variable. La page soundboard.html (développement) catalogue tous les sons des packs : écoute d'un clic, bouton pour copier le nom à reporter dans la colonne Son du tableur, marque « En jeu » (avec les lignes du code qui le jouent) pour ceux déjà utilisés, filtres par pack et par usage. Les fichiers bruts écoutables sont produits par scripts/build-sound-catalog.mjs (public/dev-sounds, non versionné). Un fichier brut choisi devient un groupe de samples.json au moment de l'intégrer. Crédits à ajouter à ce moment-là pour les cris « aargh » 0 à 2 (CC BY 3.0, freesound.org). Les bundles gratuits Sonniss #GameAudioGDC (libres de droits, sans crédit) sont rangés dans assets-source/sounds/Sonniss GDC 2026, un pack par bibliothèque : la partie 1 en entier, et des parties 2 et 3 seulement les sons utiles au jeu (armes, voix, magie, glace, interface, cor, ambiances), listés dans scripts/sonniss-selection.json ; les fichiers d'origine ne doivent jamais être publiés tels quels.
  - Coups : geste de l'arme (épée pour le Gardien, plus léger pour les autres) puis le coup qui porte, 0,15 s après ; un critique ou une attaque dans le dos sonne plus grave et plus fort. Blocage : bois ; coup de bouclier : bois lourd et choc sourd.
  - Voix : cris d'homme pour Gardien, Lame et Barde, une voix de femme différente pour l'Arcaniste et la Prêtre. Cri de douleur au plus une fois toutes les 1,5 s par personnage et une fois sur deux ; cri de mort ; soupir quand une femme est soignée. Pas de cri de mort de femme dans les packs : son cri de douleur, plus grave.
  - Pas : à chaque foulée (2,5 m en course, 1 m en marche), selon le sol (pavés de la place, herbe, terre des chemins).
  - Sorts : feu, glace, soins enregistrés ; sons Fantasy pour mez, silence, buffs, purification et résurrection (attribution provisoire, à valider à l'écoute). Victoire et défaite : jingles. Alertes, bulle, esquive, Chant de vitesse, interface : sons rétro générés (ZzFX).
- **Taille** : personnages agrandis de 20 % (2,2 m) pour la lisibilité, purement visuel. Caméra à 26 m par défaut, de 10 à 55 m à la molette.
- Fait : les 5 classes. Bâtons en FBX, lus directement par Babylon (couleurs appliquées par le jeu).
