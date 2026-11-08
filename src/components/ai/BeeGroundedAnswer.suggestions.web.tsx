import React, { useEffect, useRef } from "react";
import { validateSuggestionsHtml } from "../../../supabase/functions/_shared/beeGrounding";

export function BeeGroundedSuggestions({ html }: { html: string; onOpenUrl: (url: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const valid = validateSuggestionsHtml(html);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !valid) return;
    // Validation rejects scripts, event attributes, frames, remote assets and unsafe links.
    // Shadow DOM isolates Google's intact CSS without framing its search widget.
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const template = document.createElement("template");
    template.innerHTML = html;
    root.replaceChildren(template.content.cloneNode(true));
    return () => root.replaceChildren();
  }, [html, valid]);

  return valid ? <div ref={hostRef} aria-label="Google Search suggestions" style={{ width: "100%", minWidth: 0, contain: "layout paint" }} /> : null;
}
