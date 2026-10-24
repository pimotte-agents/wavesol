import "katex/dist/katex.min.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/400-italic.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "../theme/base.css";
import "../theme/academic-light.css";
import { createRoot } from "react-dom/client";
import virtualTalk from "virtual:wavesol/talk";
import { formatDiagnostic, type CompiledTalk, type Diagnostic } from "../model/compiled.ts";
import { runtimePlugins } from "../plugins/runtime-registry.ts";
import { Presentation } from "./presentation.ts";
import { Overlay } from "./ui/Overlay.tsx";

const compiled = virtualTalk as { talk?: CompiledTalk; diagnostics: Diagnostic[] };
const root = document.getElementById("app")!;

if (!compiled.talk) {
  // Only reachable in `wavesol dev`; `wavesol build` refuses to build a talk with errors.
  createRoot(root).render(
    <main className="ws-errors">
      <h1>This talk has errors</h1>
      <pre>{compiled.diagnostics.map(formatDiagnostic).join("\n")}</pre>
    </main>,
  );
} else {
  const talk = compiled.talk;
  document.title = talk.meta.title;
  document.documentElement.dataset.theme = talk.theme.base;
  for (const [k, v] of Object.entries(talk.theme.vars)) document.documentElement.style.setProperty(k, v);
  const presentation = new Presentation(root, talk, runtimePlugins);
  const ui = document.createElement("div");
  document.body.append(ui);
  createRoot(ui).render(<Overlay presentation={presentation} />);
  (window as unknown as { wavesol: Presentation }).wavesol = presentation;
}
