import chalk from "chalk";
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import wrapAnsi from "wrap-ansi";
import type { Theme } from "../theme/theme.js";

const COLUMN_PADDING = 2;
const TABLE_MARGIN = 2;
const MIN_COLUMN_WIDTH = 5;

function colorize(text: string, color: string | undefined): string {
  return color ? chalk.hex(color)(text) : text;
}

function visualWidth(text: string): number {
  return stringWidth(stripAnsi(text));
}

function wrapAnsiLines(text: string, width: number): string[] {
  return wrapAnsi(text || " ", Math.max(1, width), { hard: true, wordWrap: true }).split("\n");
}

function padRightAnsi(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visualWidth(text)));
}

function normalizedCell(
  rows: readonly (readonly string[])[],
  rowIndex: number,
  colIndex: number,
): string {
  return rows[rowIndex]?.[colIndex] ?? "";
}

export interface RenderAnsiTableOptions {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  terminalWidth: number;
  theme: Theme;
}

export function renderAnsiTable({
  headers,
  rows,
  terminalWidth,
  theme,
}: RenderAnsiTableOptions): string[] {
  const allRows = [headers, ...rows];
  const numColumns = Math.max(headers.length, ...rows.map((row) => row.length), 1);

  const constraints = Array.from({ length: numColumns }, (_, colIndex) => {
    const values = Array.from({ length: allRows.length }, (_, rowIndex) =>
      normalizedCell(allRows, rowIndex, colIndex),
    );
    const maxContentWidth = Math.max(...values.map(visualWidth), MIN_COLUMN_WIDTH);
    const maxWordWidth = Math.max(
      ...values.flatMap((value) =>
        stripAnsi(value)
          .split(/\s+/u)
          .filter(Boolean)
          .map((word) => stringWidth(word)),
      ),
      MIN_COLUMN_WIDTH,
    );
    return { minWidth: maxWordWidth, maxWidth: Math.max(maxWordWidth, maxContentWidth) };
  });

  const fixedOverhead = numColumns + 1 + numColumns * COLUMN_PADDING;
  const availableWidth = Math.max(0, terminalWidth - fixedOverhead - TABLE_MARGIN);
  const totalMinWidth = constraints.reduce((sum, item) => sum + item.minWidth, 0);
  let finalContentWidths: number[];

  if (totalMinWidth > availableWidth) {
    const shortColumns = constraints.filter((item) => item.maxWidth <= MIN_COLUMN_WIDTH);
    const totalShortColumnWidth = shortColumns.reduce((sum, item) => sum + item.minWidth, 0);
    const finalTotalShortColumnWidth =
      totalShortColumnWidth >= availableWidth ? 0 : totalShortColumnWidth;
    const scalableWidth = totalMinWidth - finalTotalShortColumnWidth;
    const scale =
      scalableWidth > 0 ? (availableWidth - finalTotalShortColumnWidth) / scalableWidth : 0;
    finalContentWidths = constraints.map((item) => {
      if (item.maxWidth <= MIN_COLUMN_WIDTH && finalTotalShortColumnWidth > 0) return item.minWidth;
      return Math.max(1, Math.floor(item.minWidth * scale));
    });
  } else {
    const surplus = availableWidth - totalMinWidth;
    const totalGrowthNeed = constraints.reduce(
      (sum, item) => sum + (item.maxWidth - item.minWidth),
      0,
    );
    finalContentWidths = constraints.map((item) => {
      if (totalGrowthNeed === 0) return item.minWidth;
      const share = (item.maxWidth - item.minWidth) / totalGrowthNeed;
      return Math.min(item.maxWidth, item.minWidth + Math.floor(surplus * share));
    });
  }

  const actualColumnWidths = Array.from({ length: numColumns }, () => 0);
  const wrapAndMeasureRow = (row: readonly string[]) =>
    Array.from({ length: numColumns }, (_, colIndex) => {
      const contentWidth = Math.max(1, finalContentWidths[colIndex] ?? 1);
      const lines = wrapAnsiLines(row[colIndex] ?? "", contentWidth).map((line) => {
        actualColumnWidths[colIndex] = Math.max(
          actualColumnWidths[colIndex] ?? 0,
          visualWidth(line),
        );
        return line;
      });
      return lines.length > 0 ? lines : [""];
    });

  const wrappedHeaders = wrapAndMeasureRow(headers);
  const wrappedRows = rows.map((row) => wrapAndMeasureRow(row));
  const adjustedWidths = actualColumnWidths.map((width) => width + COLUMN_PADDING);

  const border = (left: string, middle: string, right: string): string =>
    colorize(
      left + adjustedWidths.map((width) => "─".repeat(Math.max(0, width))).join(middle) + right,
      theme.border,
    );

  const visualRowLines = (cells: string[][], isHeader = false): string[] => {
    const maxHeight = Math.max(...cells.map((cell) => cell.length), 1);
    return Array.from({ length: maxHeight }, (_, lineIndex) => {
      const row = cells
        .map((cell, index) => {
          const contentWidth = Math.max(0, (adjustedWidths[index] ?? 0) - COLUMN_PADDING);
          const content = padRightAnsi(cell[lineIndex] ?? "", contentWidth);
          return ` ${isHeader ? chalk.bold(colorize(content, theme.link)) : content} `;
        })
        .join(colorize("│", theme.border));
      return colorize("│", theme.border) + row + colorize("│", theme.border);
    });
  };

  return [
    border("┌", "┬", "┐"),
    ...visualRowLines(wrappedHeaders, true),
    border("├", "┼", "┤"),
    ...wrappedRows.flatMap((row) => visualRowLines(row)),
    border("└", "┴", "┘"),
  ];
}
