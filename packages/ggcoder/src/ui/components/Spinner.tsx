import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { useTheme } from "../theme/theme.js";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";

export function Spinner({ label }: { label?: string }) {
  const theme = useTheme();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color={theme.spinnerColor}>
      {SPINNER_FRAMES[frame]} {label && <Text dimColor>{label}</Text>}
    </Text>
  );
}
