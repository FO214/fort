# Zombie sprite sheets

The `.webp` files here are frames rendered from the 3D model in `source/`,
by `scripts/make-zombie-sprites.mts`.

## The model

`source/model.gltf` is a block-built zombie in the style of Minecraft's,
exported from Blockbench 4.6 as glTF, with its 64x32 skin embedded. It was
supplied by the project owner as a download.

**Not yet recorded: who made the file, and under what licence.** Whoever
publishes this app should find the page it was downloaded from and write the
author and licence here, and credit them in the app if the licence asks.

The zombie's design is Minecraft's. Minecraft and its characters belong to
Mojang / Microsoft; their usage guidelines set what fan-made things may do
with them, and they should be read before this is distributed or sold.

## What was done to it

Rendered to 2D frames, relit, and given a dark outline. The walk, attack and
fall are made by the render script (the file holds only a pose). For the
runner, brute and boss the boxes are resized.
