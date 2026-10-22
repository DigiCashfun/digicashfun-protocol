# Digicash

Cash for an era of machine minds, moving at Solana speed.

[![Live site](https://img.shields.io/badge/live%20site-digicash.fun-00b4f3?style=flat-square)](https://digicash.fun)
![Chain](https://img.shields.io/badge/chain-Solana-011a70?style=flat-square)

| | |
| --- | --- |
| Chain | Solana |
| Contract address | `pending` (not yet stated) |

## Overview

Digicash is a community coin on Solana. This repository holds its website: a single static page with a stated mint slot at the top, a live Solana market board, and a small address checker that compares any pasted address with the stated mint.

## Features

- Mint slot pinned to the top of the page, full address, one-click copy. Inert until a mint is stated.
- Live Solana board: top ten coins by daily volume, with logos, price, daily change, volume, liquidity and a copy button per address. Refreshes every minute, pauses while the tab is hidden, keeps the last good reading if the feed drops.
- Ticker built from the same live data.
- Spring-physics reveals, hero parallax, spotlight hover, scroll progress bar. Everything falls back to a still page when reduced motion is requested.
- Record-driven content: every external fact (mint, X, GitHub) is a record in `src/register.json` with a state of `stated`, `absent` or `unconfirmed`. Unstated records render inert, with no link and no value.

## Links

- Website: <https://digicash.fun>
- X: pending
- GitHub: pending

## Build

```bash
npm install
npm run build   # writes dist/
npm run gates   # checks dist/ and both mint states
```

`dist/` is the deploy folder. Drag it to Cloudflare Pages as is.
