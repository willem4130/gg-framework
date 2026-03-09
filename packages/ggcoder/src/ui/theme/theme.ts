import { createContext, useContext } from "react";
import darkTheme from "./dark.json" with { type: "json" };
import lightTheme from "./light.json" with { type: "json" };

export type Theme = typeof darkTheme;

export function loadTheme(name: "dark" | "light"): Theme {
  return name === "light" ? lightTheme : darkTheme;
}

export const ThemeContext = createContext<Theme>(darkTheme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
