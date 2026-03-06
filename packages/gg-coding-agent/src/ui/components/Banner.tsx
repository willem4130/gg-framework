import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";
import { getModel } from "../../core/model-registry.js";
import type { Provider } from "@kenkaiiii/gg-ai";

interface BannerProps {
  version: string;
  model: string;
  provider: Provider;
  cwd: string;
}

const LOGO_LINES = [
  " \u2584\u2580\u2580\u2580 \u2584\u2580\u2580\u2580",
  " \u2588 \u2580\u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

// Extended gradient with reverse path for smooth animation loop
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

const GAP = "   ";

export function Banner({ version, model, cwd }: BannerProps) {
  const theme = useTheme();
  const modelInfo = getModel(model);
  const modelName = modelInfo?.name ?? model;

  const home = process.env.HOME ?? "";
  const displayPath = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

  // Animated gradient shift
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setShift((s) => (s + 1) % GRADIENT.length);
    }, 150);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <GradientText text={LOGO_LINES[0]} shift={shift} />
        <Text>{GAP}</Text>
        <Text color={theme.primary} bold>
          GG Coder
        </Text>
        <Text color={theme.textDim}> v{version}</Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[1]} shift={shift} />
        <Text>{GAP}</Text>
        <Text color={theme.secondary}>{modelName}</Text>
        <Text color={theme.textDim}> · By </Text>
        <Text color={theme.text} bold>
          Ken Kai
        </Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[2]} shift={shift} />
        <Text>{GAP}</Text>
        <Text color={theme.textDim}>{displayPath}</Text>
      </Box>
    </Box>
  );
}

function GradientText({ text, shift = 0 }: { text: string; shift?: number }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[(colorIdx + shift) % GRADIENT.length];
      chars.push(
        <Text key={i} color={color}>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}
