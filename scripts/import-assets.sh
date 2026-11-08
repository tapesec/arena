#!/usr/bin/env bash
# Extrait, depuis les archives Quaternius téléchargées, uniquement les fichiers utiles au jeu
# vers assets-source/ (fichiers bruts, non versionnés : trop lourds).
# Usage : scripts/import-assets.sh [dossier des archives, par défaut ~/Downloads]
set -euo pipefail

SRC="${1:-$HOME/Downloads}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets-source"

ALL="$SRC/All in One - Quaternius[Patreon].zip"
OUTFITS="$SRC/Modular Character Outfits - Fantasy[Source].zip"
UAL2="$SRC/Universal Animation Library 2[Source].zip"

for f in "$ALL" "$OUTFITS" "$UAL2"; do
  [[ -f "$f" ]] || { echo "Archive introuvable : $f" >&2; exit 1; }
done

# unzip interprète [ ] comme des jokers : on les échappe dans les motifs.
extract() { # archive destination motif...
  local zip="$1" dest="$2"
  shift 2
  mkdir -p "$dest"
  unzip -o -j -q "$zip" "$@" -d "$dest"
}

rm -rf "$OUT"

# Tenues (version Source) : tenues complètes, pièces modulaires, variantes de textures.
extract "$OUTFITS" "$OUT/outfits/outfits" '*/Exports/glTF (Godot-Unreal)/Outfits/*'
extract "$OUTFITS" "$OUT/outfits/parts" '*/Exports/glTF (Godot-Unreal)/Modular Parts/*'
for style in Knight Noble Peasant Ranger Wizard; do
  extract "$OUTFITS" "$OUT/outfits/textures/$style" "*/Textures/$style/T_*"
done
extract "$OUTFITS" "$OUT/outfits" '*/License_Source.txt' '*/Readme.txt' '*/Preview.jpg'

# Corps de base (gratuit) : têtes et corps, cheveux attachés à l'os de la tête.
BASE='Characters and Animals/Universal Base Characters\[Standard\]'
extract "$ALL" "$OUT/base/bodies" "$BASE/Base Characters/Godot - UE/*"
extract "$ALL" "$OUT/base/hair" "$BASE/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/*"
extract "$ALL" "$OUT/base" "$BASE/License*"
# Les corps de base référencent deux textures sous un nom qui n'existe pas dans l'archive.
cp "$OUT/base/bodies/T_Eye_Normal.png" "$OUT/base/bodies/T_Eye_Normal_png.png"
cp "$OUT/base/bodies/T_Hair_1_Normal.png" "$OUT/base/bodies/T_Hair_1_Normal_png.png"

# Animations : bibliothèque 1 (gratuite) et 2 (Source), sans root motion (le serveur déplace les personnages).
extract "$ALL" "$OUT/animations" 'Animation/Universal Animation Library 1\[Standard\]/Unreal-Godot/UAL1_Standard.glb'
extract "$UAL2" "$OUT/animations" 'Unreal-Godot/UAL2.glb'
extract "$UAL2" "$OUT/animations" 'Female Mannequin/Unreal-Godot/Mannequin_F.glb'

# Armes et objets tenus en main, déjà en glTF.
extract "$ALL" "$OUT/weapons" \
  'Game Kits/Pirate Kit - Nov 2023/glTF/Weapon_Lute.gltf' \
  'Game Kits/Pirate Kit - Nov 2023/glTF/Weapon_Dagger.gltf' \
  'Game Kits/Pirate Kit - Nov 2023/glTF/Weapon_Sword_1.gltf' \
  'Game Kits/Pirate Kit - Nov 2023/glTF/Weapon_Sword_2.gltf'
PROPS='Medieval/Fantasy Props MegaKit\[Standard\] - June 2025/Exports/glTF'
extract "$ALL" "$OUT/weapons" "$PROPS/Sword_Bronze.*" "$PROPS/Shield_Wooden.*" "$PROPS/T_Trim_*"

# Sol : bruit de terrain (base de l'herbe et de la terre) et pavés, tirés du village médiéval.
VILLAGE='Medieval/Medieval Village MegaKit\[Standard\] - Jan 2025'
extract "$ALL" "$OUT/ground" "$VILLAGE/Textures/T_Noise_Terrain.png" "$VILLAGE/Textures/T_UnevenBrick_BaseColor.png"

# Armes en FBX (bâtons, boucliers, dagues…) : à convertir en glTF plus tard si besoin.
extract "$ALL" "$OUT/weapons-fbx/ultimate-rpg-items" 'Medieval/Ultimate RPG Items Pack - Aug 2019/FBX/*'
extract "$ALL" "$OUT/weapons-fbx/medieval-weapons" 'Medieval/Medieval Weapons Pack - Sept 2018/FBX/*'
extract "$ALL" "$OUT/weapons-fbx/rpg-asset-pack" 'Medieval/RPG Asset Pack - May 2017/FBX/*'

echo "Assets extraits dans $OUT :"
du -sh "$OUT"/*
