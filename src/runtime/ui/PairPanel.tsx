// Pairing a phone: QR code with the pairing URL, plus the phones connected so far. Shown on the
// projector (`c`) and in the presenter view.
import { useMemo } from "react";
import { renderSVG } from "uqr";
import type { PhoneState, Remote } from "../../sync/protocol.ts";

export function linkLabel(r: Remote): string {
  return r.link === "p2p" ? "direct" : "relayed";
}

export function PairPanel({ phone }: { phone?: PhoneState }) {
  const url = phone?.url;
  const svg = useMemo(() => (url ? renderSVG(url, { border: 2 }) : undefined), [url]);
  return (
    <div className="ws-pair">
      <h3>Control from your phone</h3>
      {!phone && <p className="ws-muted">Starting…</p>}
      {phone && !phone.url && !phone.hint && <p className="ws-muted">Connecting to the relays…</p>}
      {svg && <div className="ws-qr" role="img" aria-label="QR code for the phone" dangerouslySetInnerHTML={{ __html: svg }} />}
      {phone?.url && (
        <p className="ws-pair-url">
          Scan with the phone camera, or open <a href={phone.url}>this link</a> on the phone.
        </p>
      )}
      {phone?.hint && <p className="ws-pair-hint">{phone.hint}</p>}
      {phone && (
        <p className="ws-pair-remotes" role="status">
          {phone.remotes.length === 0
            ? "No phone connected yet."
            : `${phone.remotes.length === 1 ? "Phone" : `${phone.remotes.length} phones`} connected (${phone.remotes.map(linkLabel).join(", ")}).`}
        </p>
      )}
    </div>
  );
}
