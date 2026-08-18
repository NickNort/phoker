# phoker

A [Spectrum](https://photon.codes/docs/spectrum-ts) iMessage agent that opens [Midnight Voice Blackjack](https://github.com/bbyrent/midnightgame) as a live mini-app card.

Text the line, tap the card, answer Mina’s call, and say **hit**, **stand**, **double**, or **deal**. Desktop demo shortcuts are `H`, `S`, `D`, and `N`.

## Environment

Copy `.env.example` to `.env` and fill in:

From your project Settings on the [Photon dashboard](https://app.photon.codes):

- `PROJECT_ID`
- `PROJECT_SECRET`

For the iMessage handoff:

- `GAME_URL` — public origin of the blackjack mini-app (a phone cannot open `localhost`)

Optional Vapi voice for the table (browser speech is the fallback):

- `NEXT_PUBLIC_VAPI_PUBLIC_KEY`
- `NEXT_PUBLIC_VAPI_ASSISTANT_ID`

## Run

Install once, then run the bot and the mini-app in two terminals:

```sh
pnpm install

pnpm dev
pnpm dev:web
```

- Bot: Spectrum listens on iMessage and replies with a live `app()` card pointing at `GAME_URL`.
- Mini-app: `http://localhost:3000`. Open it locally to rehearse the call UI, or tunnel/deploy it and set `GAME_URL` so iPhone can open the table.

## Voice modes

- With Vapi keys, the page connects through the Vapi Web SDK.
- Without those values, the demo uses browser speech recognition and synthesis.
- If neither voice path is available, the visual demo still works with the keyboard shortcuts.

## Photon handoff

Inbound iMessage text gets a Spectrum [app card](https://photon.codes/docs/spectrum-ts/content/app) with `{ live: true }`. That opens inside the Spectrum iMessage App as a live sheet; unsupported clients keep the normal URL fallback.

## Checks

```sh
pnpm lint
pnpm test
```

## See also

- [Spectrum docs](https://photon.codes/docs/spectrum-ts)
- Midnight Voice Blackjack source: [bbyrent/midnightgame](https://github.com/bbyrent/midnightgame)
