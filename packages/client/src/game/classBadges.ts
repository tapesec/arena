import type { ClassId } from "@arena/shared";

// Pictogramme (SVG, dans un carré de 24 × 24) et couleur de rôle de chaque classe,
// affichés dans un badge au-dessus de la tête des personnages.
export const CLASS_BADGES: Record<ClassId, { color: string; icon: string }> = {
  // Écu : contour blanc, moitié droite à la couleur du rôle, comme un blason
  gardien: {
    color: "#7d8a99",
    icon:
      '<path d="M12 1.5l9 3.2v6.6c0 5.6-3.9 9.6-9 11.2-5.1-1.6-9-5.6-9-11.2V4.7z" fill="#fff"/>' +
      '<path d="M12 4.6l6 2.1v4.9c0 3.9-2.6 6.8-6 8.1z" fill="#7d8a99"/>',
  },
  // Croix
  pretre: {
    color: "#2f9e57",
    icon: '<path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" fill="#fff"/>',
  },
  // Note de musique
  barde: {
    color: "#8a4fd1",
    icon: '<path d="M10 4h10v4h-7v9.5a3.5 3.5 0 1 1-3-3.46z" fill="#fff"/>',
  },
  // Étoile magique
  arcaniste: {
    color: "#e0751f",
    icon: '<path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z" fill="#fff"/>',
  },
  // Épées croisées
  lame: {
    color: "#c93b3b",
    icon: '<path d="M5 5l14 14M19 5L5 19" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
  },
};
