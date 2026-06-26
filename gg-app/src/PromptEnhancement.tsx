import type { PromptSegment } from "./agent";

/**
 * Render a sequence of enhanced-prompt segments. Plain `text` segments render
 * verbatim; `term` segments are highlighted with a tooltip teaching what the
 * user originally said. Shared by the inline input overlay and the sent chat
 * bubble so the highlight styling is defined in exactly one place.
 */
export function EnhancedSegments({ segments }: { segments: PromptSegment[] }): React.ReactElement {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
        return (
          <span key={i} className="enh-term" tabIndex={0}>
            {seg.text}
            <span className="enh-tip" role="tooltip">
              <span className="enh-tip-said">
                you said: <span className="enh-tip-orig">&ldquo;{seg.original}&rdquo;</span>
              </span>
              {seg.note && <span className="enh-tip-note">{seg.note}</span>}
            </span>
          </span>
        );
      })}
    </>
  );
}
