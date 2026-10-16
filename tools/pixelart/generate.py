#!/usr/bin/env python3
#
# KawaCity: generates the game's 16-bit style graphics from the original Micropolis artwork.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details. The original artwork (art/micropolis/) comes from micropolisJS and Micropolis, under the same terms.
#
# The original tiles use a 16 colour, EGA-like palette. This script:
#   - repaints the terrain (grass, water, shores, forests, rubble, fire) procedurally, with seamless 16x16 textures,
#     using the original tiles as masks so that every edge and transition still lines up;
#   - remasters roads, rails, power lines and buildings: new palette, grass instead of bare dirt, kerbs, highlights
#     on the top-left edges of structures, and drop shadows. Multi-tile buildings are processed as a whole (and
#     animation frames in the context of the building they belong to), so no seams appear between tiles;
#   - recolours the sprites and gives them an outline.
#
# Usage (from the repository root): python3 tools/pixelart/generate.py
# Requires Pillow and numpy.

import math
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SOURCE = os.path.join(ROOT, 'art', 'micropolis')
OUTPUT = os.path.join(ROOT, 'images')

TS = 16
PER_ROW = 32
TILE_COUNT = 1024


# --- Palettes -------------------------------------------------------------------------------------------------------

# The original palette, by name
ORIG = {
    'ground': (204, 127, 102),
    'dgrey': (63, 63, 63),
    'grey': (127, 127, 127),
    'lgrey': (191, 191, 191),
    'green': (0, 230, 0),
    'dgreen': (0, 127, 0),
    'black': (0, 0, 0),
    'water': (102, 102, 230),
    'blue': (0, 0, 230),
    'brown': (153, 127, 76),
    'white': (255, 255, 255),
    'yellow': (255, 255, 0),
    'red': (255, 0, 0),
    'orange': (255, 127, 0),
    'olive': (192, 192, 0),
}

# Default replacements for structures (buildings, vehicles...)
NEW = {
    'dgrey': (70, 66, 84),
    'grey': (130, 130, 148),
    'lgrey': (188, 188, 200),
    'black': (30, 26, 40),
    'white': (246, 244, 232),
    'yellow': (250, 210, 72),
    'red': (214, 66, 52),
    'orange': (242, 142, 52),
    'blue': (52, 92, 196),
    'water': (110, 150, 230),
    'brown': (160, 112, 68),
    'green': (104, 172, 70),
    'dgreen': (50, 112, 52),
    'olive': (186, 162, 46),
    'ground': (98, 160, 64),
}

GREY_RAMP = [(0, (30, 26, 40)), (63, (70, 66, 84)), (127, (130, 130, 148)), (191, (188, 188, 200)),
             (255, (246, 244, 232))]

SEASONS = {
    'summer': {
        'grass': [(80, 148, 64), (94, 162, 74), (68, 132, 56), (114, 178, 86)],
        'grass_shadow': (58, 110, 50),
        'water': [(44, 100, 184), (36, 86, 166), (82, 140, 214), (146, 192, 238)],
        'foam': (198, 224, 242),
        'sand': (196, 190, 150),
        'sand_dark': (160, 156, 120),
        'canopy': [(24, 66, 36), (38, 98, 46), (58, 130, 56), (100, 166, 78)],
        'forest_floor': (44, 92, 44),
        'dirt': [(122, 104, 84), (106, 90, 74), (138, 120, 98)],
    },
    'winter': {
        'grass': [(232, 238, 246), (248, 250, 255), (212, 222, 236), (255, 255, 255)],
        'grass_shadow': (180, 194, 220),
        'water': [(150, 200, 228), (128, 182, 216), (196, 228, 244), (236, 248, 255)],
        'foam': (240, 250, 255),
        'sand': (204, 214, 228),
        'sand_dark': (170, 184, 206),
        'canopy': [(22, 58, 40), (34, 84, 50), (52, 110, 62), (236, 244, 250)],
        'forest_floor': (190, 204, 224),
        'dirt': [(150, 140, 136), (128, 118, 116), (176, 168, 164)],
    },
}


def lerp(a, b, t):
    return tuple(int(round(int(a[i]) + (int(b[i]) - int(a[i])) * t)) for i in range(3))


def scale(colour, factor):
    return tuple(int(max(0, min(255, round(c * factor)))) for c in colour)


def grey_ramp(level):
    for (l0, c0), (l1, c1) in zip(GREY_RAMP, GREY_RAMP[1:]):
        if level <= l1:
            return lerp(c0, c1, (level - l0) / float(l1 - l0))
    return GREY_RAMP[-1][1]


ORIG_NAMES = list(ORIG.keys())
ORIG_ARRAY = np.array([ORIG[n] for n in ORIG_NAMES])


def classify(rgb):
    """Returns the name of the original palette colour closest to the given colour"""
    distances = ((ORIG_ARRAY - np.array(rgb)) ** 2).sum(axis=1)
    return ORIG_NAMES[int(distances.argmin())]


def is_grey(rgb):
    return max(rgb) - min(rgb) < 24


def remap(rgb, name, overrides=None):
    """The new colour for an original pixel"""
    rgb = tuple(int(c) for c in rgb[:3])
    if overrides and name in overrides:
        return overrides[name]
    # Off-palette greys (anti-aliased artwork) follow a continuous ramp, so gradients survive
    if tuple(rgb) != ORIG[name] and is_grey(rgb):
        return grey_ramp(sum(rgb) / 3.0)
    return NEW[name]


# --- Seamless textures ----------------------------------------------------------------------------------------------

def hash_noise(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffff) / 65535.0


def make_grass(season):
    g = SEASONS[season]['grass']
    tex = np.zeros((TS, TS, 3), dtype=np.uint8)
    for y in range(TS):
        for x in range(TS):
            n = hash_noise(x, y, 11)
            colour = g[0]
            if n < 0.07:
                colour = g[1]
            elif n < 0.13:
                colour = g[2]
            # Occasional two pixel tufts: a light blade over a dark one
            if hash_noise(x, y, 29) < 0.03:
                colour = g[3]
            elif hash_noise(x, (y - 1) % TS, 29) < 0.03:
                colour = g[2]
            tex[y, x] = colour
    return tex


WATER_FRAMES = 8


def make_water(season, frame=0):
    """The water texture for one frame of its animation: ripples drift with the current and glint in turn. Every
    frame repeats seamlessly every tile, and the animation loops after WATER_FRAMES frames."""
    w = SEASONS[season]['water']
    tex = np.zeros((TS, TS, 3), dtype=np.uint8)
    for y in range(TS):
        for x in range(TS):
            # Sparse patches of deeper water, drifting slowly
            tex[y, x] = w[1] if hash_noise(((x - frame) % TS) // 2, y, 7) < 0.22 else w[0]
    # Short horizontal ripples, staggered, wrapping around the tile. Each moves at its own pace, so the surface does
    # not appear to slide as a whole.
    ripples = [(2, 1, 3, 2), (11, 3, 4, 1), (6, 7, 3, 2), (14, 10, 3, 1), (3, 12, 4, 2), (9, 14, 2, 1)]
    for i, (rx, ry, length, speed) in enumerate(ripples):
        start = rx + frame * speed * TS // (WATER_FRAMES * 2)
        for j in range(length):
            tex[ry, (start + j) % TS] = w[2]
        # Glints come and go
        if (frame + i) % 4 != 0:
            tex[ry, (start + length // 2) % TS] = w[3]
    return tex


def make_dirt(season):
    d = SEASONS[season]['dirt']
    tex = np.zeros((TS, TS, 3), dtype=np.uint8)
    for y in range(TS):
        for x in range(TS):
            n = hash_noise(x, y, 41)
            tex[y, x] = d[1] if n < 0.18 else (d[2] if n < 0.3 else d[0])
    return tex


# Tree canopies, placed so that the pattern repeats every tile: (x, y, radius)
CANOPIES = [(3.5, 3.0, 4.2), (11.5, 2.0, 4.0), (7.5, 8.0, 4.4), (14.5, 9.5, 4.0), (2.5, 12.5, 4.1),
            (10.5, 14.5, 4.2)]


def canopy_pixels(cx, cy, r):
    """Yields (x, y, shade) for a round canopy lit from the top-left; shade 0 (dark) .. 3 (highlight)"""
    for y in range(int(math.floor(cy - r)), int(math.ceil(cy + r)) + 1):
        for x in range(int(math.floor(cx - r)), int(math.ceil(cx + r)) + 1):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            d = math.hypot(dx, dy)
            if d > r:
                continue
            light = (-dx - dy) / (r * 1.41)
            if d > r - 1.0 and light < 0.1:
                shade = 0
            elif light > 0.45 and d < r * 0.6:
                shade = 3
            elif light > -0.15:
                shade = 2
            else:
                shade = 1
            yield x, y, shade


def paint_trees(img, mask, season, full):
    """Paints tree canopies on a 16x16 tile. mask is a 16x16 boolean array of where the forest is."""
    s = SEASONS[season]
    canopy = s['canopy']
    drawn = np.zeros((TS, TS), dtype=bool)
    layer = np.zeros((TS, TS, 3), dtype=np.uint8)

    # Consider each canopy and its copies in neighbouring tiles, so that canopies straddling tile edges continue
    placements = []
    for cx, cy, r in CANOPIES:
        for ox in (-TS, 0, TS):
            for oy in (-TS, 0, TS):
                placements.append((cx + ox, cy + oy, r))
    placements.sort(key=lambda p: p[1])

    for cx, cy, r in placements:
        if cx + r < 0 or cy + r < 0 or cx - r >= TS or cy - r >= TS:
            continue
        if not full:
            # Is there forest where this canopy stands (or, for one centred in a neighbour, where it enters)?
            mx = int(min(max(cx, 0), TS - 1))
            my = int(min(max(cy, 0), TS - 1))
            if not mask[my, mx]:
                continue
        for x, y, shade in canopy_pixels(cx, cy, r):
            if 0 <= x < TS and 0 <= y < TS:
                layer[y, x] = canopy[shade]
                drawn[y, x] = True

    # Forest floor and shadows on the ground to the bottom-right of the canopies
    shadow = np.zeros((TS, TS), dtype=bool)
    shadow[1:, 1:] |= drawn[:-1, :-1]
    shadow[2:, 1:] |= drawn[:-2, :-1]
    for y in range(TS):
        for x in range(TS):
            if drawn[y, x]:
                img[y, x] = layer[y, x]
            elif shadow[y, x] or (full and mask[y, x]):
                img[y, x] = s['forest_floor'] if full else scale(img[y, x], 0.72)
    return img


# --- Helpers on tile images -------------------------------------------------------------------------------------

def tile_origin(index):
    return (index % PER_ROW) * TS, (index // PER_ROW) * TS


def get_tile(sheet, index):
    x, y = tile_origin(index)
    return sheet[y:y + TS, x:x + TS].copy()


def put_tile(sheet, index, tile):
    x, y = tile_origin(index)
    sheet[y:y + TS, x:x + TS] = tile


def names_of(tile):
    """The original palette name of each pixel"""
    cache = {}
    out = np.empty((tile.shape[0], tile.shape[1]), dtype=object)
    for y in range(tile.shape[0]):
        for x in range(tile.shape[1]):
            rgb = tuple(int(c) for c in tile[y, x, :3])
            if rgb not in cache:
                cache[rgb] = classify(rgb)
            out[y, x] = cache[rgb]
    return out


def neighbours(mask, dx, dy):
    """mask shifted so that out[y, x] = mask[y - dy, x - dx] (False outside)"""
    h, w = mask.shape
    out = np.zeros_like(mask)
    ys = slice(max(dy, 0), h + min(dy, 0))
    xs = slice(max(dx, 0), w + min(dx, 0))
    ys2 = slice(max(-dy, 0), h + min(-dy, 0))
    xs2 = slice(max(-dx, 0), w + min(-dx, 0))
    out[ys, xs] = mask[ys2, xs2]
    return out


def smooth(mask, passes=1):
    """Majority filter, to tidy the noisy edges of the original artwork. Pixels beyond the edge of the tile are
    assumed to continue the edge, as the neighbouring tile is likely to continue the same terrain."""
    m = mask.astype(int)
    h, w = m.shape
    for _ in range(passes):
        padded = np.pad(m, 1, mode='edge')
        total = np.zeros_like(m)
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                total += padded[dy:dy + h, dx:dx + w]
        m = (total >= 5).astype(int)
    return m.astype(bool)


# --- Terrain ----------------------------------------------------------------------------------------------------

WATER_TILES = range(2, 21)
TREE_EDGE_TILES = range(21, 37)
FULL_TREE_TILES = [37, 40, 41, 42, 43]
RUBBLE_TILES = range(44, 48)
FLOOD_TILES = range(48, 52)
FIRE_TILES = range(56, 64)


def render_water_tile(orig, season, tex, frame=0):
    s = SEASONS[season]
    names = names_of(orig)
    water = np.isin(names, ['water', 'blue'])
    water = smooth(water, 2) if not water.all() else water
    out = tex['grass'].copy()
    land = ~water
    near_land = np.zeros_like(water)
    near_water = np.zeros_like(water)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        near_land |= neighbours(land, dx, dy)
        near_water |= neighbours(water, dx, dy)
    for y in range(TS):
        for x in range(TS):
            if water[y, x]:
                # Foam laps against the shore
                lapping = (x + y + frame) % 4 != 0
                out[y, x] = s['foam'] if near_land[y, x] and lapping else tex['water'][y, x]
            elif near_water[y, x]:
                out[y, x] = s['sand']
            elif names[y, x] == 'brown':
                out[y, x] = s['sand_dark']
    # Darken the water just below the shore, as if the bank cast a shadow
    shore = neighbours(land, 0, 1) & water & ~near_land
    out[shore] = [scale(tuple(c), 0.85) for c in out[shore]] if shore.any() else out[shore]
    return out


def render_terrain(index, orig, season, tex, frame=0):
    s = SEASONS[season]
    names = names_of(orig)

    if index == 0:
        return tex['grass'].copy()

    if index == 1:
        out = tex['grass'].copy()
        out[names == 'black'] = s['grass_shadow']
        return out

    if index in WATER_TILES:
        return render_water_tile(orig, season, tex, frame)

    if index in TREE_EDGE_TILES or index in FULL_TREE_TILES:
        full = index in FULL_TREE_TILES
        mask = np.isin(names, ['green', 'dgreen'])
        if not full:
            mask = smooth(mask, 2)
        out = tex['grass'].copy()
        return paint_trees(out, mask, season, full)

    if index in RUBBLE_TILES:
        out = tex['dirt'].copy()
        for y in range(TS):
            for x in range(TS):
                n = names[y, x]
                if n == 'black':
                    out[y, x] = (62, 54, 52)
                elif n == 'brown':
                    out[y, x] = (118, 96, 78)
                elif n in ('grey', 'lgrey', 'dgrey', 'white'):
                    out[y, x] = remap(orig[y, x], n)
        return out

    if index in FLOOD_TILES:
        out = tex['water'].copy()
        for y in range(TS):
            for x in range(TS):
                n = names[y, x]
                if n == 'white':
                    out[y, x] = s['foam']
                elif n == 'ground':
                    out[y, x] = tex['dirt'][y, x]
        return out

    if index in FIRE_TILES:
        fire = {'red': (226, 58, 34), 'orange': (248, 146, 40), 'yellow': (254, 226, 104), 'white': (255, 250, 220),
                'black': (40, 30, 30), 'ground': (74, 52, 44), 'brown': (96, 66, 50)}
        out = np.zeros_like(orig[:, :, :3])
        for y in range(TS):
            for x in range(TS):
                n = names[y, x]
                out[y, x] = fire.get(n, remap(orig[y, x], n))
        return out

    # Anything else (radiation, unused tiles): a plain remaster
    return None


# --- Structures (roads, rails, wires, buildings) -------------------------------------------------------------------

FLAT = {'ground', 'green', 'water'}


# Empty zones: a mown lot, with the border and letter in the zone's colour
ZONE_LOTS = {240: (96, 204, 104), 423: (104, 156, 240), 612: (226, 196, 84)}


def render_zone_lot(img, names, season, tex, colour):
    """Zoned, but not yet built on: the land stays grassy, faintly tinted and fenced in the zone's colour"""
    h, w = names.shape
    out = np.zeros((h, w, 3), dtype=np.uint8)
    fence = scale(colour, 0.55)
    for y in range(h):
        for x in range(w):
            n = names[y, x]
            if n == 'ground':
                out[y, x] = lerp(tuple(tex['grass'][y % TS, x % TS]), colour, 0.14)
            elif n == 'black':
                out[y, x] = fence
            else:
                out[y, x] = colour
    # The border and letter cast a small shadow on the grass
    marks = ~np.isin(names, ['ground'])
    shadow = neighbours(marks, 1, 1) & ~marks
    for y, x in zip(*np.nonzero(shadow)):
        out[y, x] = scale(tuple(out[y, x]), 0.8)
    return out


def remaster(img, names, season, tex, origin, kind):
    """Remasters a block of tiles (h x w pixels), whose top-left lies at tile coordinates origin (for texture
    alignment). kind is 'transport' or 'building' or 'port' or 'bridge'."""
    s = SEASONS[season]
    h, w = names.shape
    out = np.zeros((h, w, 3), dtype=np.uint8)

    ground = names == 'ground'
    water = names == 'water'
    if kind == 'building':
        # Light blue is a building colour (walls, roofs, pools...) except in harbours
        water = np.zeros_like(water)
    flat = ground | water | (names == 'green')
    if kind in ('transport', 'bridge'):
        # Asphalt, markings, sleepers and rails all lie flat on the ground
        flat = np.ones_like(flat)
    structure = ~flat

    for y in range(h):
        for x in range(w):
            n = names[y, x]
            tx = (x + origin[0]) % TS
            ty = (y + origin[1]) % TS
            if ground[y, x]:
                out[y, x] = tex['grass'][ty, tx]
            elif water[y, x]:
                out[y, x] = tex['water'][ty, tx]
            elif kind in ('transport', 'bridge') and n == 'brown':
                out[y, x] = (118, 82, 52)
            elif kind == 'building' and n == 'green':
                out[y, x] = tex['grass'][ty, tx] if season == 'summer' else s['grass'][0]
            else:
                out[y, x] = remap(img[y, x], n)

    if kind in ('transport', 'bridge'):
        # Kerbs: asphalt next to grass gets a lighter edge
        asphalt = names == 'dgrey'
        beside_ground = np.zeros_like(asphalt)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            beside_ground |= neighbours(ground, dx, dy)
        kerb = asphalt & beside_ground
        out[kerb] = (122, 118, 132)
        # Grass right next to the road is a little trampled
        verge = ground & neighbours(asphalt, 0, 1) | ground & neighbours(asphalt, 1, 0)
        out[verge] = [scale(tuple(c), 0.82) for c in out[verge]] if verge.any() else out[verge]
        return out

    # Highlight the top and left edges of structures, shade the bottom and right ones
    top_edge = structure & ~neighbours(structure, 0, 1)
    left_edge = structure & ~neighbours(structure, 1, 0)
    bottom_edge = structure & ~neighbours(structure, 0, -1)
    right_edge = structure & ~neighbours(structure, -1, 0)
    lit = top_edge | left_edge
    shaded = (bottom_edge | right_edge) & ~lit
    for y, x in zip(*np.nonzero(lit)):
        out[y, x] = scale(tuple(out[y, x]), 1.16)
    for y, x in zip(*np.nonzero(shaded)):
        out[y, x] = scale(tuple(out[y, x]), 0.78)

    # Drop shadows on flat ground, cast towards the bottom right
    cast = np.zeros_like(structure)
    for dx, dy in ((1, 1), (2, 2), (1, 2), (2, 1), (3, 3), (2, 3), (3, 2)):
        cast |= neighbours(structure, dx, dy)
    shadow = cast & flat
    for y, x in zip(*np.nonzero(shadow)):
        out[y, x] = scale(tuple(out[y, x]), 0.66)
    return out


# --- Tile groups -----------------------------------------------------------------------------------------------------

def building_groups():
    """(top-left tile, size) of every multi-tile building in the tile set"""
    groups = [(240, 3), (405, 3), (414, 3), (423, 3), (612, 3), (693, 4), (709, 6), (745, 4), (761, 3), (770, 3),
              (779, 4), (795, 4), (811, 4)]
    groups += [(base, 3) for base in range(261, 405, 9)]   # residential
    groups += [(base, 3) for base in range(432, 612, 9)]   # commercial
    groups += [(base, 3) for base in range(621, 693, 9)]   # industrial
    groups += [(base, 3) for base in range(956, 1019, 9)]  # churches
    return groups


# Animation frames that are painted in place of a tile of a building, beyond those listed in animationManager.js
EXTRA_SLOTS = {}
for frame in range(832, 840):
    EXTRA_SLOTS[frame] = 711   # Airport radar (transport.js)
for frame in range(932, 940):
    EXTRA_SLOTS[frame] = 801   # Football game (stadia.js)
for frame in range(940, 948):
    EXTRA_SLOTS[frame] = 805


def animation_slots():
    """Maps animation frame tiles to the building tile they are painted over, from animationManager.js"""
    source = open(os.path.join(ROOT, 'src', 'animationManager.js')).read()
    slots = dict(EXTRA_SLOTS)
    for match in re.finditer(r'registerSingleAnimation\(\[([0-9, ]+)\]\)', source):
        seq = [int(v) for v in match.group(1).split(',')]
        first = seq[0]
        for frame in seq[1:]:
            if frame != first and first >= 240:
                slots[frame] = first
    return slots


def transport_kind(index):
    if index in (64, 65) or index in (208, 209) or index in (224, 225):
        return 'bridge'
    return 'transport'


# --- Main ------------------------------------------------------------------------------------------------------------

def generate_tiles(source_path, season, frame=0):
    src = np.array(Image.open(source_path).convert('RGBA'))[:, :, :3]
    out = np.zeros_like(src)
    tex = {'grass': make_grass(season), 'water': make_water(season, frame), 'dirt': make_dirt(season)}
    done = set()

    # Terrain
    for index in range(0, 64):
        tile = render_terrain(index, get_tile(src, index), season, tex, frame)
        if tile is not None:
            put_tile(out, index, tile)
            done.add(index)

    # Roads, power lines and rails
    for index in range(64, 240):
        orig = get_tile(src, index)
        put_tile(out, index, remaster(orig, names_of(orig), season, tex, (0, 0), transport_kind(index)))
        done.add(index)

    # Buildings, as a whole
    group_of = {}
    for base, size in building_groups():
        kind = 'port' if base == 693 else 'building'
        block = np.zeros((size * TS, size * TS, 3), dtype=np.uint8)
        for i in range(size * size):
            block[(i // size) * TS:(i // size + 1) * TS, (i % size) * TS:(i % size + 1) * TS] = get_tile(src, base + i)
        if base in ZONE_LOTS:
            result = render_zone_lot(block, names_of(block), season, tex, ZONE_LOTS[base])
        else:
            result = remaster(block, names_of(block), season, tex, (0, 0), kind)
        for i in range(size * size):
            index = base + i
            group_of[index] = (base, size, kind)
            put_tile(out, index, result[(i // size) * TS:(i // size + 1) * TS, (i % size) * TS:(i % size + 1) * TS])
            done.add(index)

    # Animation frames, in the context of the building they belong to
    for frame, slot in animation_slots().items():
        if slot not in group_of:
            continue
        base, size, kind = group_of[slot]
        block = np.zeros((size * TS, size * TS, 3), dtype=np.uint8)
        for i in range(size * size):
            tile = get_tile(src, frame if base + i == slot else base + i)
            block[(i // size) * TS:(i // size + 1) * TS, (i % size) * TS:(i % size + 1) * TS] = tile
        result = remaster(block, names_of(block), season, tex, (0, 0), kind)
        i = slot - base
        put_tile(out, frame, result[(i // size) * TS:(i // size + 1) * TS, (i % size) * TS:(i % size + 1) * TS])
        done.add(frame)

    # Everything else, tile by tile
    for index in range(TILE_COUNT):
        if index in done:
            continue
        orig = get_tile(src, index)
        names = names_of(orig)
        if 828 <= index <= 831 or 948 <= index <= 951:
            kind = 'bridge'
        elif 860 <= index <= 867:
            kind = 'explosion'
        else:
            kind = 'building'
        if kind == 'explosion':
            tile = remaster(orig, names, season, tex, (0, 0), 'transport')
            for y in range(TS):
                for x in range(TS):
                    if names[y, x] == 'ground':
                        tile[y, x] = tex['dirt'][y, x]
        else:
            tile = remaster(orig, names, season, tex, (0, 0), kind)
        put_tile(out, index, tile)

    alpha = np.full(out.shape[:2] + (1,), 255, dtype=np.uint8)
    return Image.fromarray(np.concatenate([out, alpha], axis=2), 'RGBA')


SPRITE_COLOURS = {
    'orange': (240, 132, 44),
    'red': (210, 56, 44),
    'yellow': (250, 214, 80),
    'white': (248, 246, 236),
    'lgrey': (190, 190, 204),
    'grey': (132, 132, 150),
    'dgrey': (72, 68, 86),
    'black': (30, 26, 40),
    'ground': (196, 124, 96),
    'blue': (60, 100, 204),
    'water': (170, 208, 244),
    'brown': (150, 104, 64),
}


def generate_sprites(source_path):
    src = np.array(Image.open(source_path).convert('RGBA'))
    h, w = src.shape[:2]
    out = np.zeros_like(src)
    opaque = src[:, :, 3] > 0
    cache = {}
    for y, x in zip(*np.nonzero(opaque)):
        rgb = tuple(int(c) for c in src[y, x, :3])
        if rgb not in cache:
            cache[rgb] = SPRITE_COLOURS.get(classify(rgb), rgb)
        out[y, x, :3] = cache[rgb]
        out[y, x, 3] = 255

    # A dark outline around each sprite, as in 16-bit games. Only solid shapes are outlined: isolated pixels (sparks,
    # debris, wakes) would just look dirty. The explosions (7th row) are left as they are.
    count = np.zeros(opaque.shape, dtype=int)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx or dy:
                count += neighbours(opaque, dx, dy).astype(int)
    solid = opaque & (count >= 4)
    solid[6 * 48:7 * 48, :] = False
    outline = np.zeros_like(opaque)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        outline |= neighbours(solid, dx, dy)
    outline &= ~opaque
    for y, x in zip(*np.nonzero(outline)):
        out[y, x] = (24, 20, 34, 230)
    return Image.fromarray(out, 'RGBA')


def generate_water_animation(source_path, first_frame):
    """Renders every frame of the water animation. Returns the atlas (one row of frames per tile containing water)
    and the list of tiles it holds, in row order."""
    frames = [np.array(first_frame)] + [np.array(generate_tiles(source_path, 'summer', f)) for f in range(1, WATER_FRAMES)]

    # The tiles that contain water are exactly those that change between frames
    animated = []
    for index in range(TILE_COUNT):
        x, y = tile_origin(index)
        first = frames[0][y:y + TS, x:x + TS]
        if any((f[y:y + TS, x:x + TS] != first).any() for f in frames[1:]):
            animated.append(index)

    atlas = np.zeros((len(animated) * TS, WATER_FRAMES * TS, 4), dtype=np.uint8)
    for row, index in enumerate(animated):
        x, y = tile_origin(index)
        for f in range(WATER_FRAMES):
            atlas[row * TS:(row + 1) * TS, f * TS:(f + 1) * TS] = frames[f][y:y + TS, x:x + TS]
    return Image.fromarray(atlas, 'RGBA'), animated


def write_water_module(animated):
    path = os.path.join(ROOT, 'src', 'waterTiles.js')
    rows = []
    for i in range(0, len(animated), 16):
        rows.append('  ' + ', '.join(str(t) for t in animated[i:i + 16]))
    with open(path, 'w') as f:
        f.write('/* KawaCity. Generated by tools/pixelart/generate.py: do not edit by hand.\n'
                ' *\n'
                ' * This code is released under the GNU GPL v3, with some additional terms.\n'
                ' * Please see the files LICENSE and COPYING for details.\n'
                ' *\n'
                ' */\n\n'
                '// The tiles with animated water. Row n of images/tiles-water.png holds the frames of tile WATER_TILES[n].\n'
                'var WATER_FRAME_COUNT = %d;\n\n'
                'var WATER_TILES = [\n%s\n];\n\n\n'
                'export { WATER_FRAME_COUNT, WATER_TILES };\n' % (WATER_FRAMES, ',\n'.join(rows)))


def write_uri_module(image_path, module, name):
    """The game embeds a copy of each tile set, used when the image cannot be read (e.g. when run from the file
    system): keep it in sync with the generated images."""
    import base64
    data = base64.b64encode(open(image_path, 'rb').read()).decode('ascii')
    path = os.path.join(ROOT, 'src', module)
    source = open(path).read()
    start = source.index('export const ' + name)
    with open(path, 'w') as f:
        f.write(source[:start] + "export const %s = 'data:image/png;base64,%s';\n" % (name, data))


def main():
    source = os.path.join(SOURCE, 'tiles.png')
    summer = generate_tiles(source, 'summer')
    summer.save(os.path.join(OUTPUT, 'tiles.png'), optimize=True)
    generate_tiles(source, 'winter').save(os.path.join(OUTPUT, 'tilessnow.png'), optimize=True)
    generate_sprites(os.path.join(SOURCE, 'sprites.png')).save(os.path.join(OUTPUT, 'sprites.png'), optimize=True)

    write_uri_module(os.path.join(OUTPUT, 'tiles.png'), 'tileSetURI.ts', 'TileSetURI')
    write_uri_module(os.path.join(OUTPUT, 'tilessnow.png'), 'tileSetSnowURI.ts', 'TileSetSnowURI')

    atlas, animated = generate_water_animation(source, summer)
    atlas.save(os.path.join(OUTPUT, 'tiles-water.png'), optimize=True)
    write_water_module(animated)
    print('Generated tiles.png, tilessnow.png, sprites.png and tiles-water.png (%d animated tiles) in %s' %
          (len(animated), OUTPUT))


if __name__ == '__main__':
    sys.exit(main())
