#
# KawaCity: the tiles that KawaCity adds to the original game (tile numbers 1024 and up), and the restyled roads.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.
#
# New buildings are drawn here as "source art" in the original game's 16 colour palette (one colour name per pixel),
# then remastered by generate.py exactly like the original buildings: the same palette, lighting, shadows and
# seasons. Keep the tile numbers in sync with src/tileValues.ts.

import math

import numpy as np

import generate as g

TS = g.TS


class Art:
    """A block of tiles drawn with the names of the original palette"""

    def __init__(self, size, fill='ground'):
        self.size = size
        self.names = np.full((size * TS, size * TS), fill, dtype=object)

    def rect(self, x, y, w, h, name):
        self.names[max(0, y):y + h, max(0, x):x + w] = name
        return self

    def frame(self, x, y, w, h, name):
        self.rect(x, y, w, 1, name).rect(x, y + h - 1, w, 1, name)
        self.rect(x, y, 1, h, name).rect(x + w - 1, y, 1, h, name)
        return self

    def pixel(self, x, y, name):
        if 0 <= y < self.names.shape[0] and 0 <= x < self.names.shape[1]:
            self.names[y, x] = name
        return self

    def disc(self, cx, cy, r, name):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    self.pixel(x, y, name)
        return self

    def line(self, x0, y0, x1, y1, name):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(steps + 1):
            t = i / steps
            self.pixel(int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t)), name)
        return self

    def tree(self, cx, cy, r=3):
        """A round tree crown, lit from the top left"""
        self.disc(cx, cy, r, 'dgreen')
        self.disc(cx - r * 0.3, cy - r * 0.3, r * 0.55, 'green')
        return self

    def rgb(self):
        out = np.zeros(self.names.shape + (3,), dtype=np.uint8)
        for name, colour in g.ORIG.items():
            out[self.names == name] = colour
        return out


# --- The buildings --------------------------------------------------------------------------------------------------

def wind_turbine(frame):
    """A wind turbine on a small pad; the rotor turns over 4 frames (its three blades repeat every 120 degrees)"""
    a = Art(1)
    a.rect(5, 12, 6, 3, 'lgrey')
    a.rect(7, 4, 2, 10, 'white')
    a.rect(7, 13, 2, 1, 'grey')
    hub = (8, 4)
    for blade in range(3):
        angle = math.radians(frame * 30 + blade * 120 - 90)
        end = (hub[0] + math.cos(angle) * 6, hub[1] + math.sin(angle) * 6)
        a.line(hub[0], hub[1], end[0], end[1], 'white')
    a.rect(7, 3, 3, 2, 'lgrey')
    a.pixel(9, 4, 'red')
    return a


def gas_plant():
    a = Art(3).rect(1, 1, 46, 46, 'lgrey')
    # Gas holder
    a.disc(13, 13, 10, 'white').disc(13, 13, 7, 'lgrey').disc(13, 13, 4, 'white')
    # Turbine hall, with a row of vents on its roof
    a.rect(4, 28, 30, 16, 'grey').rect(4, 28, 30, 3, 'dgrey')
    for x in range(7, 32, 5):
        a.rect(x, 34, 3, 2, 'dgrey')
    a.rect(6, 40, 8, 4, 'blue')
    # Chimney, striped red and white
    a.rect(38, 4, 6, 30, 'white')
    for y in range(4, 34, 6):
        a.rect(38, y, 6, 3, 'red')
    a.rect(37, 33, 8, 3, 'grey')
    # Pipes
    a.rect(23, 12, 15, 2, 'yellow').rect(36, 12, 2, 18, 'yellow').rect(26, 22, 2, 7, 'yellow')
    return a


def solar_farm():
    a = Art(3)
    # Rows of panels, with grass between them
    for y in range(3, 44, 9):
        for x in range(2, 46, 11):
            a.rect(x, y, 10, 6, 'blue')
            a.rect(x, y, 10, 1, 'water')
            for cx in range(x + 2, x + 10, 3):
                a.rect(cx, y + 1, 1, 5, 'water')
    # Inverter hut and a path
    a.rect(34, 39, 11, 8, 'white').rect(34, 39, 11, 2, 'grey').rect(37, 43, 3, 4, 'dgrey')
    a.frame(0, 0, 48, 48, 'grey')
    return a


def school():
    a = Art(3)
    # Main building, an L of red brick under a grey roof
    a.rect(2, 2, 30, 18, 'red').rect(2, 2, 30, 4, 'dgrey')
    a.rect(2, 2, 12, 34, 'red').rect(2, 2, 12, 4, 'dgrey')
    for x in range(17, 31, 4):
        a.rect(x, 10, 2, 3, 'water').rect(x, 15, 2, 3, 'water')
    for y in range(10, 34, 5):
        a.rect(5, y, 2, 3, 'water').rect(9, y, 2, 3, 'water')
    a.rect(20, 17, 4, 3, 'brown')
    # Playground: a sports court, and sand under a climbing frame
    a.rect(18, 24, 27, 20, 'orange')
    a.frame(20, 26, 23, 16, 'white').rect(31, 26, 1, 16, 'white')
    a.disc(31, 34, 3, 'orange').disc(31, 34, 2, 'orange')
    a.frame(29, 32, 5, 5, 'white')
    a.rect(2, 39, 12, 7, 'brown').frame(4, 40, 8, 5, 'red')
    # Flag
    a.rect(39, 4, 1, 14, 'lgrey').rect(40, 4, 5, 3, 'blue')
    a.tree(42, 13, 3)
    return a


def university():
    a = Art(4)
    # Lawn crossed by paths
    a.rect(30, 0, 4, 64, 'lgrey').rect(0, 46, 64, 4, 'lgrey')
    # Main hall: a long building with columns and a dome
    a.rect(4, 4, 56, 22, 'white').rect(4, 4, 56, 4, 'lgrey')
    for x in range(8, 58, 5):
        a.rect(x, 16, 2, 10, 'lgrey')
    a.disc(32, 13, 8, 'water').disc(32, 13, 5, 'blue').disc(30, 11, 2, 'water')
    a.rect(28, 22, 8, 4, 'brown')
    # Two faculty buildings
    a.rect(4, 32, 20, 12, 'brown').rect(4, 32, 20, 3, 'red')
    for x in range(7, 22, 4):
        a.rect(x, 37, 2, 3, 'water')
    a.rect(40, 32, 20, 12, 'brown').rect(40, 32, 20, 3, 'red')
    for x in range(43, 58, 4):
        a.rect(x, 37, 2, 3, 'water')
    # Trees on the lawn
    for cx, cy in ((8, 55), (20, 58), (44, 56), (56, 54), (38, 60)):
        a.tree(cx, cy, 3)
    return a


def big_park():
    a = Art(3)
    # Winding paths
    a.rect(0, 22, 48, 3, 'brown').rect(22, 0, 3, 48, 'brown')
    # Pond
    a.disc(34, 34, 8, 'water').disc(36, 32, 3, 'white').disc(34, 34, 1, 'water')
    # Flower beds
    a.disc(10, 10, 5, 'dgreen')
    for i, (x, y) in enumerate(((8, 8), (11, 9), (9, 12), (12, 12), (7, 11))):
        a.pixel(x, y, ('red', 'yellow', 'white', 'orange', 'red')[i])
    # Trees
    for cx, cy in ((36, 8), (43, 13), (30, 5), (8, 34), (14, 42), (5, 43), (42, 44)):
        a.tree(cx, cy, 3)
    # Benches
    a.rect(14, 19, 4, 2, 'brown').rect(27, 27, 2, 4, 'brown')
    return a


def garden():
    a = Art(1)
    a.rect(0, 7, 16, 2, 'brown')
    for x in range(1, 15, 2):
        a.pixel(x, 2, 'dgreen').pixel(x + 1, 3, 'dgreen')
        a.pixel(x, 3, ('red', 'yellow', 'white', 'orange')[x % 4])
        a.pixel(x, 12, 'dgreen').pixel(x + 1, 13, 'dgreen')
        a.pixel(x, 12, ('yellow', 'red', 'orange', 'white')[x % 4])
    a.disc(3, 4, 2, 'dgreen').disc(13, 12, 2, 'dgreen')
    return a


def plaza():
    a = Art(1, 'lgrey')
    for i in range(0, 16, 4):
        a.rect(i, 0, 1, 16, 'grey').rect(0, i, 16, 1, 'grey')
    a.disc(8, 8, 5, 'grey').disc(8, 8, 4, 'water').disc(8, 8, 1.5, 'white')
    a.rect(1, 1, 3, 1, 'brown').rect(12, 14, 3, 1, 'brown')
    return a


def library():
    a = Art(2)
    # A stone hall with a row of columns and steps, under a grey roof
    a.rect(3, 3, 26, 18, 'white').rect(3, 3, 26, 5, 'lgrey').rect(3, 3, 26, 1, 'grey')
    for x in range(5, 28, 4):
        a.rect(x, 10, 2, 9, 'lgrey')
    a.rect(13, 14, 6, 7, 'brown')
    a.rect(2, 21, 28, 2, 'lgrey').rect(4, 23, 24, 2, 'grey')
    # A lawn, a reading bench and a tree
    a.rect(4, 27, 6, 2, 'brown')
    a.tree(26, 27, 3).tree(18, 28, 2)
    return a


def police_post():
    a = Art(2, 'lgrey')
    # A small blue station with a white band, and a car outside
    a.rect(2, 2, 22, 18, 'blue').rect(2, 2, 22, 3, 'dgrey').rect(2, 12, 22, 2, 'white')
    for x in range(5, 22, 5):
        a.rect(x, 7, 3, 3, 'water')
    a.rect(11, 15, 4, 5, 'dgrey')
    a.pixel(20, 4, 'red').pixel(21, 4, 'blue')
    a.rect(4, 24, 9, 5, 'white').rect(4, 24, 9, 1, 'dgrey').rect(6, 25, 5, 3, 'dgrey').rect(7, 24, 2, 1, 'blue')
    a.rect(26, 2, 4, 28, 'ground')
    a.tree(28, 8, 2).tree(28, 22, 2)
    return a


def fire_post():
    a = Art(2, 'lgrey')
    # A red fire house with two garage doors, and its tower for drying the hoses
    a.rect(2, 4, 20, 18, 'red').rect(2, 4, 20, 3, 'dgrey')
    a.rect(4, 12, 7, 10, 'dgrey').rect(13, 12, 7, 10, 'dgrey')
    for y in range(13, 22, 3):
        a.rect(4, y, 7, 1, 'grey').rect(13, y, 7, 1, 'grey')
    a.rect(23, 2, 7, 20, 'red').rect(23, 2, 7, 3, 'dgrey').rect(25, 8, 3, 3, 'water')
    a.rect(2, 22, 20, 2, 'white')
    a.rect(24, 26, 6, 4, 'dgrey').disc(27, 28, 1.5, 'red')
    return a


def statue():
    a = Art(1, 'lgrey')
    # A statue on its plinth, in the middle of a small paved square with flower beds in the corners
    a.frame(0, 0, 16, 16, 'grey')
    for x, y in ((1, 1), (12, 1), (1, 12), (12, 12)):
        a.rect(x, y, 3, 3, 'dgreen').pixel(x + 1, y + 1, 'red')
    a.rect(5, 9, 6, 4, 'grey').rect(5, 9, 6, 1, 'white')
    a.rect(7, 3, 2, 7, 'olive').disc(8, 3, 1.5, 'olive').rect(6, 5, 4, 1, 'olive')
    return a


def town_hall():
    a = Art(3, 'lgrey')
    # A grand hall with two wings, a clock tower and a flag, over a paved square
    a.rect(3, 4, 42, 22, 'white').rect(3, 4, 42, 4, 'red')
    for x in range(6, 43, 4):
        a.rect(x, 12, 2, 4, 'water').rect(x, 19, 2, 4, 'water')
    a.rect(18, 2, 12, 26, 'white').rect(18, 2, 12, 3, 'red')
    a.disc(24, 10, 4, 'lgrey').disc(24, 10, 3, 'white').line(24, 10, 24, 8, 'dgrey').line(24, 10, 26, 10, 'dgrey')
    a.rect(21, 20, 6, 8, 'brown')
    a.rect(16, 28, 16, 3, 'grey')
    # The square: paving, a fountain and lawns
    for x in range(0, 48, 6):
        a.rect(x, 33, 1, 15, 'grey')
    a.disc(24, 40, 5, 'grey').disc(24, 40, 4, 'water').disc(24, 40, 1.5, 'white')
    a.rect(3, 34, 12, 12, 'dgreen').rect(33, 34, 12, 12, 'dgreen')
    a.tree(9, 40, 3).tree(39, 40, 3)
    a.rect(44, 0, 1, 10, 'dgrey').rect(45, 0, 3, 3, 'blue')
    return a


def tower():
    a = Art(2, 'lgrey')
    # A tall tower seen from above: its round observation deck and antenna, its long shadow on the plaza
    a.frame(0, 0, 32, 32, 'grey')
    a.rect(16, 17, 14, 4, 'dgrey').rect(20, 21, 10, 3, 'dgrey')
    a.disc(15, 15, 10, 'white').disc(15, 15, 8, 'lgrey').disc(15, 15, 6, 'water').disc(15, 15, 3, 'white')
    a.rect(14, 14, 3, 3, 'red')
    for x, y in ((3, 28), (28, 3)):
        a.tree(x, y, 2)
    return a


def recycling():
    a = Art(3, 'lgrey')
    # The sorting hall, with a conveyor coming out of it
    a.rect(2, 2, 26, 20, 'grey').rect(2, 2, 26, 4, 'dgrey')
    for x in range(5, 27, 6):
        a.rect(x, 9, 3, 3, 'water')
    a.rect(10, 16, 8, 6, 'dgrey')
    a.rect(28, 10, 16, 3, 'dgrey').rect(28, 11, 16, 1, 'black')
    # Containers: paper, glass, plastic
    for i, name in enumerate(('blue', 'dgreen', 'yellow')):
        a.rect(31 + 5 * (i % 3), 2, 4, 6, name).rect(31 + 5 * (i % 3), 2, 4, 1, 'white')
    # Bales and heaps waiting to be sorted
    for x, y, name in ((4, 27, 'blue'), (10, 27, 'yellow'), (16, 27, 'blue'), (4, 33, 'yellow'), (10, 33, 'white')):
        a.rect(x, y, 5, 5, name).frame(x, y, 5, 5, 'dgrey')
    a.disc(34, 32, 8, 'brown').disc(33, 31, 5, 'olive').disc(31, 29, 2, 'yellow')
    a.frame(0, 0, 48, 48, 'grey')
    return a


def waterworks():
    a = Art(3)
    # Round settling tanks, and the pumping house
    for cx, cy in ((12, 12), (36, 12), (12, 36)):
        a.disc(cx, cy, 10, 'lgrey').disc(cx, cy, 8, 'water').disc(cx, cy, 2, 'lgrey').line(cx, cy, cx + 7, cy - 3, 'lgrey')
    a.rect(27, 28, 18, 16, 'white').rect(27, 28, 18, 3, 'blue')
    for x in range(30, 44, 4):
        a.rect(x, 34, 2, 3, 'water')
    a.rect(34, 40, 4, 4, 'brown')
    a.rect(22, 12, 4, 2, 'grey').rect(12, 22, 2, 4, 'grey').rect(22, 34, 5, 2, 'grey')
    return a


def bus_stop():
    a = Art(1)
    # A shelter on a strip of pavement, with its sign
    a.rect(0, 9, 16, 7, 'lgrey').rect(0, 15, 16, 1, 'grey')
    a.rect(3, 6, 9, 6, 'dgrey').rect(3, 6, 9, 1, 'water').rect(4, 7, 7, 4, 'water')
    a.rect(4, 11, 7, 1, 'brown')
    a.rect(13, 3, 1, 10, 'grey').rect(12, 2, 3, 3, 'yellow').pixel(13, 3, 'dgrey')
    return a


def bus_depot():
    a = Art(3, 'lgrey')
    # The garage, with its bays, and buses waiting in the yard
    a.rect(2, 2, 44, 18, 'grey').rect(2, 2, 44, 4, 'dgrey')
    for x in range(4, 44, 8):
        a.rect(x, 9, 6, 11, 'dgrey').rect(x, 9, 6, 1, 'yellow')
    for x in range(5, 44, 9):
        a.rect(x, 25, 6, 17, 'yellow').rect(x, 25, 6, 2, 'white').rect(x + 1, 28, 4, 1, 'water').rect(x + 1, 38, 4, 1, 'water')
    a.rect(0, 44, 48, 4, 'grey')
    return a


def dam():
    a = Art(3, 'water')
    # The reservoir above, the river below, and between them the concrete wall, its spillway and its power house
    a.rect(0, 20, 48, 9, 'lgrey').rect(0, 20, 48, 1, 'white').rect(0, 28, 48, 1, 'grey')
    for x in range(4, 46, 6):
        a.rect(x, 22, 1, 5, 'grey')
    a.rect(18, 29, 12, 8, 'white')
    for y in range(30, 37, 2):
        a.rect(18 + (y % 4), y, 8, 1, 'water')
    a.rect(4, 31, 10, 8, 'lgrey').rect(4, 31, 10, 2, 'dgrey').rect(6, 35, 2, 2, 'yellow')
    a.rect(34, 31, 10, 8, 'lgrey').rect(34, 31, 10, 2, 'dgrey').rect(40, 35, 2, 2, 'yellow')
    return a


# Tile numbers: keep in sync with src/tileValues.ts. Each entry: (first tile, size, drawing[, kind for remastering])
WIND = 1024
WIND_FRAMES = [1025, 1026, 1027]
GASBASE = 1028
SOLARBASE = 1037
SCHOOLBASE = 1046
UNIVERSITYBASE = 1055
BIGPARKBASE = 1071
GARDEN = 1080
PLAZA = 1081
LIBRARYBASE = 1082
POLICEPOSTBASE = 1086
FIREPOSTBASE = 1090
STATUE = 1094
TOWNHALLBASE = 1095
TOWERBASE = 1104
RECYCLINGBASE = 1108
WATERWORKSBASE = 1117
BUSSTOP = 1126
BUSDEPOTBASE = 1127
DAMBASE = 1136

BUILDINGS = [
    (WIND, 1, lambda: wind_turbine(0)),
    (WIND_FRAMES[0], 1, lambda: wind_turbine(1)),
    (WIND_FRAMES[1], 1, lambda: wind_turbine(2)),
    (WIND_FRAMES[2], 1, lambda: wind_turbine(3)),
    (GASBASE, 3, gas_plant),
    (SOLARBASE, 3, solar_farm),
    (SCHOOLBASE, 3, school),
    (UNIVERSITYBASE, 4, university),
    (BIGPARKBASE, 3, big_park),
    (GARDEN, 1, garden),
    (PLAZA, 1, plaza),
    (LIBRARYBASE, 2, library),
    (POLICEPOSTBASE, 2, police_post),
    (FIREPOSTBASE, 2, fire_post),
    (STATUE, 1, statue),
    (TOWNHALLBASE, 3, town_hall),
    (TOWERBASE, 2, tower),
    (RECYCLINGBASE, 3, recycling),
    (WATERWORKSBASE, 3, waterworks),
    (BUSSTOP, 1, bus_stop),
    (BUSDEPOTBASE, 3, bus_depot),
    (DAMBASE, 3, dam, 'port'),
]


def extend(tiles, season):
    """Returns the tile set with KawaCity's tiles added after the original ones (tiles: an image of 1024 tiles)"""
    original = np.array(tiles.convert('RGB'))
    width = original.shape[1]
    out = np.zeros((original.shape[0] * 2, width, 3), dtype=np.uint8)
    out[:original.shape[0]] = original

    tex = {'grass': g.make_grass(season), 'water': g.make_water(season), 'dirt': g.make_dirt(season)}
    # Unused tiles are plain grass
    for index in range(1024, 2048):
        g.put_tile(out, index, tex['grass'])

    for entry in BUILDINGS:
        base, size, draw = entry[:3]
        art = draw()
        # Water is a building's colour, but for a building on water (the dam), whose water stays water
        block = g.remaster(art.rgb(), art.names, season, tex, (0, 0), entry[3] if len(entry) > 3 else 'building')
        for i in range(size * size):
            g.put_tile(out, base + i, block[(i // size) * TS:(i // size + 1) * TS, (i % size) * TS:(i % size + 1) * TS])

    from PIL import Image
    return Image.fromarray(out, 'RGB')


def extend_lights(lights):
    """Adds the night lights of KawaCity's buildings to the lights atlas (laid out like the tile set). Returns the
    image and the extra lit tiles."""
    original = np.array(lights)
    out = np.zeros((original.shape[0] * 2, original.shape[1], 4), dtype=np.uint8)
    out[:original.shape[0]] = original
    lit = []

    for base, size, draw in (entry[:3] for entry in BUILDINGS):
        if base in (BIGPARKBASE, GARDEN, SOLARBASE) or base in WIND_FRAMES or base == WIND:
            continue
        names = draw().names
        for i in range(size * size):
            tile_names = names[(i // size) * TS:(i // size + 1) * TS, (i % size) * TS:(i % size + 1) * TS]
            tile = g.lights_for_building(tile_names, base + i)
            if tile[:, :, 3].any():
                g.put_tile(out, base + i, tile)
                lit.append(base + i)

    from PIL import Image
    return Image.fromarray(out, 'RGBA'), lit


# --- Kinds of road ----------------------------------------------------------------------------------------------------
#
# Dirt roads, avenues and highways use the same tiles as streets (so that they connect, cross rails and power lines,
# bridge water and carry traffic in the same way): their look is painted over the street, from an overlay that only
# covers the road surface (see images/tiles-roads.png and src/gameCanvas.js).

ROAD_STYLE_TILES = list(range(64, 207)) + [237, 238]
ROAD_STYLES = ['dirt', 'avenue', 'highway']


def road_shape(index):
    """The plain road tile that a tile with traffic (or not) is drawn from"""
    if 80 <= index <= 143:
        return 64 + (index - 80) % 16
    if 144 <= index <= 206:
        return 64 + (index - 144) % 16
    return index


def road_overlay(src, index, style):
    """The overlay that paints a road tile in another style. Cars on the road are left as they are."""
    base = g.names_of(g.get_tile(src, road_shape(index)))
    names = g.names_of(g.get_tile(src, index))
    surface = (base == 'dgrey') & (names == 'dgrey')
    marking = (base == 'white') & (names == 'white')
    road = (base == 'dgrey') | (base == 'white')

    # The edges of the road: surface next to anything else
    edge = np.zeros_like(surface)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        edge |= surface & ~g.neighbours(road, dx, dy)

    # Straight centre lines: fill the gaps between the dashes
    line = marking.copy()
    for y in range(TS):
        xs = np.nonzero(marking[y])[0]
        if len(xs) >= 2:
            line[y, xs[0]:xs[-1] + 1] |= surface[y, xs[0]:xs[-1] + 1]
    for x in range(TS):
        ys = np.nonzero(marking[:, x])[0]
        if len(ys) >= 2:
            line[ys[0]:ys[-1] + 1, x] |= surface[ys[0]:ys[-1] + 1, x]

    out = np.zeros((TS, TS, 4), dtype=np.uint8)

    def paint(mask, colour):
        out[mask] = colour + (255,)

    if style == 'dirt':
        for y, x in zip(*np.nonzero(surface | marking)):
            n = g.hash_noise(x, y, index * 3 + 1)
            out[y, x] = (138, 112, 80, 255) if n > 0.28 else (118, 94, 66, 255)
        # Tracks worn by the wheels, a little darker
        paint(edge, (104, 84, 60))
    elif style == 'avenue':
        paint(surface | marking, (54, 52, 68))
        paint(edge & ~line, (176, 176, 190))
        paint(line, (248, 200, 64))
    else:
        paint(surface | marking, (58, 66, 92))
        paint(marking, (238, 240, 232))
        paint(edge, (248, 200, 64))
    return out


def road_styles(source_path):
    """The overlays for each kind of road: one column per style, one row per road tile"""
    from PIL import Image
    src = np.array(Image.open(source_path).convert('RGBA'))[:, :, :3]
    atlas = np.zeros((len(ROAD_STYLE_TILES) * TS, len(ROAD_STYLES) * TS, 4), dtype=np.uint8)
    for row, index in enumerate(ROAD_STYLE_TILES):
        for col, style in enumerate(ROAD_STYLES):
            atlas[row * TS:(row + 1) * TS, col * TS:(col + 1) * TS] = road_overlay(src, index, style)
    return Image.fromarray(atlas, 'RGBA')
