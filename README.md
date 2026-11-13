# Evolution Playground

The evolution simulation from the ArtiFish video **I Simulated Evolution**, running live in the browser.

- Video: https://www.youtube.com/watch?v=qYGI1qK0c1k (channel: https://www.youtube.com/@ArtiFish-RL)
- Play it online: https://fastto.github.io/evolution-playground/

A hundred almost identical founders, each a different colour. Every creature carries six numbers, its genes: size, speed, sight, diet, crest and taste. They eat, look for a mate, and their children get copies of those numbers with tiny mistakes. Nobody tells evolution what to build.

## What you can do

- Play, pause, run at 1x / 4x / 16x / 64x, restart from any seed. The same seed with the same settings replays the same world (in the same browser).
- Follow the video's timeline (jaws start working at step 14,000, a meteor falls at step 44,000), or switch jaws on and off and drop meteors yourself.
- Change the world while it runs: food, mutation rate, lifespan, cost of speed, how random a female's choice is, crest drag, how much a crest attracts hunters, hunter sprint. Starting population applies on reset.
- Click a creature to read its genes; zoom in and the view follows it.
- Watch the population, the mother's families and the average of every gene over the generations.
- The address bar keeps the seed and every changed setting, so a world can be shared as a link.

## The model

All of it is in [`src/sim.ts`](src/sim.ts): one file, no dependencies, about 700 lines. It is a line-by-line port of the Python prototype the video was computed with, with the same numbers.

| Gene | On the body | Gives | Costs |
|---|---|---|---|
| size | bigger body | a bigger energy store; jaws only take prey that is not bigger | upkeep grows with mass (size²) |
| speed | longer tail | first to the food, escaping, catching | energy ~ mass × speed³ |
| sight | bigger eyes | sees food, mates and threats from farther away | a constant price per unit of sight |
| diet | red head, then orange jaws | plants give (1 − diet), meat gives √diet; past 0.5 it can attack the living | jaws grind plants badly (×0.25) |
| crest | golden fan, males only | females choose by it | energy, drag, and hunters notice it |
| taste | invisible, females only | how much a crest matters to her | nothing |

Body colour is the mother's family: it passes only from mother to child and never mutates.

### Differences from the video

- The video plays back one recorded run (seed 4 of the Python model). Here the world is computed live with a different random number generator, so seed 4 here is not the video's seed 4: the same things tend to happen, but not at the same moments or to the same creatures.
- Jaws and the meteor follow the video's timeline by default, and can also be triggered by hand.
- On wide views bodies are drawn larger than their real size, as in the video. Zoom in to see true proportions.

## Run it

Needs Node.js 20 or newer.

```bash
npm install
npm run dev
```

Build the static site into `dist/` (relative paths, works from any sub-folder):

```bash
npm run build
npm run preview
```

Headless check of the model (Node 23.6+): determinism plus a full 50,000-step run printed every 2,000 steps.

```bash
npm run check
```

## Publishing on GitHub Pages

`.github/workflows/deploy.yml` builds the site and deploys it on every push to `main`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Licence

[MIT](LICENSE).

Fonts (Space Grotesk, Inter, JetBrains Mono) are bundled from Fontsource under the SIL Open Font License.
