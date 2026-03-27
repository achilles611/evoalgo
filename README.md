# Evolutionary Blob Field

A lightweight browser simulation of an evolutionary algorithm:

This simulation was made for the entertainment of Shy and Oryon.

- 20 creatures search a 3D-looking field for 10 food items.
- Base creature speed is `1.0` with a `5 second` lifespan.
- Faster creatures get a shorter lifespan.
- Slower creatures get a longer lifespan.
- Slower creatures also become larger in size.
- Each new generation mutates speed by `+/-10%` across a wider `0.55` to `1.45` speed range.
- One special metal blob appears each generation with black-and-white styling, demon wings, a glowing halo, and a fixed `60` points.
- The metal blob moves at `5x` speed, patrols the perimeter, can create food, then locks onto a red blob after `2` seconds and swoops down to eat it.
- Larger blobs can eat smaller blobs, and that also counts as a win.
- Food is worth `20` points, eating another blob is worth `2`, and zero-point generations go extinct.
- Blue blobs spawn with visible antennae, and once food is gone, hungry red blobs home in on the nearest antenna.
- An antenna merge gives `10` points to both blobs, with the blue consuming the red at the end.
- Among successful blobs, more extreme red/blue variants get a small breeding bonus over near-green variants.
- Faster red blobs try to avoid nearby slower blue blobs while still preferring food.
- Successful creatures are weighted more heavily when breeding the next generation.

## Run

Open `index.html` in a browser.

## Notes

This first version keeps the creature controller intentionally simple and focuses the evolution on the speed/lifespan tradeoff. If you want, the next step can be replacing the rule-based food seeking with a small neural network controller that evolves alongside speed.
