# Evolutionary Blob Field

A lightweight browser simulation of an evolutionary algorithm:

This simulation was made for the entertainment of Shy and Oryon.

- 20 creatures search a 3D-looking field for 10 food items.
- Base creature speed is `1.0` with a `5 second` lifespan.
- Faster creatures get a shorter lifespan.
- Slower creatures get a longer lifespan.
- Slower creatures also become larger in size.
- Each new generation mutates speed by `+/-3%`.
- Larger blobs can eat smaller blobs, and that also counts as a win.
- Successful creatures are weighted more heavily when breeding the next generation.

## Run

Open `index.html` in a browser.

## Notes

This first version keeps the creature controller intentionally simple and focuses the evolution on the speed/lifespan tradeoff. If you want, the next step can be replacing the rule-based food seeking with a small neural network controller that evolves alongside speed.
