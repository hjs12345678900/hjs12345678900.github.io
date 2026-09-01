# Junsheng (Sam) He — academic portfolio

A multi-page static academic website for:

- supermassive black-hole evolution research;
- quasar imaging and data reduction;
- occultation observing and SatOccult;
- astrophotography; and
- a concise web CV.

## Preview locally

```sh
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

## Content map

- `index.html` — home and research overview
- `research/smbh-evolution/` — PhD research
- `research/quasar-reduction/` — reduction workflow
- `research/occultations/` — observing and SatOccult
- `astrophotography/` — image archive structure
- `cv/` — web CV
- `assets/css/site.css` — visual system and responsive layouts
- `assets/js/site.js` — navigation, reveal motion, and star field

## Publishing

The `Deploy static site to GitHub Pages` workflow publishes the repository root when changes reach `master`. GitHub Pages must use **GitHub Actions** as its source in the repository settings.

## Updating personal material

Replace `assets/img/junsheng-he.png` with a formal portrait while keeping the same filename. Add original astrophotography files under `assets/img/astrophotography/`, then replace the generated collection backgrounds in `astrophotography/index.html` with image elements.
