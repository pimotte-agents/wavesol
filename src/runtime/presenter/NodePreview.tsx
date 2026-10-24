// A live preview of one node at a given step, scaled to fit its box. Frames are shown with their
// descendants, placed as on the canvas.
import { useLayoutEffect, useRef } from "react";
import type { CompiledNode, CompiledTalk } from "../../model/compiled.ts";
import type { NodeInstance, RuntimePlugin } from "../../plugins/types.ts";

interface Props {
  talk: CompiledTalk;
  node: string;
  step: number;
  /** A detail of the step the laser selected on the projector (e.g. a Lean tactic). */
  focus?: number;
  /** The node's live data from the projector (e.g. poll votes); previews always show poll results. */
  live?: unknown;
  plugins: Record<string, RuntimePlugin>;
}

export function NodePreview({ talk, node: id, step, focus, live, plugins }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const root = useRef<NodeInstance | undefined>(undefined);
  const node = talk.nodes.find((n) => n.id === id);

  useLayoutEffect(() => {
    const w = world.current;
    if (!w || !node) return;
    const subtree = [node, ...descendants(talk, node.id)].sort((a, b) => a.depth - b.depth);
    const instances: NodeInstance[] = [];
    for (const n of subtree) {
      const el = document.createElement("div");
      el.className = `ws-node ws-type-${n.type}`;
      Object.assign(el.style, {
        width: `${n.size[0]}px`,
        height: `${n.size[1]}px`,
        transform: `translate(${n.x - node.x}px, ${n.y - node.y}px) scale(${n.scale})`,
      });
      const content = document.createElement("div");
      content.className = "ws-content";
      el.append(content);
      w.append(el);
      const inst = plugins[n.type]?.mount(content, n, { requestStep: () => {} });
      if (!inst) continue;
      inst.setStep(0, { animate: false });
      inst.setDetail?.("active");
      instances.push(inst);
      if (n === node) root.current = inst;
    }
    return () => {
      for (const i of instances) i.unmount?.();
      root.current = undefined;
      w.replaceChildren();
    };
  }, [talk, node, plugins]);

  useLayoutEffect(() => {
    root.current?.setLive?.({ ...(live as object | undefined), showResults: true });
  }, [live, node]);

  useLayoutEffect(() => {
    root.current?.setStep(step, { animate: true });
    if (focus !== undefined) root.current?.setFocus?.(focus);
  }, [step, focus, node]);

  // scale to fit, set directly from the observer (which runs before paint) so a resize never shows a
  // frame at the old scale
  useLayoutEffect(() => {
    const b = box.current;
    const w = world.current;
    if (!b || !w || !node) return;
    const fit = () => (w.style.transform = `translate(-50%, -50%) scale(${Math.min(b.clientWidth / node.w, b.clientHeight / node.h)})`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [node]);

  return (
    <div className="ws-preview" ref={box} data-node={id} data-step={step}>
      <div
        className="ws-preview-world"
        ref={world}
        style={node ? { width: node.w, height: node.h } : undefined}
      />
    </div>
  );
}

function descendants(talk: CompiledTalk, id: string): CompiledNode[] {
  const kids = talk.nodes.filter((n) => n.parent === id);
  return kids.flatMap((k) => [k, ...descendants(talk, k.id)]);
}
