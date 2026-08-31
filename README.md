PROBNAYA

Independent Computational Laboratory

# PROBNAYA

The public website of PROBNAYA, an independent computational laboratory.

The site presents the laboratory, its instruments, and its investigations. It is
a static multi-page website. Live canvas apparatuses render computational
processes through measured, frame-rate-independent simulations.

## Run locally

No installation or build step is required.

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Structure

- `index.html` and the other root HTML files define individual pages.
- `css/style.css` contains the shared visual system and responsive layout.
- `js/apparatus.js` runs the canvas simulations.
- `js/records.js` contains investigation records.
- `js/site.js` contains shared page behavior.
