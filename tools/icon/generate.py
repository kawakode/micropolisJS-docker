#!/usr/bin/env python3
#
# KawaCity: draws the game's icons in pixel art: a floating island seen in isometric view, in the style of the city
# simulators of the 16-bit era, with homes, shops and factories (the green, blue and yellow of the zones) around a
# crossroads, under a night-blue sky framed like the game's windows.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.
#
# The island is modelled as boxes on a grid, and drawn pixel by pixel: each pixel shows the nearest face of the boxes
# it sees, so that edges are clean 2:1 isometric lines. Each size has a scene of its own, plainer the smaller it is.
#
# Usage (from the repository root): python3 tools/icon/generate.py
# Requires Pillow.

import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTPUT = os.path.join(ROOT, 'images', 'icons')


# --- Palette (the game's) -------------------------------------------------------------------------------------------

OUTLINE = (7, 10, 31)
FRAME = (232, 236, 255)
SKY_TOP = (24, 34, 96)
SKY_BOTTOM = (70, 100, 200)
STAR = (232, 236, 255)

GRASS = (94, 162, 74)
GRASS_LIGHT = (124, 186, 92)
GRASS_DARK = (68, 132, 56)
EARTH_LEFT = (150, 104, 64)
EARTH_RIGHT = (112, 76, 48)
EARTH_LINE = (90, 60, 40)
ROAD = (70, 66, 84)
ROAD_LINE = (250, 210, 72)
KERB = (188, 188, 200)

RES = (110, 196, 92)
COM = (92, 156, 255)
IND = (240, 200, 70)


def shade(colour, factor):
    return tuple(max(0, min(255, int(round(c * factor)))) for c in colour)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


# --- The isometric renderer -----------------------------------------------------------------------------------------
#
# World coordinates: X runs to the bottom right of the screen, Y to the bottom left, Z up. A point is drawn at
# sx = X - Y, sy = (X + Y) / 2 - Z, and is nearer the viewer the larger X + Y + Z.

class Box:
    """A box from (x0, y0, z0) to (x1, y1, z1). paint(face, u, v) gives the colour of a point of a face ('top',
    'left' facing +Y, 'right' facing +X), where u runs along the face and v up it (or along Y on the top)."""

    def __init__(self, x0, y0, z0, x1, y1, z1, paint):
        self.x0, self.y0, self.z0, self.x1, self.y1, self.z1 = x0, y0, z0, x1, y1, z1
        self.paint = paint

    def hit(self, px, py):
        """The nearest point of the box seen at (px, py): (depth, face, u, v), or None"""
        best = None
        # Top: Z = z1
        s = 2 * (py + self.z1)
        x = (px + s) / 2
        y = (s - px) / 2
        if self.x0 <= x < self.x1 and self.y0 <= y < self.y1:
            best = (x + y + self.z1, 'top', x - self.x0, y - self.y0)

        # Right: X = x1
        y = self.x1 - px
        z = (self.x1 + y) / 2 - py
        if self.y0 <= y < self.y1 and self.z0 <= z < self.z1:
            depth = self.x1 + y + z
            if best is None or depth > best[0]:
                best = (depth, 'right', self.y1 - y, z - self.z0)

        # Left: Y = y1
        x = px + self.y1
        z = (x + self.y1) / 2 - py
        if self.x0 <= x < self.x1 and self.z0 <= z < self.z1:
            depth = x + self.y1 + z
            if best is None or depth > best[0]:
                best = (depth, 'left', x - self.x0, z - self.z0)

        return best


class Sprite:
    """A small picture standing at a point of the world: rows of characters, coloured by palette ('.' is empty)"""

    def __init__(self, x, y, z, rows, palette):
        self.x, self.y, self.z = x, y, z
        self.rows = rows
        self.palette = palette


def render(width, height, boxes, sprites, origin, background):
    """Draws the boxes and sprites over the background (a function of the pixel), with outlines. Returns the pixels
    and, for each pixel, the object it shows (None for the background)."""
    ox, oy = origin
    pixels = [[background(i, j) for i in range(width)] for j in range(height)]
    owner = [[None] * width for _ in range(height)]
    face = [[None] * width for _ in range(height)]
    depth = [[-1e9] * width for _ in range(height)]

    for j in range(height):
        for i in range(width):
            px = i + 0.5 - ox
            py = j + 0.5 - oy
            for index, box in enumerate(boxes):
                hit = box.hit(px, py)
                if hit and hit[0] > depth[j][i]:
                    depth[j][i] = hit[0]
                    pixels[j][i] = box.paint(hit[1], hit[2], hit[3])
                    owner[j][i] = index
                    face[j][i] = hit[1]

    # Sprites are drawn bottom centre on their point, in front of what is behind them
    for number, sprite in enumerate(sprites):
        d = sprite.x + sprite.y + sprite.z
        base_x = int(round(ox + sprite.x - sprite.y))
        base_y = int(round(oy + (sprite.x + sprite.y) / 2 - sprite.z))
        h = len(sprite.rows)
        w = len(sprite.rows[0])
        for r, row in enumerate(sprite.rows):
            for c, char in enumerate(row):
                if char == '.':
                    continue
                i = base_x - w // 2 + c
                j = base_y - h + 1 + r
                if 0 <= i < width and 0 <= j < height and d + 0.75 >= depth[j][i]:
                    pixels[j][i] = sprite.palette[char]
                    owner[j][i] = ('sprite', number)
                    face[j][i] = 'sprite'
                    depth[j][i] = d + 0.75

    # Highlights: the top of a box is lighter along its front edges
    for j in range(height - 1):
        for i in range(width):
            if face[j][i] == 'top' and face[j + 1][i] in ('left', 'right') and owner[j + 1][i] == owner[j][i]:
                pixels[j][i] = mix(pixels[j][i], (255, 255, 255), 0.35)

    # Outlines: around the whole picture, and between objects where the one behind shows above the other
    outlined = [row[:] for row in pixels]
    for j in range(height):
        for i in range(width):
            if owner[j][i] is None:
                near = [(i + di, j + dj) for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                if any(0 <= a < width and 0 <= b < height and owner[b][a] is not None for a, b in near):
                    outlined[j][i] = OUTLINE
            elif j + 1 < height and owner[j + 1][i] is not None and owner[j + 1][i] != owner[j][i] and \
                    depth[j + 1][i] > depth[j][i] + 1.5:
                # The edge of a nearer object, seen over a farther one
                outlined[j][i] = shade(pixels[j][i], 0.55)

    return outlined, owner


# --- Painting -------------------------------------------------------------------------------------------------------

def walls(left, right, top, windows=None, lit=None, roof_edge=None):
    """A building: plain walls, with windows every few pixels if given (windows: (colour, spacing u, spacing v))"""
    def paint(face, u, v):
        if face == 'top':
            return top
        base = left if face == 'left' else right
        if windows:
            colour, su, sv = windows
            iu, iv = int(u), int(v)
            if iu % su == su - 1 and iv % sv != 0 and iv >= 1:
                w = colour
                if lit and (iu * 7 + iv * 13) % lit[1] == 0:
                    w = lit[0]
                return w if face == 'left' else shade(w, 0.8)
        return base
    return paint


def island_paint(size, road_at, road_width, details):
    """The island's grass, with two roads crossing and the zones tinted, and its earth sides"""
    def paint(face, u, v):
        if face == 'top':
            x, y = int(u), int(v)
            on_x = road_at <= x < road_at + road_width
            on_y = road_at <= y < road_at + road_width
            if on_x or on_y:
                if details:
                    # A dashed line down the middle of each road, and none at the crossing
                    middle = road_at + road_width // 2
                    if on_x and not on_y and x == middle and y % 4 < 2:
                        return ROAD_LINE
                    if on_y and not on_x and y == middle and x % 4 < 2:
                        return ROAD_LINE
                return ROAD
            if details and (x == road_at - 1 or x == road_at + road_width or y == road_at - 1 or
                            y == road_at + road_width):
                return KERB
            # The zones: homes at the left, shops at the front, factories at the right
            if x < road_at and y >= road_at:
                tint = RES
            elif x >= road_at and y >= road_at:
                tint = COM
            elif x >= road_at and y < road_at:
                tint = IND
            else:
                tint = None
            grass = GRASS_LIGHT if (x * 3 + y * 5) % 11 == 0 else GRASS
            return mix(grass, tint, 0.18) if tint else grass

        base = EARTH_LEFT if face == 'left' else EARTH_RIGHT
        h = int(v)
        if h >= size - 1:
            return GRASS_DARK if face == 'left' else shade(GRASS_DARK, 0.85)
        if details and (h == size // 2 - 1 or (int(u) * 5 + h * 3) % 13 == 0):
            return EARTH_LINE
        return base
    return paint


# --- The scene ------------------------------------------------------------------------------------------------------

TREE = ['.ggg.', 'gGgGg', 'GgGgD', 'gGgDD', '.DDD.', '..t..']
TREE_SMALL = ['.g.', 'gGD', '.t.']
TREE_PALETTE = {'g': (100, 166, 78), 'G': (58, 130, 56), 'D': (38, 98, 46), 't': (110, 74, 44)}

SMOKE = ['..ss', 'sSs.']
SMOKE_PALETTE = {'s': (200, 204, 220), 'S': (232, 236, 255)}


def scene(detail):
    """The island and its buildings, in world units. detail: 'large' (64 pixels and up), 'small' (32 or 48) or 'tiny'
    (16): the smaller, the fewer the buildings, and the plainer"""
    boxes = []
    sprites = []
    large = detail == 'large'

    if large:
        n, depth_earth, road, road_w = 28, 5, 12, 4
    elif detail == 'small':
        n, depth_earth, road, road_w = 14, 3, 6, 2
    else:
        n, depth_earth, road, road_w = 7, 1.5, 3, 1

    boxes.append(Box(0, 0, -depth_earth, n, n, 0, island_paint(depth_earth, road, road_w, large)))

    def building(x0, y0, x1, y1, h, paint):
        boxes.append(Box(x0, y0, 0, x1, y1, h, paint))

    glass = walls((60, 104, 206), (38, 70, 156), (150, 160, 190),
                  ((146, 192, 238), 2, 3) if large else None, ((250, 210, 72), 5) if large else None)
    office = walls((236, 226, 196), (190, 178, 150), (210, 200, 176),
                   ((70, 110, 200), 2, 3) if large else None)
    tower = walls((150, 120, 190), (112, 88, 150), (180, 170, 200),
                  ((250, 210, 72), 3, 3) if large else None)
    factory = walls((240, 200, 70), (196, 156, 52), (150, 150, 168))
    chimney = walls((214, 66, 52), (168, 48, 40), (90, 60, 50))
    house = walls((246, 244, 232), (200, 196, 186), (214, 66, 52))
    shop = walls((92, 156, 255), (60, 116, 210), (220, 228, 250),
                 ((250, 210, 72), 3, 4) if large else None)
    rooftop = walls((188, 188, 200), (130, 130, 148), (210, 210, 220))

    if large:
        # Downtown, behind: a skyline of broad towers of different heights, with flat roofs
        building(2, 2, 7, 11, 20, glass)
        building(3, 4, 5, 6, 22, rooftop)
        building(8, 2, 11, 6, 13, office)
        building(8, 7, 11, 11, 16, tower)
        # Factories, at the right, with a low chimney
        building(16, 2, 26, 10, 7, factory)
        building(22, 3, 24, 5, 11, chimney)
        sprites.append(Sprite(24, 4, 12, SMOKE, SMOKE_PALETTE))
        # Homes, at the left
        building(2, 17, 6, 21, 4, house)
        building(7, 17, 11, 21, 4, house)
        building(2, 23, 6, 26, 4, house)
        # Shops and offices, in front
        building(17, 16, 23, 21, 9, office)
        building(17, 23, 22, 26, 5, shop)
        # Trees, in the gardens and the park
        for tx, ty in ((25, 18), (25, 24), (9, 25), (24.5, 21)):
            sprites.append(Sprite(tx, ty, 0, TREE, TREE_PALETTE))
    elif detail == 'small':
        building(1, 1, 4, 6, 10, glass)
        building(4, 1, 6, 3, 6, office)
        building(4, 3, 6, 6, 8, tower)
        building(8, 1, 13, 5, 4, factory)
        building(11, 2, 12, 3, 6, chimney)
        building(1, 8, 4, 11, 2, house)
        building(8, 8, 12, 12, 4, shop)
        sprites.append(Sprite(5, 12.5, 0, TREE_SMALL, TREE_PALETTE))
    else:
        building(0.5, 0.5, 3, 3, 5, glass)
        building(3, 0.5, 5, 2, 3, tower)
        building(4.5, 3, 6.5, 5.5, 1.5, factory)
        building(0.5, 4, 2.5, 6.5, 1.2, house)

    return boxes, sprites


# --- The icons ------------------------------------------------------------------------------------------------------

def frame_mask(size, radius):
    """Which pixels are inside a square with rounded corners, drawn as pixel art"""
    inside = [[True] * size for _ in range(size)]
    for j in range(size):
        for i in range(size):
            cx = radius - 0.5 if i < radius else (size - radius - 0.5 if i >= size - radius else i)
            cy = radius - 0.5 if j < radius else (size - radius - 0.5 if j >= size - radius else j)
            if (i - cx) ** 2 + (j - cy) ** 2 > (radius - 0.25) ** 2 and (i < radius or i >= size - radius) and \
                    (j < radius or j >= size - radius):
                inside[j][i] = False
    return inside


def sky(width, height, stars):
    def background(i, j):
        colour = mix(SKY_TOP, SKY_BOTTOM, j / float(height - 1))
        if (i, j) in stars:
            return STAR
        return colour
    return background


def draw_icon(size, detail, framed=True):
    """The icon, size pixels wide: the island under the sky, framed like the game's windows (or full bleed, for
    systems that round the corners themselves)"""
    boxes, sprites = scene(detail)
    large = detail == 'large'

    # Centre the island: its widest point is its left and right corners, its top the skyscraper
    n = boxes[0].x1
    top = -max(b.z1 - (b.x0 + b.y0) / 2.0 for b in boxes) - (4 if large else 1)
    bottom = n - boxes[0].z0
    ox = size / 2.0
    oy = round((size - (bottom - top)) / 2.0 - top) + (1 if framed else 0)

    stars = {(int(size * x), int(size * y)) for x, y in ((0.16, 0.18), (0.82, 0.14), (0.9, 0.36), (0.1, 0.42),
                                                         (0.7, 0.07))} if size >= 32 else set()
    pixels, _ = render(size, size, boxes, sprites, (ox, oy), sky(size, size, stars))

    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if framed:
        radius = max(3, size // 8)
        outer = frame_mask(size, radius)
        inner = frame_mask(size - 2, radius - 1)
        inner2 = frame_mask(size - 4, radius - 2)
        for j in range(size):
            for i in range(size):
                if not outer[j][i]:
                    continue
                if not (1 <= i < size - 1 and 1 <= j < size - 1 and inner[j - 1][i - 1]):
                    image.putpixel((i, j), OUTLINE + (255,))
                elif size >= 32 and not (2 <= i < size - 2 and 2 <= j < size - 2 and inner2[j - 2][i - 2]):
                    image.putpixel((i, j), FRAME + (255,))
                else:
                    image.putpixel((i, j), pixels[j][i] + (255,))
    else:
        for j in range(size):
            for i in range(size):
                image.putpixel((i, j), pixels[j][i] + (255,))

    return image


def enlarge(image, factor):
    return image.resize((image.width * factor, image.height * factor), Image.NEAREST)


def main():
    os.makedirs(OUTPUT, exist_ok=True)

    icon64 = draw_icon(64, 'large')
    icon48 = draw_icon(48, 'small')
    icon32 = draw_icon(32, 'small')
    icon16 = draw_icon(16, 'tiny')

    # The favicon, with each size drawn for itself
    favicon = os.path.join(ROOT, 'favicon.ico')
    icon48.save(favicon, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=[icon16, icon32])
    icon32.save(os.path.join(OUTPUT, 'favicon-32.png'))
    icon16.save(os.path.join(OUTPUT, 'favicon-16.png'))

    # Larger icons are the 64 pixel one, enlarged
    enlarge(icon64, 3).save(os.path.join(OUTPUT, 'icon-192.png'))
    enlarge(icon64, 8).save(os.path.join(OUTPUT, 'icon-512.png'))

    # Apple's systems round the corners themselves
    enlarge(draw_icon(60, 'large', framed=False), 3).save(os.path.join(OUTPUT, 'apple-touch-icon.png'))

    print('Icons written to', os.path.relpath(OUTPUT, ROOT), 'and favicon.ico')


if __name__ == '__main__':
    main()
