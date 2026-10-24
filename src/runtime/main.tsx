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
import { SyncHost, SyncPeer, broadcastTransport, fanout, type Snapshot } from "../sync/protocol.ts";
import { Phone, PhoneError } from "./phone/Phone.tsx";
import { Presentation, type PresentationState } from "./presentation.ts";
import { Presenter } from "./presenter/Presenter.tsx";
import { PhoneControl, joinRoom } from "./remote.ts";
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
  // one channel per talk URL, shared by the projector and its presenter window
  const channel = `wavesol:${location.pathname}`;

  const mode = new URLSearchParams(location.search);

  if (mode.has("phone")) {
    document.title = `Remote: ${talk.meta.title}`;
    const r = createRoot(root);
    void joinRoom(talk).then((net) => {
      if ("error" in net) return r.render(<PhoneError message={net.error} />);
      const peer = new SyncPeer(net);
      r.render(<Phone talk={talk} peer={peer} net={net} />);
      (window as unknown as { wavesolPhone: { peer: SyncPeer; net: typeof net } }).wavesolPhone = { peer, net };
    });
  } else if (mode.has("presenter")) {
    document.title = `Presenter: ${talk.meta.title}`;
    const peer = new SyncPeer(broadcastTransport(channel));
    createRoot(root).render(<Presenter talk={talk} peer={peer} plugins={runtimePlugins} />);
    (window as unknown as { wavesolPresenter: SyncPeer }).wavesolPresenter = peer;
  } else {
    const presentation = new Presentation(root, talk, runtimePlugins);
    const ui = document.createElement("div");
    document.body.append(ui);
    const phone = new PhoneControl(talk);
    createRoot(ui).render(<Overlay presentation={presentation} phone={phone} />);
    (window as unknown as { wavesol: Presentation }).wavesol = presentation;
    (window as unknown as { wavesolPhoneControl: PhoneControl }).wavesolPhoneControl = phone;

    // the presenter window (BroadcastChannel) and phones (network) are peers of the same host
    const host = new SyncHost(fanout(broadcastTransport(channel), phone), (intent) => {
      if (intent.type === "overview") presentation.toggleOverview(intent.on);
      else if (intent.type === "pointer") presentation.setPointer(intent.at);
      else if (intent.type === "pair") void phone.start();
      else presentation.dispatch(intent);
    });
    const publish = () => host.publish({ ...snapshot(presentation.state), phone: phone.state });
    presentation.subscribe(publish);
    phone.onChange(publish);
    publish();
    window.addEventListener("pagehide", () => host.close());
  }
}

function snapshot(s: PresentationState): Snapshot {
  return {
    node: s.nav.node,
    step: s.nav.step,
    history: s.nav.history,
    overview: s.overview,
    outgoing: s.outgoing.map(({ edge, target }) => ({ to: target.id, title: target.title, label: edge.label, default: edge.default })),
  };
}
