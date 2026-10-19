#
# KawaCity: what stands on the isometric map: buildings, trees, power poles, flames... in the style of the game's
# icons (see iso.py). Each object is drawn once by day, and once more by night with only its lit windows, so that the
# city lights up in the evening.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.
#
# A tile is 16 world units square; a building of size n covers n x n tiles from its top corner, its origin. Heights
# are in world units too: a pixel each.

import math

from iso import (Box, Line, Solid, Sprite, cylinder, gable, lit, mix, render, shade, sphere, transparent, GREY, GREY_DARK,
                 GREY_LIGHT, RED, RED_DARK, WATER, WATER_LIGHT, WHITE, YELLOW)

U = 16

# Drawing the lights of the night, rather than the day (see Lights)
STATE = {'lights': False}

LIT = [(255, 214, 120), (255, 236, 170), (250, 190, 100)]


def hashed(*values):
    h = 2166136261
    for v in values:
        h = ((h ^ (int(v) & 0xffffffff)) * 16777619) & 0xffffffff
    return h


# --- Painting buildings ---------------------------------------------------------------------------------------------

def facade(left, right, roof, window=None, bay=3, floor=4, lit=2, trim=None, door=None, seed=0):
    """A building's paint: walls with a window every bay units, on floors of floor units, a trim at the top of the
    walls, and doors along the ground. By night, lit windows (one in lit) only."""
    def paint(face, u, v):
        iu, iv = int(u), int(v)
        is_window = window is not None and iv % floor in (1, 2) and iu % bay == bay // 2 and iv >= 1
        if STATE['lights']:
            if is_window and hashed(iu, iv // floor, seed, face == 'left') % lit != 0:
                return LIT[hashed(iu, iv) % 3] if face == 'left' else shade(LIT[hashed(iu, iv) % 3], 0.85)
            return None
        if face == 'top':
            return roof
        if is_window:
            return window if face == 'left' else shade(window, 0.8)
        if door and iv < 3 and iu % door[1] == door[2]:
            return door[0] if face == 'left' else shade(door[0], 0.8)
        base = left if face == 'left' else right
        if trim and iv >= trim[1]:
            return trim[0] if face == 'left' else shade(trim[0], 0.85)
        return base
    return paint


def plain(left, right, top):
    def paint(face, u, v):
        if STATE['lights']:
            return None
        return top if face == 'top' else (left if face == 'left' else right)
    return paint


def flat_paint(fn):
    """A flat shape painted by fn(u, v) on its top"""
    def paint(face, u, v):
        if STATE['lights']:
            return None
        return fn(u, v)
    return paint


def dark(paint):
    """A solid's paint, hidden by night"""
    def wrapped(x, y, z):
        return None if STATE['lights'] else paint(x, y, z)
    return wrapped


def night(solid):
    solid.paint = dark(solid.paint)
    return solid


def box(x0, y0, x1, y1, height, paint, z0=0):
    return Box(x0, y0, z0, x1, y1, z0 + height, paint)


def flat(x0, y0, x1, y1, fn, z=0.05):
    return Box(x0, y0, z - 0.05, x1, y1, z, flat_paint(fn), flat=True)


def roof(x0, y0, x1, y1, z0, height, colours, wall, along='x'):
    return night(gable(x0, y0, x1, y1, z0, height, colours, wall, along))


def tank(cx, cy, radius, height, tones, top, z0=0, bands=None):
    return night(cylinder(cx, cy, z0, z0 + height, radius, tones, top, bands))


def dome(cx, cy, z, radius, tones, flatten=0.8):
    return night(sphere(cx, cy, z, radius, tones, flatten))


TREE = ['..ggg..', '.gGgGg.', 'gGgGgGD', 'GgGgGDD', 'gGgGDDD', '.GgDDD.', '..DDD..', '...t...', '...t...']
TREE_SMALL = ['.ggg.', 'gGgGD', 'GgGDD', '.DDD.', '..t..']
TREE_PALETTE = {'g': (100, 166, 78), 'G': (58, 130, 56), 'D': (38, 98, 46), 't': (110, 74, 44)}
PINE = ['...g...', '..gGD..', '..GgD..', '.gGgDD.', '.GgGDD.', 'gGgGDDD', '...t...']


def big(rows):
    """A sprite's rows, twice as big"""
    out = []
    for row in rows:
        wide = ''.join(c * 2 for c in row)
        out += [wide, wide]
    return out


def stack(x0, y0, size, height, colour, z0=0):
    """A square chimney, banded near its top"""
    band = mix(colour, WHITE, 0.6)

    def paint(face, u, v):
        if STATE['lights']:
            return None
        if face == 'top':
            return (50, 46, 50)
        c = band if height - 5 <= v < height - 3 else colour
        return c if face == 'left' else shade(c, 0.78)
    return box(x0, y0, x0 + size, y0 + size, height, paint, z0)


def tree(x, y, small=False, pine=False):
    return Sprite(x, y, 0, PINE if pine else (TREE_SMALL if small else TREE), TREE_PALETTE)


# --- Palettes -------------------------------------------------------------------------------------------------------

RES_PALETTES = [
    # A slum: weathered walls, tar roofs
    {'wall': (156, 132, 110), 'wall_r': (122, 102, 86), 'roof': (104, 98, 104), 'roof2': (78, 72, 80),
     'window': (70, 80, 100), 'flat': (120, 116, 120)},
    # Lower class: brick, grey roofs
    {'wall': (196, 110, 76), 'wall_r': (156, 84, 58), 'roof': (120, 122, 138), 'roof2': (90, 92, 108),
     'window': (146, 192, 238), 'flat': (150, 150, 160)},
    # Middle class: cream walls, red tiles
    {'wall': (236, 226, 196), 'wall_r': (196, 184, 156), 'roof': (214, 96, 64), 'roof2': (168, 70, 46),
     'window': (110, 160, 220), 'flat': (200, 196, 186)},
    # Upper class: white and glass, blue roofs
    {'wall': (246, 244, 236), 'wall_r': (206, 204, 198), 'roof': (80, 140, 200), 'roof2': (56, 108, 166),
     'window': (120, 190, 240), 'flat': (220, 220, 228)},
]

COM_PALETTES = [
    {'wall': (176, 172, 166), 'wall_r': (140, 136, 130), 'window': (90, 104, 126), 'roof': (150, 150, 160)},
    {'wall': (214, 180, 130), 'wall_r': (170, 140, 100), 'window': (146, 192, 238), 'roof': (170, 160, 150)},
    {'wall': (84, 134, 212), 'wall_r': (58, 98, 172), 'window': (176, 214, 246), 'roof': (160, 176, 200)},
    {'wall': (64, 70, 96), 'wall_r': (44, 48, 70), 'window': (250, 210, 120), 'roof': (110, 112, 130)},
]

IND_PALETTES = [
    {'wall': (190, 120, 74), 'wall_r': (150, 92, 56), 'roof': (126, 116, 110), 'roof2': (96, 88, 84),
     'window': (90, 96, 110), 'stack': ((232, 92, 72), RED, RED_DARK)},
    {'wall': (160, 172, 192), 'wall_r': (124, 134, 154), 'roof': (110, 140, 180), 'roof2': (80, 104, 140),
     'window': (176, 214, 246), 'stack': ((214, 216, 226), (176, 180, 194), (140, 144, 160))},
]


def res_facade(p, seed=0):
    return facade(p['wall'], p['wall_r'], p['flat'], p['window'], 3, 4, 2, seed=seed)


def com_facade(p, seed=0, glass=False):
    if glass:
        return facade(p['wall'], p['wall_r'], p['roof'], p['window'], 2, 3, 2, seed=seed)
    return facade(p['wall'], p['wall_r'], p['roof'], p['window'], 3, 4, 2, seed=seed)


def house(x0, y0, x1, y1, p, along='x', wall=7, pitch=6, seed=0):
    """A house: walls with windows and a door, under a pitched roof"""
    paint = facade(p['wall'], p['wall_r'], p['roof'], p['window'], 4, 7, 2, door=((110, 74, 44), 9, 5), seed=seed)
    gable_end = p['wall_r'] if along == 'x' else p['wall']
    return [box(x0, y0, x1, y1, wall, paint), roof(x0, y0, x1, y1, wall, pitch, (p['roof'], p['roof2']), gable_end, along)]


def rooftop(x0, y0, x1, y1, z):
    """Machinery on a flat roof"""
    unit = plain((150, 150, 164), (118, 118, 134), (170, 170, 184))
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    return [box(cx - 5, cy - 4, cx + 1, cy + 1, 2, unit, z), box(cx + 2, cy + 1, cx + 5, cy + 4, 2, unit, z)]


# --- Residential zones ----------------------------------------------------------------------------------------------

def residential(value, population):
    p = RES_PALETTES[value]
    shapes, sprites = [], []
    seed = value * 4 + population

    def lawn(u, v):
        return mix((110, 178, 84), (84, 150, 64), 0.5) if (int(u) + int(v)) % 7 == 0 else (110, 178, 84)

    if population == 0:
        # Houses in their gardens
        for k, (x0, y0, along) in enumerate(((3, 3, 'x'), (27, 4, 'y'), (4, 27, 'y'), (28, 28, 'x'))):
            shapes += house(x0, y0, x0 + 15, y0 + 14, p, along, seed=seed + k)
        sprites += [tree(22, 22), tree(44, 20, True), tree(20, 45, True)]
    elif population == 1:
        # Two walk-ups, three floors high
        paint = res_facade(p, seed)
        shapes += [box(4, 4, 20, 42, 13, paint), roof(4, 4, 20, 42, 13, 6, (p['roof'], p['roof2']), p['wall'], 'y'),
                   box(27, 6, 44, 42, 13, paint), roof(27, 6, 44, 42, 13, 6, (p['roof'], p['roof2']), p['wall'], 'y')]
        sprites += [tree(23, 45, True)]
    elif population == 2:
        # A block of flats, six floors high, around a garden
        paint = res_facade(p, seed)
        shapes += [box(4, 4, 44, 18, 25, paint), box(4, 18, 18, 44, 21, paint)]
        shapes += rooftop(8, 6, 40, 16, 25)
        sprites += [tree(32, 32), tree(42, 42, True), tree(30, 44, True)]
    else:
        # A tower on a podium
        paint = res_facade(p, seed)
        shapes += [box(4, 4, 44, 44, 5, facade(p['wall_r'], shade(p['wall_r'], 0.85), p['flat'], p['window'], 3, 5, 3)),
                   box(9, 9, 39, 39, 42, paint)]
        shapes += rooftop(11, 11, 37, 37, 47)

    if value == 3 and population < 3:
        # A pool
        shapes.append(flat(32, 30, 44, 40, lambda u, v: WATER_LIGHT if (int(u) + int(v)) % 5 == 0 else (90, 170, 230))
                      if population != 0 else flat(20, 20, 26, 26, lambda u, v: (90, 170, 230)))
    return shapes, sprites, [], []


# --- Commercial zones -----------------------------------------------------------------------------------------------

def awning(colour):
    def paint(face, u, v):
        if STATE['lights']:
            return None
        if face == 'top':
            return colour if int(u + v) % 2 else WHITE
        return colour if int(u) % 2 else WHITE
    return paint


def commercial(value, population):
    p = COM_PALETTES[value]
    shapes, sprites = [], []
    seed = 20 + value * 5 + population
    glass = value >= 2

    if population == 0:
        # Shops, with awnings over their windows
        shop = facade(p['wall'], p['wall_r'], p['roof'], p['window'], 3, 7, 1, door=((90, 70, 60), 6, 3), seed=seed)
        colours = [RED, (60, 140, 220), (240, 160, 40), (90, 170, 90)]
        shapes += [box(4, 4, 22, 22, 9, shop), box(4, 22, 22, 23.5, 1, awning(colours[value]), 5),
                   box(26, 4, 44, 26, 8, shop), box(26, 26, 44, 27.5, 1, awning(colours[(value + 1) % 4]), 4)]
        sprites += [tree(14, 40, True), tree(36, 42, True)]
    elif population == 1:
        paint = com_facade(p, seed, glass)
        shapes += [box(4, 4, 24, 40, 14, paint), box(28, 8, 44, 40, 11, paint)]
        shapes += rooftop(6, 8, 22, 36, 14)
    elif population == 2:
        paint = com_facade(p, seed, glass)
        shapes += [box(6, 6, 42, 38, 28, paint)]
        shapes += rooftop(10, 10, 38, 34, 28)
    elif population == 3:
        paint = com_facade(p, seed, glass)
        shapes += [box(4, 26, 44, 44, 10, paint), box(8, 6, 36, 30, 46, paint)]
        shapes += rooftop(12, 10, 32, 26, 46)
    else:
        # A skyscraper, set back near its top
        paint = com_facade(p, seed, glass)
        shapes += [box(6, 6, 42, 42, 58, paint), box(12, 12, 36, 36, 14, paint, 58)]
        shapes += rooftop(16, 16, 32, 32, 72)
    return shapes, sprites, [], []


# --- Industrial zones -----------------------------------------------------------------------------------------------

def industrial(value, population):
    p = IND_PALETTES[value]
    shapes, sprites, emitters = [], [], []
    seed = 50 + value * 4 + population
    hall = facade(p['wall'], p['wall_r'], p['roof'], p['window'], 4, 6, 3, door=((70, 66, 70), 12, 6), seed=seed)

    if population == 0:
        # A workshop, and crates in the yard
        crate = plain((176, 132, 80), (140, 104, 62), (196, 154, 100))
        shapes += [box(4, 4, 26, 24, 8, hall), roof(4, 4, 26, 24, 8, 4, (p['roof'], p['roof2']), p['wall_r'], 'x'),
                   box(32, 30, 38, 36, 4, crate), box(38, 30, 44, 36, 4, crate), box(34, 36, 40, 42, 4, crate)]
    elif population == 1:
        # A warehouse
        shapes += [box(4, 6, 44, 34, 11, hall), roof(4, 6, 44, 34, 11, 7, (p['roof'], p['roof2']), p['wall_r'], 'x')]
    elif population == 2:
        # A factory, with a saw-tooth roof and a chimney
        shapes.append(box(4, 4, 40, 40, 12, hall))
        for x0 in (4, 13, 22, 31):
            shapes.append(roof(x0, 4, x0 + 9, 40, 12, 5, (p['roof'], p['roof2']), p['wall'], 'y'))
        shapes.append(stack(40, 4, 6, 20, p['stack'][1]))
        emitters.append((43, 7, 20, 'smoke'))
    else:
        # Heavy industry: a hall, tanks and two chimneys
        shapes.append(box(4, 4, 30, 44, 16, hall))
        shapes.append(roof(4, 4, 30, 44, 16, 5, (p['roof'], p['roof2']), p['wall'], 'y'))
        tones = ((214, 216, 226), (176, 180, 194), (140, 144, 160))
        shapes += [tank(38, 12, 7, 8, tones, (150, 154, 170)), tank(38, 32, 7, 8, tones, (150, 154, 170)),
                   stack(16, 6, 8, 12, p['stack'][1], 16)]
        emitters.append((20, 10, 28, 'smoke'))
    return shapes, sprites, [], emitters


# --- Services and landmarks -----------------------------------------------------------------------------------------

def hospital():
    walls_ = facade(WHITE, (204, 204, 210), (220, 222, 228), (120, 180, 230), 3, 4, 2, seed=90)

    def cross(u, v):
        if (13 <= u < 19 and 9 <= v < 23) or (9 <= u < 23 and 13 <= v < 19):
            return RED
        return (220, 222, 228)

    shapes = [box(4, 4, 44, 44, 18, walls_), flat(8, 8, 40, 40, cross, 18.05)]
    return shapes, [tree(46, 20, True), tree(46, 30, True)], [], []


CHURCH_PALETTES = [
    {'wall': (210, 200, 176), 'wall_r': (176, 166, 144), 'roof': (120, 122, 138), 'roof2': (90, 92, 108)},
    {'wall': (196, 110, 76), 'wall_r': (156, 84, 58), 'roof': (80, 90, 110), 'roof2': (60, 68, 86)},
    {'wall': (246, 244, 236), 'wall_r': (206, 204, 198), 'roof': (60, 120, 190), 'roof2': (44, 92, 150)},
    {'wall': (236, 220, 180), 'wall_r': (196, 180, 142), 'roof': (90, 170, 150), 'roof2': (60, 130, 116)},
]


def worship(kind):
    """The eight places of worship: churches with a bell tower, a chapel, a temple with stacked roofs, buildings
    under domes"""
    p = CHURCH_PALETTES[kind % 4]
    walls_ = facade(p['wall'], p['wall_r'], p['roof'], (120, 160, 220), 4, 8, 2, door=((110, 74, 44), 30, 15), seed=kind)
    shapes, sprites = [], [tree(44, 44, True), tree(6, 44, True)]
    if kind in (0, 4):
        shapes += [box(10, 8, 40, 26, 12, walls_), roof(10, 8, 40, 26, 12, 8, (p['roof'], p['roof2']), p['wall_r'], 'x'),
                   box(38, 10, 46, 18, 22, walls_), roof(38, 10, 46, 18, 22, 6, (p['roof'], p['roof2']), p['wall_r'], 'x')]
    elif kind in (1, 5):
        shapes += [box(12, 10, 36, 30, 10, walls_), roof(12, 10, 36, 30, 10, 9, (p['roof'], p['roof2']), p['wall'], 'y')]
    elif kind in (2, 6):
        for k, (inset, z, h) in enumerate(((8, 0, 10), (12, 10, 7), (16, 17, 6))):
            shapes.append(box(inset, inset, 48 - inset, 48 - inset, h, walls_ if k == 0 else
                              plain(p['wall'], p['wall_r'], p['roof']), z))
            shapes.append(box(inset - 2, inset - 2, 50 - inset, 50 - inset, 1.5,
                              plain(p['roof'], p['roof2'], p['roof']), z + h))
    else:
        tones = (mix(p['roof'], WHITE, 0.3), p['roof'], p['roof2'])
        shapes += [box(10, 10, 38, 38, 14, walls_), dome(24, 24, 14, 10, tones, 0.9)]
    return shapes, sprites, [], []


def fire_station():
    walls_ = facade((214, 66, 52), (168, 48, 40), (150, 150, 160), (146, 192, 238), 4, 5, 2, trim=(WHITE, 11.5),
                    seed=91)

    def doors(face, u, v):
        if not STATE['lights'] and face == 'left' and v < 8 and int(u) % 11 in range(2, 9):
            return (60, 56, 70) if v < 7 else WHITE
        return walls_(face, u, v)

    return [box(4, 6, 44, 30, 13, doors), box(32, 34, 44, 44, 22, walls_)], [], [], []


def police():
    walls_ = facade((60, 84, 168), (42, 60, 126), (170, 176, 196), (176, 214, 246), 3, 4, 2, trim=(WHITE, 13),
                    seed=92)
    car = ['.kb.', 'wwww', 'kwwk']
    car_palette = {'k': (30, 26, 40), 'b': (92, 156, 255), 'w': WHITE}
    return [box(4, 4, 36, 36, 15, walls_)], [Sprite(42, 24, 0, car, car_palette),
                                             Sprite(42, 36, 0, car, car_palette)], [], []


def school():
    brick = facade((196, 98, 64), (150, 72, 48), (196, 98, 64), WHITE, 3, 5, 2, seed=93)
    shapes = [box(4, 4, 30, 24, 10, brick), roof(4, 4, 30, 24, 10, 6, ((120, 122, 138), (90, 92, 108)), (150, 72, 48)),
              box(4, 24, 18, 44, 10, brick), roof(4, 24, 18, 44, 10, 6, ((120, 122, 138), (90, 92, 108)), (196, 98, 64), 'y'),
              flat(24, 28, 44, 44, lambda u, v: (230, 200, 120) if int(u + v) % 9 else WHITE)]
    lines = [Line((40, 8, 0), (40, 8, 26), GREY_LIGHT)]
    return shapes, [Sprite(43, 5, 26, ['rrrr', 'rrrr', 'rrr.'], {'r': RED})], lines, []


def university():
    def stone(face, u, v):
        if STATE['lights']:
            return LIT[0] if face == 'left' and 3 <= v < 9 and int(u) % 4 == 2 and hashed(u, v) % 2 else None
        if face == 'top':
            return (210, 200, 176)
        if v >= 11:
            return (240, 232, 210) if face == 'left' else (200, 190, 166)
        if int(u) % 4 == 0:
            return (250, 246, 230) if face == 'left' else (214, 206, 186)
        return (190, 178, 150) if face == 'left' else (160, 148, 124)

    copper = ((120, 210, 180), (80, 170, 150), (50, 130, 120))
    shapes = [box(6, 6, 58, 30, 13, stone), box(6, 30, 22, 58, 13, stone),
              tank(32, 18, 8, 4, ((236, 226, 196), (210, 200, 176), (180, 170, 146)), (210, 200, 176), 13),
              dome(32, 18, 17, 7.5, copper, 0.9),
              flat(26, 36, 58, 58, lambda u, v: (110, 178, 84) if abs(u - v) > 2 else (214, 196, 150))]
    return shapes, [tree(52, 40), tree(36, 52), tree(56, 56, True)], [], []


def library():
    def stone(face, u, v):
        if STATE['lights']:
            return LIT[1] if face == 'left' and 2 <= v < 7 and int(u) % 4 == 2 and hashed(u, v, 7) % 2 else None
        if face == 'top':
            return (210, 200, 176)
        if v >= 8:
            return (240, 232, 210) if face == 'left' else (200, 190, 166)
        if int(u) % 4 == 0:
            return (250, 246, 230) if face == 'left' else (214, 206, 186)
        return (176, 164, 138) if face == 'left' else (146, 134, 112)

    shapes = [box(4, 4, 26, 22, 10, stone),
              roof(4, 4, 26, 22, 10, 5, ((120, 122, 138), (90, 92, 108)), (214, 206, 186)),
              box(3, 22, 27, 25, 1, plain((226, 220, 204), (190, 184, 170), (226, 220, 204))),
              flat(2, 26, 30, 30, lambda u, v: (214, 196, 150) if int(u) % 6 else (110, 178, 84))]
    return shapes, [tree(28, 8, True), tree(28, 18, True)], [], []


def police_post():
    walls_ = facade((60, 84, 168), (42, 60, 126), (170, 176, 196), (176, 214, 246), 3, 4, 2, trim=(WHITE, 9), seed=94)
    car = ['.kb.', 'wwww', 'kwwk']
    car_palette = {'k': (30, 26, 40), 'b': (92, 156, 255), 'w': WHITE}
    return [box(4, 4, 24, 22, 11, walls_)], [Sprite(28, 18, 0, car, car_palette)], [], []


def fire_post():
    walls_ = facade((214, 66, 52), (168, 48, 40), (150, 150, 160), (146, 192, 238), 4, 5, 2, trim=(WHITE, 8.5),
                    seed=95)

    def doors(face, u, v):
        if not STATE['lights'] and face == 'left' and v < 7 and int(u) % 10 in range(2, 8):
            return (60, 56, 70) if v < 6 else WHITE
        return walls_(face, u, v)

    tower = facade((214, 66, 52), (168, 48, 40), (150, 150, 160), (146, 192, 238), 4, 5, 2, trim=(WHITE, 16), seed=96)
    return [box(4, 6, 24, 26, 10, doors), box(24, 18, 30, 26, 18, tower)], [], [], []


BRONZE = ((214, 178, 92), (170, 134, 62), (120, 92, 44))


def statue():
    def paving(u, v):
        return (226, 214, 186) if (int(u) // 2 + int(v) // 2) % 2 else (196, 184, 158)

    stone = plain((236, 230, 214), (206, 198, 180), (236, 230, 214))
    figure = ['.b.', '.B.', 'bBb', 'bBb', '.B.', '.B.', 'B.B']
    return [flat(0, 0, 16, 16, paving), box(5, 5, 11, 11, 3, stone)], \
        [Sprite(8, 8, 3, big(figure), {'b': BRONZE[0], 'B': BRONZE[1]})], [], []


def town_hall():
    walls_ = facade((246, 240, 226), (206, 198, 182), (220, 214, 200), (110, 160, 220), 3, 5, 2, trim=(RED, 13),
                    door=((110, 74, 44), 40, 20), seed=97)
    clock = facade((246, 240, 226), (206, 198, 182), (220, 214, 200), None, 3, 5, 2, trim=(RED, 34), seed=97)

    def square(u, v):
        if (u - 24) ** 2 + (v - 40) ** 2 <= 20:
            return WATER_LIGHT if int(u + v) % 4 == 0 else (90, 170, 230)
        return (226, 214, 186) if (int(u) // 3 + int(v) // 3) % 2 else (196, 184, 158)

    shapes = [flat(0, 30, 48, 48, square), box(4, 4, 44, 26, 15, walls_),
              roof(4, 4, 44, 26, 15, 5, ((200, 80, 60), (160, 60, 44)), (206, 198, 182)),
              box(19, 10, 29, 20, 36, clock), roof(19, 10, 29, 20, 36, 7, ((200, 80, 60), (160, 60, 44)), (206, 198, 182))]
    lines = [Line((2, 30, 0), (2, 30, 22), GREY_LIGHT)]
    return shapes, [Sprite(4, 30, 22, ['bbbb', 'bbbb', 'bbb.'], {'b': (60, 110, 220)}), tree(10, 42), tree(42, 42)], \
        lines, []


def tower():
    steel = ((236, 238, 246), (196, 200, 214), (150, 154, 172))

    def paving(u, v):
        return (226, 214, 186) if (int(u) // 2 + int(v) // 2) % 2 else (196, 184, 158)

    def shaft(z):
        return 4.5 - 2.5 * min(z, 60) / 60

    shapes = [flat(0, 0, 32, 32, paving), tank(16, 16, shaft, 70, steel, (210, 212, 222)),
              tank(16, 16, 7, 5, steel, (220, 222, 232), 58), dome(16, 16, 63, 7, steel, 0.4),
              tank(16, 16, 1, 16, steel, WHITE, 64)]
    return shapes, [Sprite(16, 16, 80, ['r'], {'r': RED})], [], []


def recycling():
    hall = facade((140, 150, 160), (110, 118, 128), (160, 168, 178), (176, 214, 246), 4, 5, 3, seed=101)

    def yard(u, v):
        return (150, 150, 156) if (int(u) // 4 + int(v) // 4) % 2 else (162, 162, 168)

    bins = [((52, 110, 210), (36, 80, 160)), ((58, 150, 70), (40, 110, 50)), ((236, 196, 60), (190, 150, 40))]
    shapes = [flat(0, 0, 48, 48, yard), box(4, 4, 28, 24, 12, hall),
              box(28, 12, 44, 15, 6, plain((70, 66, 84), (54, 50, 66), (90, 86, 100)))]
    for i, (light, dark_) in enumerate(bins):
        shapes.append(box(31 + 5 * i, 3, 35 + 5 * i, 9, 4, plain(light, dark_, mix(light, WHITE, 0.3))))
    for i, (x, y) in enumerate(((5, 28), (12, 28), (19, 28), (5, 35), (12, 35))):
        light, dark_ = bins[i % 3]
        shapes.append(box(x, y, x + 5, y + 5, 4, plain(light, dark_, mix(light, WHITE, 0.3))))
    return shapes, [], [], []


def waterworks():
    house_ = facade(WHITE, (204, 204, 210), (60, 110, 200), (110, 160, 220), 3, 4, 2, seed=102)
    rim = ((226, 228, 236), (186, 190, 204), (146, 150, 168))

    def basin(cx, cy):
        def water(x, y):
            d = math.hypot(x - cx, y - cy)
            if d < 1.5 or (d < 8 and abs((x - cx) * 0.4 - (y - cy)) < 0.7 and x > cx):
                return (210, 212, 222)
            return WATER_LIGHT if int(x * 2 + y) % 7 == 0 else (90, 170, 230)

        def paint(x, y, z):
            if z > 2.7 and math.hypot(x - cx, y - cy) < 8.6:
                return water(x, y)
            return lit(rim[0], rim[1], rim[2], 0.5 + 0.4 * ((y - cy) - (x - cx)) / 10)

        return [night(Solid(cx - 10, cy - 10, 0, cx + 10, cy + 10, 3, lambda x, y, z: math.hypot(x - cx, y - cy) <= 10,
                            paint))]

    shapes = [box(28, 28, 46, 44, 11, house_)]
    for cx, cy in ((12, 12), (36, 12), (12, 36)):
        shapes += basin(cx, cy)
    return shapes, [], [], []


BUS_YELLOW = ((250, 204, 60), (206, 160, 40), (236, 236, 230))


def bus_paint(face, u, v):
    if STATE['lights']:
        return None
    if face == 'top':
        return BUS_YELLOW[2]
    if 2 <= v < 3.6 and int(u) % 3 != 0:
        return (120, 170, 220) if face == 'left' else (90, 130, 180)
    return BUS_YELLOW[0] if face == 'left' else BUS_YELLOW[1]


def bus_stop():
    def pavement(u, v):
        return (196, 196, 204) if v >= 9 else (110, 178, 84)

    glass = plain((150, 196, 236), (110, 150, 196), (70, 66, 84))
    shapes = [flat(0, 0, 16, 16, pavement), box(3, 7, 12, 9, 6, glass), box(2, 6, 13, 10, 0.8, plain(
        (70, 66, 84), (54, 50, 66), (90, 86, 100)), 6)]
    lines = [Line((14, 12, 0), (14, 12, 9), GREY_LIGHT)]
    return shapes, [Sprite(14, 12, 9, ['yy', 'yy'], {'y': (250, 204, 60)})], lines, []


def bus_depot():
    hall = facade((150, 150, 160), (118, 118, 130), (170, 170, 184), (176, 214, 246), 4, 6, 3, seed=103)

    def doors(face, u, v):
        if not STATE['lights'] and face == 'left' and v < 7 and int(u) % 8 in range(1, 7):
            return (60, 56, 70) if v < 6.5 else (250, 204, 60)
        return hall(face, u, v)

    def yard(u, v):
        return (150, 150, 156) if (int(u) // 4 + int(v) // 4) % 2 else (162, 162, 168)

    shapes = [flat(0, 0, 48, 48, yard), box(2, 2, 46, 20, 11, doors)]
    for x in range(5, 44, 9):
        shapes.append(box(x, 25, x + 6, 42, 5, bus_paint))
    return shapes, [], [], []


def stadium(full):
    cx, cy, rx, ry = 32, 32, 28, 24

    def ellipse(x, y):
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2

    def stands_inside(x, y, z):
        e = ellipse(x, y)
        return 0.5 <= e <= 1 and z <= 2 + 11 * (e - 0.5) / 0.5

    def stands_paint(x, y, z):
        if STATE['lights']:
            return None
        e = ellipse(x, y)
        if e > 0.95:
            return (200, 204, 214) if y > cy else (160, 164, 180)
        if full and hashed(x, y, z) % 3 == 0:
            return [(240, 120, 90), (250, 210, 72), WHITE][hashed(x, y) % 3]
        return (92, 156, 255) if int((e - 0.5) * 16) % 2 == 0 else (60, 116, 210)

    def pitch(u, v):
        e = ellipse(u, v)
        if e >= 0.5:
            return (176, 172, 166)
        if abs(u - cx) < 0.6 or abs(math.sqrt(e) - 0.3) < 0.03:
            return WHITE
        return (80, 170, 70) if int(u / 4) % 2 else (96, 184, 80)

    stands = Solid(cx - rx, cy - ry, 0, cx + rx, cy + ry, 13, stands_inside, stands_paint)
    lights = []
    if full:
        for x, y in ((8, 8), (56, 8), (8, 56), (56, 56)):
            lights.append(Line((x, y, 0), (x, y, 22), GREY_LIGHT))
    sprites = [Sprite(x, y, 22, ['yy'], {'y': (255, 244, 180)}) for x, y in ((8, 8), (56, 8), (8, 56), (56, 56))] \
        if full else []
    return [flat(0, 0, 64, 64, pitch), stands], sprites, lights, []


def port():
    def quay(u, v):
        return (176, 172, 166) if (int(u) // 4 + int(v) // 4) % 2 else (160, 156, 150)

    def container(colour):
        return plain(colour, shade(colour, 0.75), shade(colour, 1.15))

    warehouse = facade((150, 160, 180), (120, 128, 146), (130, 140, 160), (176, 214, 246), 4, 6, 3, seed=94)
    crane = plain(YELLOW, (200, 160, 50), YELLOW)
    shapes = [flat(0, 0, 64, 64, quay), box(4, 4, 30, 26, 14, warehouse),
              roof(4, 4, 30, 26, 14, 5, ((120, 130, 150), (90, 98, 116)), (120, 128, 146))]
    colours = [RED, (60, 116, 210), (80, 170, 90), (240, 160, 40)]
    for k in range(6):
        x0, y0 = 36 + (k % 3) * 8, 6 + (k // 3) * 6
        shapes.append(box(x0, y0, x0 + 7, y0 + 5, 5 + 5 * (k % 2), container(colours[(k * 3) % 4])))
    for y in (36, 50):
        shapes += [box(46, y, 48, y + 2, 26, crane), box(56, y, 58, y + 2, 26, crane), box(40, y - 1, 62, y + 3, 3, crane, 26)]
    return shapes, [], [], []


def airport():
    def tarmac(u, v):
        if 60 <= v < 78:
            if abs(v - 69) < 0.7 and int(u) % 8 < 4:
                return WHITE
            if (u < 6 or u > 90) and int(v) % 3 == 0:
                return WHITE
            return (70, 68, 80)
        return (150, 148, 144) if (int(u) // 8 + int(v) // 8) % 2 else (140, 138, 134)

    terminal = facade((220, 224, 232), (180, 186, 198), (200, 204, 214), (100, 160, 220), 2, 4, 2, seed=95)
    hangar_walls = plain((210, 210, 220), (170, 170, 184), (210, 210, 220))
    tower = facade((220, 224, 232), (180, 186, 198), (200, 204, 214), None, 3, 4, 2)
    cab = facade((120, 190, 230), (90, 150, 196), (200, 204, 214), (176, 214, 246), 1, 2, 1, seed=96)
    shapes = [flat(0, 0, 96, 96, tarmac), box(6, 6, 50, 26, 12, terminal),
              box(58, 6, 82, 26, 10, hangar_walls),
              roof(58, 6, 82, 26, 10, 7, ((200, 204, 214), (150, 154, 170)), (170, 170, 184), 'y'),
              box(10, 34, 18, 42, 26, tower), box(8, 32, 20, 44, 6, cab, 26), box(9, 33, 19, 43, 1, tower, 32)]
    plane = ['...w...', '...w...', 'wwwwwww', '...w...', '..www..']
    return shapes, [Sprite(40, 46, 0, plane, {'w': WHITE}), Sprite(70, 46, 0, plane, {'w': WHITE})], [], []


def coal():
    plant = facade((150, 90, 70), (118, 70, 54), (110, 104, 108), (250, 200, 120), 4, 6, 3, seed=97)
    heap = plain((60, 56, 66), (42, 40, 48), (74, 70, 80))
    shapes = [box(4, 14, 40, 52, 18, plant), roof(4, 14, 40, 52, 18, 6, ((110, 104, 108), (84, 80, 86)), (118, 70, 54), 'y'),
              stack(8, 4, 9, 26, (150, 146, 150)), stack(24, 4, 9, 26, (150, 146, 150)),
              box(44, 36, 60, 60, 3, heap), box(47, 40, 58, 57, 3, heap, 3), box(50, 44, 56, 54, 2, heap, 6)]
    return shapes, [], [], [(12.5, 8.5, 26, 'smoke'), (28.5, 8.5, 26, 'smoke')]


def nuclear():
    tones = ((226, 228, 236), (186, 190, 204), (146, 150, 168))

    def waist(z):
        return 11 - 3.5 * math.sin(math.pi * min(z, 20) / 26)

    shapes = [tank(17, 17, waist, 26, tones, (60, 62, 74)), tank(45, 17, waist, 26, tones, (60, 62, 74)),
              box(32, 36, 58, 58, 12, facade(WHITE, (204, 204, 210), GREY_LIGHT, (146, 192, 238), 4, 6, 3, seed=98)),
              tank(16, 46, 11, 9, ((236, 236, 244), (196, 200, 212), (156, 160, 176)), (210, 212, 222)),
              dome(16, 46, 9, 11, ((236, 236, 244), (196, 200, 212), (156, 160, 176)), 0.45)]
    return shapes, [], [], [(17, 17, 26, 'steam'), (45, 17, 26, 'steam')]


def gas():
    plant = facade((210, 214, 224), (164, 168, 182), (180, 184, 196), (146, 192, 238), 3, 5, 2, seed=99)
    tank_tones = (WHITE, (214, 216, 222), (170, 174, 186))
    shapes = [box(4, 4, 24, 26, 12, plant), box(8, 8, 18, 18, 4, plain(GREY_LIGHT, GREY, (200, 200, 210)), 12),
              tank(36, 12, 8, 8, tank_tones, (200, 204, 214)), tank(36, 34, 8, 8, tank_tones, (200, 204, 214)),
              tank(12, 38, 6, 5, tank_tones, (200, 204, 214))]
    return shapes, [], [], [(13, 13, 16, 'steam')]


def solar():
    def panels(u, v):
        if int(v) % 12 < 9:
            return (150, 190, 240) if int(u) % 4 == 0 else (52, 80, 170)
        return (110, 178, 84)

    return [flat(2, 2, 46, 46, panels, 1)], [], [], []


def wind(frame):
    """A wind turbine: its mast, and its rotor turning (four frames)"""
    mast = plain(WHITE, (200, 196, 186), WHITE)
    lines = []
    hub = (8, 8, 30)
    for k in range(3):
        angle = frame * math.pi / 6 + k * 2 * math.pi / 3
        # The rotor faces the viewer: it turns in the plane of the screen
        dx, dz = math.cos(angle) * 11, math.sin(angle) * 11
        lines.append(Line(hub, (hub[0] + dx / 2, hub[1] - dx / 2, hub[2] + dz), WHITE))
    return [box(7, 7, 9, 9, 30, mast), box(6, 6, 10, 10, 2, mast, 29)], [], lines, []


def bigpark():
    def ground(u, v):
        if ((u - 30) ** 2) / 120 + ((v - 30) ** 2) / 80 <= 1:
            return WATER_LIGHT if (int(u) + int(v)) % 6 == 0 else (60, 120, 200)
        if abs(u - v) < 1.5:
            return (214, 196, 150)
        return (110, 178, 84)

    return [flat(0, 0, 48, 48, ground)], [tree(8, 8), tree(16, 6), tree(6, 18), tree(40, 10, True),
                                         tree(12, 40, True), tree(44, 44), tree(22, 44, True)], [], []


def garden():
    flowers = [(240, 120, 170), (250, 210, 72), (232, 70, 54), (250, 246, 230)]

    def beds(u, v):
        if int(u) in (0, 15) or int(v) in (0, 15):
            return (58, 130, 56)
        if int(u) % 4 == 2 and int(v) % 2 == 1:
            return flowers[(int(u) + int(v)) // 2 % 4]
        return (110, 178, 84)

    return [flat(0, 0, 16, 16, beds), box(0, 0, 16, 1.5, 2, plain((58, 130, 56), (40, 100, 44), (80, 150, 70)))], [], [], []


def fountain(paved):
    def ground(u, v):
        if paved:
            return (226, 214, 186) if (int(u) // 2 + int(v) // 2) % 2 else (196, 184, 158)
        return (110, 178, 84)

    stone = ((236, 230, 214), (206, 198, 180), (170, 162, 146))

    def pool(u, v):
        d = math.hypot(u - 8, v - 8)
        if d > 4.6:
            return stone[0]
        return WATER_LIGHT if int(u * 2 + v) % 5 == 0 else (90, 170, 230)

    basin = night(Solid(2.5, 2.5, 0, 13.5, 13.5, 2.5, lambda x, y, z: math.hypot(x - 8, y - 8) <= 5.5,
                        lambda x, y, z: pool(x, y) if z > 2.2 else lit(stone[0], stone[1], stone[2],
                                                                     0.5 + 0.4 * ((y - 8) - (x - 8)) / 5.5)))
    spray = ['.w.w.', 'w.b.w', '..b..', '.wbw.', '..b..']
    return [flat(0, 0, 16, 16, ground), basin, tank(8, 8, 1, 4, stone, stone[0], 2)], \
        [Sprite(8, 8, 6, spray, {'b': (198, 224, 242), 'w': WHITE})], [], []


def house_tile(k):
    """The twelve houses of the low density residential zones, from the humblest to the grandest"""
    p = RES_PALETTES[min(3, k // 3)]
    shapes = house(3, 3, 13, 12, p, 'x' if k % 2 else 'y', 6 + k // 4, 5, seed=k)
    sprites = [tree(14, 13, True)] if k >= 6 else []
    return shapes, sprites, [], []


def trees(kind, k):
    """A wooded tile: dense, or sparse at the edge of a wood"""
    spots = [(3, 4), (11, 3), (7, 9), (13, 11), (4, 13), (10, 15)]
    count = 6 if kind == 'dense' else 3
    sprites = []
    for n in range(count):
        x, y = spots[(n + k) % len(spots)]
        sprites.append(tree(x + (hashed(k, n) % 3) - 1, y, small=hashed(n, k) % 3 == 0, pine=hashed(k, n, 7) % 4 == 0))
    return [], sorted(sprites, key=lambda s: s.x + s.y), [], []


def pole(mask, place=(8, 8)):
    """A power pole, its wires running to the sides of the mask (north, east, south, west: 1, 2, 4, 8)"""
    wood = plain((140, 100, 60), (110, 76, 46), (150, 110, 70))
    x, y = place
    shapes = [box(x - 0.5, y - 0.5, x + 0.5, y + 0.5, 13, wood)]
    along_x = mask & (2 | 8) or not mask & (1 | 4)
    if along_x:
        shapes.append(box(x - 0.5, y - 2.5, x + 0.5, y + 2.5, 1, wood, 12))
    else:
        shapes.append(box(x - 2.5, y - 0.5, x + 2.5, y + 0.5, 1, wood, 12))
    lines = []
    wire = (60, 60, 72)
    for bit, end in ((1, (x, 0)), (2, (U, y)), (4, (x, U)), (8, (0, y))):
        if mask & bit:
            for offset in (-2, 2):
                if bit in (2, 8):
                    lines.append(Line((x, y + offset, 12.5), (end[0], end[1] + offset, 12.5), wire))
                else:
                    lines.append(Line((x + offset, y, 12.5), (end[0] + offset, end[1], 12.5), wire))
    return shapes, [], lines, []


FLAMES = [
    ['...y....', '..yy..y.', '.yoy.yy.', '.yoryoy.', 'yorrroy.', 'oorrrro.', '.orrro..'],
    ['....y...', '.y.yy...', '.yyoy.y.', '.yoroyy.', 'yorrryo.', 'oorrrro.', '.orrro..'],
    ['..y.....', '..yy.y..', '.yyoyy..', 'yoorroy.', 'yorrrroy', 'oorrrro.', '.orrro..'],
    ['.....y..', '.y..yy..', '.yy.yoy.', '.yoyroy.', 'yorrrroy', 'oorrrro.', '.orrro..'],
]
FLAME_PALETTE = {'y': (255, 230, 110), 'o': (250, 150, 50), 'r': (220, 70, 40)}


def fire(frame):
    flames = FLAMES[frame]
    return [], [Sprite(4, 6, 0, flames, FLAME_PALETTE), Sprite(12, 7, 0, FLAMES[(frame + 1) % 4], FLAME_PALETTE),
                Sprite(9, 12, 0, big(FLAMES[(frame + 2) % 4]), FLAME_PALETTE)], [], []


def sign(kind):
    letters = {
        'residential': ['.rrrrr.', '.rwwrr.', '.rwrwr.', '.rwwrr.', '.rwrwr.', '.rrrrr.', '...p...', '...p...'],
        'commercial': ['.rrrrr.', '.rrwwr.', '.rwrrr.', '.rwrrr.', '.rrwwr.', '.rrrrr.', '...p...', '...p...'],
        'industrial': ['.rrrrr.', '.rwwwr.', '.rrwrr.', '.rrwrr.', '.rwwwr.', '.rrrrr.', '...p...', '...p...'],
    }
    colour = {'residential': (90, 180, 80), 'commercial': (70, 130, 230), 'industrial': (220, 170, 40)}[kind]
    return [], [Sprite(8, 8, 0, big(letters[kind]), {'r': colour, 'w': WHITE, 'p': (110, 76, 46)})], [], []


BOLT = ['..yyy', '.yyy.', 'yyy..', 'yyyyy', '..yy.', '.yy..', 'yy...']


def bolt():
    return [], [Sprite(8, 8, 0, big(BOLT), {'y': YELLOW})], [], []


def explosion(frame):
    size = [['.y.', 'yoy', '.y.'], ['.yoy.', 'yorry', 'orrro', 'yorry', '.yoy.'],
            ['..yoy..', '.yorry.', 'yorrroy', 'orrkrro', 'yorrroy', '.yorry.', '..yoy..'],
            ['..k.k..', '.kkkkk.', 'kkokkkk', 'kkkkkok', '.kkkkk.', '..kkk..']][frame]
    return [], [Sprite(8, 8, 6 - frame, big(size), {'y': (255, 230, 110), 'o': (250, 150, 50), 'r': (220, 70, 40),
                                                 'k': (90, 86, 96)})], [], []


# --- The objects ----------------------------------------------------------------------------------------------------

def objects():
    """Every object: [(name, size in tiles, builder)]. A builder gives (shapes, sprites, lines, emitters), the emitters
    being the points smoke or steam rises from: (X, Y, Z, kind) from the object's origin."""
    out = []
    for value in range(4):
        for population in range(4):
            out.append(('res_%d_%d' % (value, population), 3, lambda v=value, p=population: residential(v, p)))
    for value in range(4):
        for population in range(5):
            out.append(('com_%d_%d' % (value, population), 3, lambda v=value, p=population: commercial(v, p)))
    for value in range(2):
        for population in range(4):
            out.append(('ind_%d_%d' % (value, population), 3, lambda v=value, p=population: industrial(v, p)))
    out.append(('hospital', 3, hospital))
    for kind in range(8):
        out.append(('worship%d' % kind, 3, lambda k=kind: worship(k)))
    out += [('fire_station', 3, fire_station), ('police', 3, police), ('school', 3, school),
            ('university', 4, university), ('library', 2, library), ('police_post', 2, police_post),
            ('fire_post', 2, fire_post), ('statue', 1, statue), ('town_hall', 3, town_hall), ('tower', 2, tower),
            ('recycling', 3, recycling), ('waterworks', 3, waterworks), ('bus_stop', 1, bus_stop),
            ('bus_depot', 3, bus_depot), ('stadium', 4, lambda: stadium(False)), ('stadium_full', 4, lambda: stadium(True)),
            ('port', 4, port), ('airport', 6, airport), ('coal', 4, coal), ('nuclear', 4, nuclear), ('gas', 3, gas),
            ('solar', 3, solar), ('bigpark', 3, bigpark), ('garden', 1, garden), ('plaza', 1, lambda: fountain(True)),
            ('fountain', 1, lambda: fountain(False))]
    for frame in range(4):
        out.append(('wind%d' % frame, 1, lambda f=frame: wind(f)))
    for k in range(12):
        out.append(('house%d' % k, 1, lambda n=k: house_tile(n)))
    for kind in ('dense', 'sparse'):
        for k in range(4):
            out.append(('trees_%s%d' % (kind, k), 1, lambda d=kind, n=k: trees(d, n)))
    for mask in range(16):
        out.append(('pole%d' % mask, 1, lambda m=mask: pole(m)))
    out += [('pole_road_x', 1, lambda: pole(1 | 4, (8, 1.5))), ('pole_road_y', 1, lambda: pole(2 | 8, (1.5, 8)))]
    for frame in range(4):
        out.append(('fire%d' % frame, 1, lambda f=frame: fire(f)))
    for frame in range(4):
        out.append(('explosion%d' % frame, 1, lambda f=frame: explosion(f)))
    for kind in ('residential', 'commercial', 'industrial'):
        out.append(('sign_%s' % kind, 1, lambda k=kind: sign(k)))
    out.append(('bolt', 1, bolt))
    return out


# --- Drawing an object ----------------------------------------------------------------------------------------------

def extent(shapes, sprites, lines):
    """The extent of an object on the screen, from its origin: (left, top, right, bottom)"""
    left, top, right, bottom = 0, 0, 0, 0
    for s in shapes:
        left, right = min(left, s.left), max(right, s.right)
        top, bottom = min(top, s.top), max(bottom, s.bottom)
    for sp in sprites:
        x, y = sp.x - sp.y, (sp.x + sp.y) / 2.0 - sp.z
        w, h = len(sp.rows[0]), len(sp.rows)
        left, right = min(left, x - w), max(right, x + w)
        top, bottom = min(top, y - h - 1), max(bottom, y + 1)
    for line in lines:
        for x, y, z in (line.start, line.end):
            left, right = min(left, x - y), max(right, x - y)
            top, bottom = min(top, (x + y) / 2.0 - z), max(bottom, (x + y) / 2.0 - z)
    return int(math.floor(left)) - 2, int(math.floor(top)) - 2, int(math.ceil(right)) + 2, int(math.ceil(bottom)) + 2


def draw(builder, lights=False):
    """The object's picture (or the picture of its lights by night), and the pixel of its origin: (image, x, y), the
    image being None if there is nothing to see"""
    from iso import to_image
    STATE['lights'] = lights
    try:
        shapes, sprites, lines, _ = builder()
        if lights:
            sprites, lines = [], []
        left, top, right, bottom = extent(shapes, sprites, lines)
        width, height = right - left, bottom - top
        pixels = render(width, height, shapes, sprites, (-left, -top), transparent, lines, highlight=not lights,
                        outline=not lights)
    finally:
        STATE['lights'] = False

    image = to_image(pixels)
    box_ = image.getbbox()
    if box_ is None:
        return None, 0, 0
    return image.crop(box_), -left - box_[0], -top - box_[1]


def emitters(builder):
    return builder()[3]


# --- Vehicles -------------------------------------------------------------------------------------------------------

# The headings of the game's sprites, frames 1 to 8: north, north-east, east... (a unit vector on the map)
HEADINGS = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]


def hull(cx, cy, heading, length, width, z0, z1, colours, taper=0.0):
    """A box turned to the heading, centred on (cx, cy): colours (top, side, front), the side darker on the right. Its
    front is narrowed by taper (a bow)."""
    hx, hy = heading
    norm = math.hypot(hx, hy)
    hx, hy = hx / norm, hy / norm
    reach = (abs(hx) * length + abs(hy) * width) / 2 + 1, (abs(hy) * length + abs(hx) * width) / 2 + 1

    def local(x, y):
        dx, dy = x - cx, y - cy
        return dx * hx + dy * hy, -dx * hy + dy * hx

    def inside(x, y, z):
        u, v = local(x, y)
        half = width / 2
        if taper and u > length / 2 - taper:
            half *= max(0.15, (length / 2 - u) / taper)
        return abs(u) <= length / 2 and abs(v) <= half and z0 <= z <= z1

    def paint(x, y, z):
        if STATE['lights']:
            return None
        top, side, front = colours
        if z > z1 - 0.35:
            return top
        u, v = local(x, y)
        if abs(u) > length / 2 - 0.45:
            normal = (hx, hy) if u > 0 else (-hx, -hy)
            colour = front
        else:
            normal = (-hy, hx) if v > 0 else (hy, -hx)
            colour = side
        # Faces turned to the east are in the shade
        return shade(colour, 1 - 0.2 * max(0.0, normal[0]) - 0.08 * max(0.0, -normal[1]))

    return Solid(cx - reach[0], cy - reach[1], z0, cx + reach[0], cy + reach[1], z1, inside, paint)


def train(axis):
    """A locomotive and a carriage, along the axis: 'ns', 'ew', 'nwse' or 'nesw'"""
    heading = {'ns': (0, 1), 'ew': (1, 0), 'nwse': (1, 1), 'nesw': (1, -1)}[axis]
    norm = math.hypot(*heading)
    hx, hy = heading[0] / norm, heading[1] / norm
    shapes = []
    for k, (offset, colours) in enumerate(((-6.5, ((180, 60, 50), (214, 72, 58), (214, 72, 58))),
                                          (6.5, ((150, 154, 170), (226, 228, 236), (200, 204, 214))))):
        cx, cy = hx * offset, hy * offset
        shapes.append(hull(cx, cy, heading, 12, 5, 0, 5, colours))
        shapes.append(hull(cx, cy, heading, 11, 4, 5, 6, ((90, 92, 108), (90, 92, 108), (90, 92, 108))))
    return shapes, [], [], []


def ship(frame):
    heading = HEADINGS[frame]
    hx, hy = heading[0] / math.hypot(*heading), heading[1] / math.hypot(*heading)
    shapes = [hull(0, 0, heading, 22, 8, 0, 3, ((236, 232, 220), (200, 62, 52), (200, 62, 52)), taper=6),
              hull(-hx * 3, -hy * 3, heading, 8, 5, 3, 7, (WHITE, (226, 228, 236), (226, 228, 236))),
              hull(-hx * 7.5, -hy * 7.5, heading, 3, 3, 3, 9, ((50, 46, 50), (240, 160, 40), (240, 160, 40)))]
    return shapes, [], [], []


def airplane(frame):
    heading = HEADINGS[frame]
    hx, hy = heading[0] / math.hypot(*heading), heading[1] / math.hypot(*heading)
    body = (WHITE, (226, 228, 236), (200, 204, 214))
    wing = ((214, 216, 226), (176, 180, 194), (176, 180, 194))
    shapes = [hull(0, 0, heading, 22, 3.5, 0, 3.5, body, taper=4),
              hull(hx * 1, hy * 1, (-hy, hx), 20, 5, 1, 2, wing, taper=0),
              hull(-hx * 9, -hy * 9, (-hy, hx), 8, 3, 2, 3, wing),
              hull(-hx * 9, -hy * 9, heading, 3, 1, 3.5, 7, ((60, 116, 210), (60, 116, 210), (60, 116, 210)))]
    return shapes, [], [], []


def copter(frame):
    heading = HEADINGS[frame]
    hx, hy = heading[0] / math.hypot(*heading), heading[1] / math.hypot(*heading)
    body = ((214, 72, 58), (232, 92, 72), (120, 190, 230))
    shapes = [hull(hx * 2, hy * 2, heading, 10, 6, 0, 5, body, taper=2),
              hull(-hx * 6, -hy * 6, heading, 8, 1.5, 3, 4.5, ((214, 72, 58), (232, 92, 72), (232, 92, 72))),
              hull(hx * 2, hy * 2, heading, 1.5, 1.5, 5, 6.5, (GREY_DARK, GREY_DARK, GREY_DARK))]
    rotor = (60, 60, 72)
    lines = [Line((hx * 2 - 9 * hx, hy * 2 - 9 * hy, 6.8), (hx * 2 + 9 * hx, hy * 2 + 9 * hy, 6.8), rotor),
             Line((hx * 2 + 9 * hy, hy * 2 - 9 * hx, 6.8), (hx * 2 - 9 * hy, hy * 2 + 9 * hx, 6.8), rotor)]
    return shapes, [], lines, []


# The colours of the cars (see ambientLife.js)
CAR_COLOURS = ['d83c30', '3c6ad8', 'f2f0e6', 'f8c838', '3ca850', 'e07830', '9094a8', '58c4d4', 'a050c0']


def car(direction, colour):
    """A car heading north, east, south or west (0 to 3), on the ground"""
    heading = [(0, -1), (1, 0), (0, 1), (-1, 0)][direction]
    rgb = tuple(int(colour[k:k + 2], 16) for k in (0, 2, 4))
    body = (shade(rgb, 1.1), rgb, rgb)
    glass = ((168, 196, 224), (130, 160, 196), (168, 196, 224))
    return [hull(0, 0, heading, 7, 4, 0, 2.5, body), hull(-heading[0] * 0.5, -heading[1] * 0.5, heading, 3.5, 3.5, 2.5,
                                                         4, glass)], [], [], []


SAIL = ['..s..', '..ss.', '..sss', '..sss', '..ssss', '..m...', 'hhhhhhh', '.hhhhh.']
SAIL_PALETTE = {'s': (246, 244, 234), 'm': (60, 50, 50), 'h': (154, 98, 52)}


def sailboat(mirror):
    rows = [row.ljust(7, '.') for row in SAIL]
    if mirror:
        rows = [row[::-1] for row in rows]
    return [], [Sprite(0, 0, 0, rows, SAIL_PALETTE)], [], []


def vehicles():
    """Every vehicle: [(name, builder)], drawn round their centre on the ground (the planes and helicopters are lifted
    into the air when the game draws them, over their shadows)"""
    out = [('train_%s' % axis, lambda a=axis: train(a)) for axis in ('ns', 'ew', 'nwse', 'nesw')]
    for frame in range(8):
        out.append(('ship%d' % (frame + 1), lambda f=frame: ship(f)))
        out.append(('plane%d' % (frame + 1), lambda f=frame: airplane(f)))
        out.append(('copter%d' % (frame + 1), lambda f=frame: copter(f)))
    for direction in range(4):
        for colour in CAR_COLOURS:
            out.append(('car%d_%s' % (direction, colour), lambda d=direction, c=colour: car(d, c)))
    out += [('sailboat_r', lambda: sailboat(False)), ('sailboat_l', lambda: sailboat(True))]
    return out


def shadow(builder):
    """The shadow of a flying vehicle: its shapes squashed onto the ground"""
    def squashed():
        shapes, sprites, lines, emitters = builder()
        flat_shapes = []
        for s in shapes:
            def inside(x, y, z, s=s):
                return any(s.inside(x, y, h) for h in (s.z0 + 0.1, (s.z0 + s.z1) / 2, s.z1 - 0.1))
            flat_shapes.append(Solid(s.x0, s.y0, 0, s.x1, s.y1, 0.4, inside, lambda x, y, z: (20, 16, 30)))
        return flat_shapes, [], [], []
    return squashed
