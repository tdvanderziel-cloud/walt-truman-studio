// ============================================================
//  THE LOOK OF THE VIDEO — change sizes, colours and positions here.
//  Canvas: 1080 x 1920 (9:16), 30 fps. y = 0 is the top.
// ============================================================

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const COLORS = {
  navy: "#1F2B4D",
  navyDark: "#141C33",
  copper: "#C27A3E",
  white: "#FFFFFF",
  captionHighlight: "#FFD84D",
};

// Verdict stamp colours (see brand/video-template.md)
export const VERDICT_STYLE: Record<string, { label: string; color: string; text: string }> = {
  Klopt: { label: "TRUE", color: "#2E9E5B", text: "#FFFFFF" },
  "Mist context": { label: "MISSING CONTEXT", color: "#F2C230", text: "#2B2300" },
  Misleidend: { label: "MISLEADING", color: "#F28C28", text: "#2B1600" },
  Onjuist: { label: "FALSE", color: "#D93B3B", text: "#FFFFFF" },
  "Nog onbekend": { label: "UNPROVEN", color: "#8A8F98", text: "#FFFFFF" },
};

export const FONTS = {
  heading: "Montserrat, sans-serif",
  stamp: "Anton, Impact, sans-serif",
};

// Platform safe zones: TikTok/Instagram put buttons on the right and
// caption/account text at the bottom. Keep important things out of these.
export const SAFE = {
  top: 130,
  right: 150, // right-hand button column
  bottom: 360, // caption + account name area
  left: 40,
};

export const LAYOUT = {
  claimBar: { top: SAFE.top, left: SAFE.left, right: SAFE.right, fontSize: 52 },
  original: { fontSize: 30 }, // "Original: @account · date" under the claim bar
  walt: {
    height: 760, // ~40% of 1920
    left: -40,
    bottom: -120, // negative = comes up from below the frame
  },
  captions: { top: 930, fontSize: 70, maxWords: 4 },
  sourceCard: { top: 1150, left: 560, width: 370 },
  stamp: { top: 1120, left: 470, size: 420, rotateDeg: -9 },
  background: { dimDuringExplanation: 0.38 }, // 0 = no dim, 1 = black
};
