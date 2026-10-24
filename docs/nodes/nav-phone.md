# Phone controller

- **c** shows a QR code; scan it with your phone. No app, no account.
- The phone gets **Next**, Prev and Back, a button for every outgoing edge, and a **laser pointer** pad.
- Phone and projector connect directly where the network allows, and through encrypted relays otherwise.
- `wavesol serve --host` needs no internet: put the laptop on your phone's hotspot.

::: notes
The pairing secret stays in the QR code's URL fragment; relays only ever see ciphertext. Show the QR code from the presenter view if you don't want it on the big screen.
:::
