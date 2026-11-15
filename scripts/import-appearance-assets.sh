#!/usr/bin/env bash
# Extrait les packs de l'éditeur d'apparence (onglets Apparence et Placement de animation-lab.html) vers
# assets-source/ (fichiers bruts, non versionnés), avant scripts/prepare-appearance-lab.mjs :
# - Quaternius : Characters - Fantasy Races Kit (Source), Universal Base Characters (Source) ;
# - cecchigl : Fantasy Monsters Pack (dossier décompressé, humanoïdes seulement) ;
# - Bluefrost Lowpoly : Hearthfold Weapons & Shields, Hearthfold Armor & Wearables.
# Usage : scripts/import-appearance-assets.sh [dossier des archives, par défaut ~/Downloads/characters-and-bg-assets]
set -euo pipefail

SRC="${1:-$HOME/Downloads/characters-and-bg-assets}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets-source"

RACES="$SRC/Characters - Fantasy Races Kit[Source].zip"
BASE="$SRC/Universal Base Characters[Source].zip"
MONSTERS="$SRC/FantasyMonstersPack_GLB"
WEAPONS="$SRC/Hearthfold_Weapons_Shields_Pack_v1.0.zip"
ARMOR="$SRC/Hearthfold_Armor_Wearables_Pack_v1.0.zip"

for f in "$RACES" "$BASE" "$WEAPONS" "$ARMOR"; do
  [[ -f "$f" ]] || { echo "Archive introuvable : $f" >&2; exit 1; }
done
[[ -d "$MONSTERS/GLB/Humanoids" ]] || { echo "Dossier introuvable : $MONSTERS/GLB/Humanoids" >&2; exit 1; }

# Extrait à plat (-j) les fichiers des motifs donnés vers la destination.
extract() { # archive destination motif...
  local zip="$1" dest="$2"
  shift 2
  mkdir -p "$dest"
  unzip -o -j -q "$zip" "$@" -d "$dest"
}

rm -rf "$OUT/races" "$OUT/base-full" "$OUT/monsters" "$OUT/hearthfold-weapons" "$OUT/hearthfold-armor"

# Races : un GLB par race et par genre (textures incluses).
extract "$RACES" "$OUT/races" '*/Exports/GLB (Godot-Unreal)/*.glb' '*/License_Source.txt'

# Corps humains (Superhero, Regular, Teen) et coiffures attachées à l'os de la tête. Les corps référencent deux
# textures sous un nom qui n'existe pas dans l'archive (comme la version gratuite, voir import-assets.sh).
extract "$BASE" "$OUT/base-full/bodies" 'Base Characters/Exports/Godot - UE/*'
for gender in Male Female; do
  extract "$BASE" "$OUT/base-full/hair/$gender" "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/$gender/*"
done
extract "$BASE" "$OUT/base-full" 'License_Source.txt'
for name in T_Eye_Normal T_Hair_1_Normal; do
  [[ -f "$OUT/base-full/bodies/${name}_png.png" ]] || cp "$OUT/base-full/bodies/$name.png" "$OUT/base-full/bodies/${name}_png.png"
done

mkdir -p "$OUT/monsters"
cp "$MONSTERS"/GLB/Humanoids/*.glb "$MONSTERS/README.txt" "$OUT/monsters/"

# Hearthfold : versions GLB seulement (ni FBX, ni Blender, ni icônes).
mkdir -p "$OUT/hearthfold-weapons" "$OUT/hearthfold-armor"
unzip -o -q "$WEAPONS" -x '*.fbx' '*Icon*' '*.blend' -d "$OUT/hearthfold-weapons"
unzip -o -q "$ARMOR" -x '*.fbx' '*.blend' -d "$OUT/hearthfold-armor"

echo "Packs de l'éditeur d'apparence extraits dans $OUT"
