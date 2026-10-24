import "katex/dist/katex.min.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/400-italic.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "../theme/base.css";
import "../theme/academic-light.css";
import "../theme/academic-dark.css";
import { createRoot } from "react-dom/client";
import virtualTalk from "virtual:wavesol/talk";
import { formatDiagnostic, type CompiledTalk, type Diagnostic } from "../model/compiled.ts";
import { runtimePlugins } from "../plugins/runtime-registry.ts";
import { SyncHost, SyncPeer, broadcastTransport, fanout, type Snapshot } from "../sync/protocol.ts";
import { Phone, PhoneError } from "./phone/Phone.tsx";
import { Presentation, type PresentationState } from "./presentation.ts";
import { Presenter } from "./presenter/Presenter.tsx";
import { Print } from "./print/Print.tsx";
import { AudienceHub, PhoneControl, joinRoom } from "./remote.ts";
import { Audience, voterId } from "./audience/Audience.tsx";
import { Voter, type AudienceMessage } from "../sync/audience.ts";
import type { PollData } from "../plugins/poll/build.ts";
import type { PollLive } from "../plugins/poll/runtime.ts";
import { Overlay } from "./ui/Overlay.tsx";

const compiled = virtualTalk as { talk?: CompiledTalk; diagnostics: Diagnostic[] };
const root = document.getElementById("app")!;
root.replaceChildren(); // the "Building the talk…" placeholder

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

  if (mode.has("print")) {
    document.documentElement.classList.add("ws-print-mode");
    createRoot(root).render(<Print talk={talk} plugins={runtimePlugins} steps={mode.get("steps") === "all" ? "all" : "last"} />);
  } else if (mode.has("audience")) {
    document.title = talk.meta.title;
    const r = createRoot(root);
    void joinRoom<AudienceMessage>(talk, "audience").then((net) => {
      if ("error" in net) return r.render(<PhoneError message={net.error} />);
      const voter = new Voter(net, voterId());
      r.render(<Audience title={talk.meta.title} voter={voter} net={net} />);
      (window as unknown as { wavesolAudience: { voter: Voter; net: typeof net } }).wavesolAudience = { voter, net };
    });
  } else if (mode.has("phone")) {
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
    const audience = new AudienceHub(talk);
    createRoot(ui).render(<Overlay presentation={presentation} phone={phone} audience={audience} />);
    (window as unknown as { wavesol: Presentation }).wavesol = presentation;
    (window as unknown as { wavesolPhoneControl: PhoneControl }).wavesolPhoneControl = phone;

    // the presenter window (BroadcastChannel) and phones (network) are peers of the same host
    const host = new SyncHost(fanout(broadcastTransport(channel), phone), (intent) => {
      if (intent.type === "overview") presentation.toggleOverview(intent.on);
      else if (intent.type === "pointer") presentation.setPointer(intent.at);
      else if (intent.type === "pair") void phone.start();
      else if (intent.type === "blackout") presentation.setBlackout(intent.on);
      else presentation.dispatch(intent);
    });
    // polls: the audience room follows the poll on screen; votes update the poll node live
    const pollLive = () => {
      const node = presentation.state.node;
      if (node.type !== "poll") return undefined;
      return { results: audience.results(node.id), join: audience.state?.url } satisfies PollLive;
    };
    const publish = () => host.publish({ ...snapshot(presentation.state), phone: phone.state, ...(pollLive() ? { live: pollLive() } : {}) });
    const followPoll = () => {
      const node = presentation.state.node;
      const data = node.data as PollData;
      audience.show(node.type === "poll" ? { id: node.id, question: data.question, options: data.options } : undefined);
      const live = pollLive();
      if (live) presentation.setLive(node.id, live);
    };
    presentation.subscribe(() => {
      followPoll();
      publish();
    });
    audience.onChange(() => {
      followPoll();
      publish();
    });
    phone.onChange(publish);
    followPoll();
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
    ...(s.blackout ? { blackout: true } : {}),
    ...(s.focus !== undefined ? { focus: s.focus } : {}),
    outgoing: s.outgoing.map(({ edge, target }) => ({ to: target.id, title: target.title, label: edge.label, default: edge.default })),
  };
}
