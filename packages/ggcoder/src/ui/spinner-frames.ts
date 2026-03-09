// Sparkle character set — gives a more distinctive, playful feel
// compared to the standard braille dots every other CLI uses.
export const SPINNER_FRAMES =
  process.platform === "darwin"
    ? ["\u00B7", "\u2726", "\u2733", "\u2217", "\u273B", "\u273D"]
    : ["\u00B7", "\u2726", "*", "\u2217", "\u273B", "\u273D"];

export const SPINNER_INTERVAL = 120;
