// The print view (`?print`, `&steps=all` for every step): each node, at the given steps, on its own
// 1600×900 page, in reading order. `wavesol build` prints it to PDF; `wavesol check --render`
// measures it. When everything has rendered, window.wavesolPrint.ready is true.
import { useEffect } from "react";
import type { CompiledTalk } from "../../model/compiled.ts";
import type { RuntimePlugin } from "../../plugins/types.ts";
import { NodePreview } from "../presenter/NodePreview.tsx";
import { printOrder } from "./order.ts";

export function Print({ talk, plugins, steps }: { talk: CompiledTalk; plugins: Record<string, RuntimePlugin>; steps: "last" | "all" }) {
  const pages = printOrder(talk, steps);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await document.fonts.ready;
      const images = [...document.images].map((img) => (img.complete ? Promise.resolve() : new Promise((r) => (img.onload = img.onerror = r))));
      await Promise.all(images);
      // two frames, so size-dependent layout (fitted Lean code, previews) has settled
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!cancelled) (window as unknown as { wavesolPrint: { ready: boolean; pages: typeof pages } }).wavesolPrint = { ready: true, pages };
    })();
    return () => void (cancelled = true);
  }, [pages]);
  return (
    <div className="ws-print">
      {pages.map((p) => (
        <section key={`${p.node}/${p.step}`} className="ws-print-page" data-node={p.node} data-step={p.step}>
          <NodePreview talk={talk} node={p.node} step={p.step} plugins={plugins} box={[1600, 900]} />
        </section>
      ))}
    </div>
  );
}
