#!/usr/bin/env bash
# Extrait, depuis les archives Quaternius et le pack d'aquarelles de Voxel Core Lab téléchargés, uniquement les
# fichiers utiles au jeu vers assets-source/ (fichiers bruts, non versionnés : trop lourds).
# Usage : scripts/import-assets.sh [dossier des archives, par défaut ~/Downloads]
set -euo pipefail

SRC="${1:-$HOME/Downloads}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets-source"

ALL="$SRC/All in One - Quaternius[Patreon].zip"
OUTFITS="$SRC/Modular Character Outfits - Fantasy[Source].zip"
UAL1="$SRC/Universal Animation Library[Pro].zip"
UAL2="$SRC/Universal Animation Library 2[Source].zip"
# Gratuit (prix libre), CC0 : https://voxelcorelab.itch.io/watercolor-terrain-textures
WATERCOLOR="$SRC/VoxelCoreLab_Watercolor_Terrain_Textures_1024px.zip"

for f in "$ALL" "$OUTFITS" "$UAL1" "$UAL2" "$WATERCOLOR"; do
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

# Animations : bibliothèque 1 (Pro) et 2 (Source), sans root motion (le serveur déplace les personnages).
extract "$UAL1" "$OUT/animations" 'Unreal-Godot/UAL1.glb'
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

# Sol : herbe et terre peintes à l'aquarelle (Voxel Core Lab), pavés tirés du village médiéval.
VILLAGE='Medieval/Medieval Village MegaKit\[Standard\] - Jan 2025'
extract "$WATERCOLOR" "$OUT/ground" '*/Grass_01.png' '*/Dirt_03.png' '*/LICENCE.txt'
extract "$ALL" "$OUT/ground" "$VILLAGE/Textures/T_UnevenBrick_BaseColor.png"

# Hameau : pièces modulaires du village (murs, toits, portes, fenêtres…) avec leurs textures,
# et accessoires du Fantasy Props (étals, caisses, tonneaux, bannières).
extract "$ALL" "$OUT/village" "$VILLAGE/glTF/*"
extract "$ALL" "$OUT/props" "$PROPS/*.gltf" "$PROPS/*.bin" "$PROPS/T_Trim_*"

# Nature autour de l'arène : arbres, buissons, rochers, herbes et fleurs.
extract "$ALL" "$OUT/nature" 'Nature/Stylized Nature MegaKit - July 2024/glTF/*'

# Armes en FBX (bâtons, boucliers, dagues…) : à convertir en glTF plus tard si besoin.
extract "$ALL" "$OUT/weapons-fbx/ultimate-rpg-items" 'Medieval/Ultimate RPG Items Pack - Aug 2019/FBX/*'
extract "$ALL" "$OUT/weapons-fbx/medieval-weapons" 'Medieval/Medieval Weapons Pack - Sept 2018/FBX/*'
extract "$ALL" "$OUT/weapons-fbx/rpg-asset-pack" 'Medieval/RPG Asset Pack - May 2017/FBX/*'

# Sons : dossier "sounds effect" des Téléchargements (packs déjà décompressés), copié tel quel.
SOUNDS="$SRC/sounds effect"
[[ -d "$SOUNDS" ]] || { echo "Dossier introuvable : $SOUNDS" >&2; exit 1; }
mkdir -p "$OUT/sounds"
rsync -a --exclude .DS_Store --exclude '*.zip' "$SOUNDS/" "$OUT/sounds/"
# Packs restés en archive (ex. « Magic SFX Preview Pack.zip ») : décompressés dans un dossier à leur nom.
for zip in "$SOUNDS"/*.zip; do
  [[ -e "$zip" ]] || continue
  pack="$OUT/sounds/$(basename "$zip" .zip)"
  mkdir -p "$pack"
  unzip -oq "$zip" -x '__MACOSX/*' -d "$pack"
done

# Bundles gratuits Sonniss #GameAudioGDC 2026 (libres de droits, sans crédit obligatoire) : seuls les sons utiles
# au jeu (scripts/sonniss-selection.json), rangés dans "Sonniss GDC 2026" (un sous-dossier par bibliothèque).
node "$(dirname "$0")/import-sonniss.mjs" "$SRC" "$OUT"

# Musiques : « The Last Encounter » (Eric Matyas, soundimage.org) et « Woodland Fantasy » (Matthew Pablo) —
# crédits obligatoires, voir CREDITS.md.
MUSIC="$SRC/The Last Encounter Collection"
[[ -d "$MUSIC" ]] || { echo "Dossier introuvable : $MUSIC" >&2; exit 1; }
mkdir -p "$OUT/music"
rsync -a --exclude .DS_Store "$MUSIC/" "$OUT/music/"
cp "$SRC/Woodland Fantasy.mp3" "$OUT/music/"

echo "Assets extraits dans $OUT :"
du -sh "$OUT"/*
