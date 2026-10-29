# Contributing

The most useful thing you can add is a module's jack list. Every module in [`modules/`](modules) makes the jack dropdowns work for everyone who owns it.

## Add or fix a module

1. In Patchbook, open **My racks → Add a module that's not listed** (or **Edit [module]'s jack list** for an existing one) and enter the jacks.
2. Click **Copy as library JSON**.
3. Save it as `modules/<id>.json`, fill in `source` and `confidence`, and open a pull request.

Or write the file by hand:

```json
{
  "id": "make-noise-maths",
  "name": "Maths",
  "maker": "Make Noise",
  "hp": 20,
  "modulargrid": {
    "url": "https://modulargrid.net/e/make-noise-maths",
    "listedAs": "Make Noise Maths"
  },
  "inputs": ["CH1 TRIG", "CH1 IN", "CH1 RISE", "CH1 BOTH", "CH1 FALL", "CH1 CYCLE"],
  "outputs": ["CH1 EOR", "CH1 VAR OUT", "CH1 UNITY"],
  "signals": {
    "CH1 TRIG": "gate", "CH1 IN": "any", "CH1 RISE": "cv", "CH1 BOTH": "cv", "CH1 FALL": "cv", "CH1 CYCLE": "gate",
    "CH1 EOR": "gate", "CH1 VAR OUT": "cv", "CH1 UNITY": "cv"
  },
  "confidence": "high",
  "source": "Maths manual (2013) p.4 panel diagram",
  "contributors": ["your-name"]
}
```

(That example is cut down; a real Maths entry lists every jack.)

### Rules

- **id:** `maker-module`, lowercase, words joined by hyphens. The file name must be `<id>.json`.
- **Jack names:** as printed on the panel, up to 24 characters. Add a section or channel prefix where labels repeat, e.g. `CH1 TRIG`, `OUT L`.
- **Every front-panel patch jack, nothing else:** no knobs, buttons, USB, SD or rear headers. Expanders list only the jacks on their own panel.
- **Direction:** a jack whose direction can be switched goes in both lists, with a note.
- **`modulargrid.listedAs`:** the maker and name exactly as ModularGrid shows them in a rack Data Sheet. This is what the paste-a-rack feature matches on.
- **`confidence`:** `high` means you checked every jack against the panel or a panel diagram. Use `medium` when the count is confirmed but some labels are your naming (icon-only panels). Use `low` when it's unconfirmed.
- **`source`:** the manual and page, or the URL, you took the jacks from.
- **`signals`:** what each jack carries, used to colour-code jacks in the app: `audio`, `cv` (modulation), `pitch` (V/oct), `gate` (gates and triggers), `clock` (clock and reset) or `any` (DC-coupled, or depends on the mode). Pick what the jack is normally used for; use `any` when it genuinely varies. Jacks left out are guessed from their name.

`npm test` checks every file. CI runs the same checks on pull requests.

## Code

- `npm run dev` to work on the app, `npm test` before opening a pull request.
- Never commit `.env` files or your own backups. Use [`docs/demo-backup.json`](docs/demo-backup.json) when you need example data.
- Keep runtime dependencies to a minimum. The app should keep working offline and with no server.
- Don't use Reliq Instruments' logo or panel artwork. The faceplate is redrawn on purpose.

## Security

Please report security problems privately. See [SECURITY.md](SECURITY.md).
