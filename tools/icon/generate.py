#!/usr/bin/env python3
#
# KawaCity: draws the game's icons and the pictures of its interface in pixel art, in the style of the city simulators
# of the 16-bit era. The icon is a floating island seen in isometric view, with homes, shops and factories (the green,
# blue and yellow of the zones) around a crossroads, under a night-blue sky framed like the game's windows; the title
# screen shows the same island. The tool bar's icons (tool_icons.py), the small icons of the heads-up display and of
# the windows (hud_icons.py) and the neighbouring cities (towns.py) are drawn into sheets, and src/uiIcons.js tells
# where each picture is in them.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.
#
# The pictures are drawn pixel by pixel by an isometric renderer (iso.py), or by hand. Each size of the icon has a scene
# of its own, plainer the smaller it is.
#
# Usage (from the repository root): python3 tools/icon/generate.py
# Requires Pillow.

import os

from PIL import Image

import hud_icons
import tool_icons
import towns
from iso import (Box, Sprite, render, to_image, enlarge, fit, transparent, walls, mix, shade, OUTLINE, FRAME, SKY_TOP,
                 SKY_BOTTOM, STAR, GRASS, GRASS_LIGHT, GRASS_DARK, EARTH_LEFT, EARTH_RIGHT, EARTH_LINE, ROAD, ROAD_LINE,
                 KERB, RES, COM, IND, TREE, TREE_SMALL, TREE_PALETTE, SMOKE, SMOKE_PALETTE)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTPUT = os.path.join(ROOT, 'images', 'icons')
UI_OUTPUT = os.path.join(ROOT, 'images', 'ui')
UI_MODULE = os.path.join(ROOT, 'src', 'uiIcons.js')


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
    pixels = render(size, size, boxes, sprites, (ox, oy), sky(size, size, stars))

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
        image = to_image(pixels)

    return image


# --- The pictures of the interface ----------------------------------------------------------------------------------

def draw_sheet(pictures, size, columns):
    """Lays the pictures out in a sheet, in rows of columns. Returns the sheet and where each picture is in it."""
    rows = (len(pictures) + columns - 1) // columns
    sheet = Image.new('RGBA', (size * min(columns, len(pictures)), size * rows), (0, 0, 0, 0))
    at = {}
    for k, (name, image) in enumerate(pictures):
        x, y = (k % columns) * size, (k // columns) * size
        sheet.alpha_composite(image, (x, y))
        at[name] = (x, y)
    return sheet, at


def sheet_js(name, sheet, size, at, width=120):
    """The sheet's entry in the module, its lines broken between the pictures"""
    parts = ['var %s = {size: %d, width: %d, height: %d, at: {' % (name, size, sheet.width, sheet.height)]
    parts += ['%s: [%d, %d]' % (key, x, y) for key, (x, y) in at.items()]
    lines, line = [], parts[0]
    for k, part in enumerate(parts[1:]):
        last = k == len(parts) - 2
        text = part + ('}};' if last else ',')
        if len(line) + 1 + len(text) > width:
            lines.append(line)
            line = '  ' + text
        else:
            line += ('' if line.endswith('{') else ' ') + text
    lines.append(line)
    return '\n'.join(lines)


def draw_interface():
    os.makedirs(UI_OUTPUT, exist_ok=True)
    modules = []

    sheets = [
        ('TOOL_ICONS', 'tools.png', tool_icons.SIZE, 11, [(n, tool_icons.draw(b)) for n, b in tool_icons.ICONS]),
        ('HUD_ICONS', 'hud.png', hud_icons.SIZE, 16, [(n, hud_icons.draw(rows)) for n, rows in hud_icons.ICONS]),
        ('TOWNS', 'towns.png', towns.SIZE, 4, [(n, towns.draw(b)) for n, b in towns.TOWNS]),
    ]
    for name, file_name, size, columns, pictures in sheets:
        sheet, at = draw_sheet(pictures, size, columns)
        sheet.save(os.path.join(UI_OUTPUT, file_name))
        modules.append(sheet_js(name, sheet, size, at))

    # The title screen's island, without its sky
    boxes, sprites = scene('large')
    to_image(render(64, 64, boxes, sprites, fit(boxes, sprites, 64, 64), transparent)) \
        .save(os.path.join(UI_OUTPUT, 'island.png'))

    with open(UI_MODULE, 'w') as module:
        module.write('''/* KawaCity. Generated by tools/icon/generate.py: do not edit by hand.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The pictures of the interface, in their sheets (images/ui/): the size of the pictures, the size of the sheet, and
// where each picture is in it ([x, y], in pixels)
%s

export { HUD_ICONS, TOOL_ICONS, TOWNS };
''' % '\n'.join(modules))


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

    draw_interface()

    print('Icons written to', os.path.relpath(OUTPUT, ROOT), 'and favicon.ico; the interface\'s pictures to',
          os.path.relpath(UI_OUTPUT, ROOT), 'and', os.path.relpath(UI_MODULE, ROOT))


if __name__ == '__main__':
    main()
