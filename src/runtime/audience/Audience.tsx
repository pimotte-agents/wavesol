// The audience's page (`?audience#k=<audience room secret>`): the poll on screen, with a button per
// option. One vote per phone (the voter id is kept in localStorage); tapping another option moves it.
import { useCallback, useSyncExternalStore } from "react";
import type { NetPeer, PeerStatus } from "../../sync/net.ts";
import type { AudienceMessage, Voter, VoterView } from "../../sync/audience.ts";
import { LETTERS } from "../../plugins/poll/runtime.ts";

export function Audience({ title, voter, net }: { title: string; voter: Voter; net: NetPeer<AudienceMessage> }) {
  const view = useSyncExternalStore<VoterView>(
    useCallback((fn) => voter.subscribe(fn), [voter]),
    () => voter.current,
  );
  const status = useSyncExternalStore<PeerStatus>(
    useCallback((fn) => net.onStatus(fn), [net]),
    () => net.status,
  );
  const live = status === "p2p" || status === "relay";
  const poll = view.poll;

  return (
    <main className="ws-phone ws-audience">
      <header className="ws-phone-bar">
        <span className={`ws-phone-status ws-${live ? "p2p" : status}`} role="status">
          {live ? "Connected" : status === "offline" ? "Offline: reconnecting…" : "Connecting…"}
        </span>
        <span className="ws-phone-title">{title}</span>
      </header>
      {!poll && <p className="ws-audience-wait">{live ? "Waiting for the next poll…" : "Looking for the talk…"}</p>}
      {poll && (
        <>
          <div className="ws-audience-question" dangerouslySetInnerHTML={{ __html: poll.question }} />
          <ol className="ws-audience-options" aria-label="Answers">
            {poll.options.map((html, i) => (
              <li key={i}>
                <button
                  className={view.mine === i ? "ws-chosen" : undefined}
                  aria-pressed={view.mine === i}
                  onClick={() => {
                    voter.vote(i);
                    navigator.vibrate?.(8);
                  }}
                >
                  <span className="ws-poll-letter">{LETTERS[i]}</span>
                  <span dangerouslySetInnerHTML={{ __html: html }} />
                </button>
              </li>
            ))}
          </ol>
          <p className="ws-audience-mine" role="note">
            {view.mine === undefined ? "Tap your answer." : `You voted ${LETTERS[view.mine]}. Tap another answer to change it.`}
          </p>
        </>
      )}
    </main>
  );
}

/** A random id for this phone, kept across reloads, so a reload is not a second vote. */
export function voterId(): string {
  const key = `wavesol:voter:${location.pathname}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) localStorage.setItem(key, (id = crypto.getRandomValues(new Uint32Array(2)).join("-")));
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}
