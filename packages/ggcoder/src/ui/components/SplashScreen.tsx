import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";

// ── ASCII logo lines (same block chars as Banner) ───────────
const LOGO_LINES = [
  " \u2584\u2580\u2580\u2580 \u2584\u2580\u2580\u2580",
  " \u2588 \u2580\u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

// Gradient palette — blue to violet, matching the project theme
const GRADIENT = [
  "#60a5fa",
  "#6da1f9",
  "#7a9df7",
  "#8799f5",
  "#9495f3",
  "#a18ff1",
  "#a78bfa",
  "#a18ff1",
  "#9495f3",
  "#8799f5",
  "#7a9df7",
  "#6da1f9",
];

const TITLE = "GG Coder";

// ── Animated gradient text ──────────────────────────────────

function AnimatedGradientText({ text, shift }: { text: string; shift: number }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[(colorIdx + shift) % GRADIENT.length];
      chars.push(
        <Text key={i} color={color} bold>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}

// ── Typewriter text reveal ──────────────────────────────────

function TypewriterText({
  text,
  revealedCount,
  color,
  bold,
  dimColor,
}: {
  text: string;
  revealedCount: number;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}) {
  const visible = text.slice(0, revealedCount);
  return (
    <Text color={color} bold={bold} dimColor={dimColor}>
      {visible}
    </Text>
  );
}

// ── Splash Screen ───────────────────────────────────────────

interface SplashScreenProps {
  version: string;
  onDone: () => void;
}

const LOGO_REVEAL_INTERVAL = 60; // ms per logo line
const TITLE_REVEAL_INTERVAL = 50; // ms per character
const HOLD_DURATION = 400; // ms to hold after fully revealed
const GRADIENT_INTERVAL = 150; // ms per gradient shift

export function SplashScreen({ version, onDone }: SplashScreenProps) {
  // Phase: 0 = logo reveal, 1 = title reveal, 2 = hold, 3 = done
  const [logoLinesShown, setLogoLinesShown] = useState(0);
  const [titleCharsShown, setTitleCharsShown] = useState(0);
  const [gradientShift, setGradientShift] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [phase, setPhase] = useState(0);

  // Gradient animation — runs throughout
  useEffect(() => {
    const timer = setInterval(() => {
      setGradientShift((s) => (s + 1) % GRADIENT.length);
    }, GRADIENT_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Sparkle spinner
  useEffect(() => {
    const timer = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Phase 0: Reveal logo lines one by one
  useEffect(() => {
    if (phase !== 0) return;
    if (logoLinesShown >= LOGO_LINES.length) {
      setPhase(1);
      return;
    }
    const timer = setTimeout(() => {
      setLogoLinesShown((n) => n + 1);
    }, LOGO_REVEAL_INTERVAL);
    return () => clearTimeout(timer);
  }, [phase, logoLinesShown]);

  // Phase 1: Reveal title characters one by one
  useEffect(() => {
    if (phase !== 1) return;
    if (titleCharsShown >= TITLE.length) {
      setPhase(2);
      return;
    }
    const timer = setTimeout(() => {
      setTitleCharsShown((n) => n + 1);
    }, TITLE_REVEAL_INTERVAL);
    return () => clearTimeout(timer);
  }, [phase, titleCharsShown]);

  // Phase 2: Hold, then signal done
  useEffect(() => {
    if (phase !== 2) return;
    const timer = setTimeout(() => {
      setPhase(3);
      onDone();
    }, HOLD_DURATION);
    return () => clearTimeout(timer);
  }, [phase, onDone]);

  const versionText = `v${version}`;

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      marginTop={2}
      marginBottom={1}
    >
      {/* Logo — revealed line by line */}
      {LOGO_LINES.slice(0, logoLinesShown).map((line, i) => (
        <AnimatedGradientText key={i} text={line} shift={gradientShift + i * 2} />
      ))}

      {/* Title + version — typewriter reveal */}
      {phase >= 1 && (
        <Box marginTop={1}>
          <Text color={GRADIENT[gradientShift % GRADIENT.length]} bold>
            {SPINNER_FRAMES[spinnerFrame]}{" "}
          </Text>
          <TypewriterText text={TITLE} revealedCount={titleCharsShown} color="#e5e7eb" bold />
          {titleCharsShown >= TITLE.length && <Text color="#6b7280"> {versionText}</Text>}
        </Box>
      )}

      {/* Author credit — appears after title is fully revealed */}
      {titleCharsShown >= TITLE.length && (
        <Box>
          <Text color="#6b7280">By </Text>
          <Text color="#e5e7eb" bold>
            Ken Kai
          </Text>
        </Box>
      )}
    </Box>
  );
}
