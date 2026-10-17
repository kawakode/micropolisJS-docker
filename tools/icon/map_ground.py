#
# KawaCity: the ground of the isometric map: a diamond for each tile, 32 pixels wide and 16 high, in the style of the
# game's icons: grass, water with its shores, the four kinds of road, bridges, railways, the lots of the zones...
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.
#
# A tile is 16 world units square (see iso.py): a point (X, Y) of a tile is drawn at sx = X - Y, sy = (X + Y) / 2 from
# the tile's top corner. Each diamond is drawn with a pixel of bleed all round, so that no gap shows between tiles
# when the map is enlarged by a fraction.

from PIL import Image

from iso import mix, shade, DIRT, DIRT_DARK, GRASS, GRASS_DARK, GRASS_LIGHT, GREY_LIGHT, KERB, ROAD, ROAD_LINE, WHITE

T = 16
CELL_W = 2 * T + 2
CELL_H = T + 2

WATER = [(44, 100, 184), (36, 86, 166), (82, 140, 214), (146, 192, 238)]
SAND = (196, 190, 150)
WET_SAND = (160, 156, 120)
FOAM = (198, 224, 242)

# The sides of a tile, as bits of a mask: north (-Y), east (+X), south (+Y), west (-X)
N, E, S, W = 1, 2, 4, 8

ROAD_CLASSES = ['street', 'dirt', 'avenue', 'highway']


def diamond(paint):
    """A diamond, its top surface painted by paint(X, Y, i, j): (X, Y) the point of the tile, (i, j) the pixel of the
    diamond (for patterns that must line up from one tile to the next on the screen)"""
    image = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    pixels = image.load()
    for j in range(CELL_H):
        for i in range(CELL_W):
            px = i + 0.5 - (T + 1)
            py = j + 0.5 - 1
            x = py + px / 2
            y = py - px / 2
            if 0 <= x < T and 0 <= y < T:
                pixels[i, j] = tuple(paint(x, y, i - 1, j - 1)) + (255,)

    # The bleed: each empty pixel next to the diamond takes its neighbour's colour
    bled = image.copy()
    out = bled.load()
    for j in range(CELL_H):
        for i in range(CELL_W):
            if pixels[i, j][3]:
                continue
            for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                a, b = i + di, j + dj
                if 0 <= a < CELL_W and 0 <= b < CELL_H and pixels[a, b][3]:
                    out[i, j] = pixels[a, b]
                    break
    return bled


def noise(x, y, seed):
    """A pseudo-random number for the unit (x, y) of a tile, without the stripes of simple hashes"""
    h = (int(x) * 374761393 + int(y) * 668265263 + seed * 2147483647) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return h ^ (h >> 16)


def speckle(x, y, seed, base, light, dark, rate=23):
    h = noise(x, y, seed) % rate
    if h == 0:
        return light
    if h == 1:
        return dark
    return base


# --- Terrain --------------------------------------------------------------------------------------------------------

def grass(seed):
    return diamond(lambda x, y, i, j: speckle(x, y, seed, GRASS, GRASS_LIGHT, GRASS_DARK))


def dirt(seed=0):
    return diamond(lambda x, y, i, j: speckle(x, y, seed, DIRT, (180, 146, 100), DIRT_DARK, 11))


def water_colour(i, j, frame):
    """Water, with ripples drifting along: horizontal dashes on the screen, lined up from one tile to the next"""
    if (i + 4 * frame) % 16 < 3 and j % 8 == 4:
        return WATER[2]
    if (i + 8 + 4 * frame) % 16 < 2 and j % 8 == 0:
        return WATER[3] if frame % 2 else WATER[2]
    return WATER[0] if (i // 4 + j // 2) % 5 else WATER[1]


def water(land, frame):
    """Water: land is the mask of the sides with land beyond, where a beach and foam line the shore"""
    def paint(x, y, i, j):
        d = 99
        if land & N:
            d = min(d, y)
        if land & S:
            d = min(d, T - y)
        if land & W:
            d = min(d, x)
        if land & E:
            d = min(d, T - x)
        if d < 2:
            return SAND if d < 1.2 else WET_SAND
        if d < 3:
            return FOAM if (i + j + frame) % 3 else WATER[2]
        return water_colour(i, j, frame)
    return diamond(paint)


def rubble(seed):
    def paint(x, y, i, j):
        h = noise(x, y, seed + 40) % 9
        if h == 0:
            return (130, 130, 148)
        if h == 1:
            return (90, 86, 100)
        if h == 2:
            return (176, 140, 96)
        return DIRT_DARK if (int(x) + int(y)) % 3 == 0 else DIRT
    return diamond(paint)


def flood(frame):
    def paint(x, y, i, j):
        if (int(x) * 3 + int(y) * 7 + frame) % 13 == 0:
            return (120, 96, 70)
        if (i + 3 * frame) % 12 < 2 and j % 6 == 3:
            return (150, 170, 180)
        return (92, 112, 128) if (i // 3 + j) % 4 else (80, 98, 112)
    return diamond(paint)


def radiation():
    def paint(x, y, i, j):
        r = ((x - 8) ** 2 + (y - 8) ** 2) ** 0.5
        if 4 < r < 6 and int((x + y) / 2) % 2 == 0:
            return (240, 200, 40)
        return speckle(x, y, 3, (110, 120, 60), (170, 180, 60), (80, 86, 44), 7)
    return diamond(paint)


def scorched():
    return diamond(lambda x, y, i, j: speckle(x, y, 5, (60, 46, 40), (200, 80, 40), (40, 30, 28), 9))


# --- Roads and railways ---------------------------------------------------------------------------------------------

def arms(mask, x, y, half):
    """Whether (x, y) is on the road: its centre, and an arm to each side of the mask"""
    cx = abs(x - T / 2) <= half
    cy = abs(y - T / 2) <= half
    if cx and cy:
        return True
    if cx and ((mask & N and y < T / 2) or (mask & S and y > T / 2)):
        return True
    if cy and ((mask & W and x < T / 2) or (mask & E and x > T / 2)):
        return True
    return False


def road_paint(mask, kind, under):
    """The road's surface, its kerbs and its markings; under(x, y, i, j) is what lies beside it"""
    half = {'dirt': 3, 'street': 4, 'avenue': 6, 'highway': 7}[kind]

    def paint(x, y, i, j):
        if not arms(mask, x, y, half):
            if kind in ('street', 'avenue') and arms(mask, x, y, half + 1):
                return KERB
            if kind == 'highway' and arms(mask, x, y, half + 1):
                return (150, 148, 144)
            return under(x, y, i, j)

        if kind == 'dirt':
            ruts = (abs(x - T / 2) in (1.5,) or int(abs(x - T / 2)) == 1) if (mask & (N | S)) and not (mask & (E | W)) \
                else int(abs(y - T / 2)) == 1
            return DIRT_DARK if ruts and int(x + y) % 4 else DIRT

        # Markings along the arms, none where roads cross
        along_x = abs(y - T / 2) <= half and not abs(x - T / 2) <= half
        along_y = abs(x - T / 2) <= half and not abs(y - T / 2) <= half
        straight = mask in (E | W, N | S)
        surface = (60, 58, 72) if kind == 'highway' else ROAD
        if kind == 'street':
            if (along_x or (straight and mask == E | W)) and abs(y - T / 2) < 0.5 and int(x) % 4 < 2:
                return ROAD_LINE
            if (along_y or (straight and mask == N | S)) and abs(x - T / 2) < 0.5 and int(y) % 4 < 2:
                return ROAD_LINE
        elif kind == 'avenue':
            if along_x or (straight and mask == E | W):
                if abs(y - T / 2) < 0.6:
                    return GRASS_DARK
                if abs(abs(y - T / 2) - 3) < 0.5 and int(x) % 4 < 2:
                    return WHITE
            if along_y or (straight and mask == N | S):
                if abs(x - T / 2) < 0.6:
                    return GRASS_DARK
                if abs(abs(x - T / 2) - 3) < 0.5 and int(y) % 4 < 2:
                    return WHITE
        else:
            if along_x or (straight and mask == E | W):
                if abs(abs(y - T / 2) - (half - 0.5)) < 0.5:
                    return ROAD_LINE
                if abs(y - T / 2) < 0.5:
                    return GREY_LIGHT
                if abs(abs(y - T / 2) - 3.5) < 0.5 and int(x) % 4 < 2:
                    return WHITE
            if along_y or (straight and mask == N | S):
                if abs(abs(x - T / 2) - (half - 0.5)) < 0.5:
                    return ROAD_LINE
                if abs(x - T / 2) < 0.5:
                    return GREY_LIGHT
                if abs(abs(x - T / 2) - 3.5) < 0.5 and int(y) % 4 < 2:
                    return WHITE
        return surface

    return paint


def grass_under(x, y, i, j):
    return speckle(x, y, 1, GRASS, GRASS_LIGHT, GRASS_DARK)


def road(mask, kind):
    return diamond(road_paint(mask, kind, grass_under))


def bridge(axis, kind, frame=0):
    """A road over water, along X (axis 'x') or Y, with railings"""
    mask = E | W if axis == 'x' else N | S
    half = {'dirt': 3, 'street': 4, 'avenue': 6, 'highway': 7}[kind]
    deck = road_paint(mask, kind, lambda x, y, i, j: water_colour(i, j, frame))

    def paint(x, y, i, j):
        across = y if axis == 'x' else x
        if abs(across - T / 2) <= half + 1 and abs(across - T / 2) > half:
            return GREY_LIGHT
        if half + 1 < across - T / 2 <= half + 2.5:
            return shade(WATER[1], 0.8)
        return deck(x, y, i, j)

    return diamond(paint)


def rail_paint(mask, under):
    def paint(x, y, i, j):
        if not arms(mask, x, y, 4):
            return under(x, y, i, j)
        on_x = abs(y - T / 2) <= 4 and (mask & (E | W) or not mask & (N | S))
        on_y = abs(x - T / 2) <= 4 and mask & (N | S)
        for along, across, present in ((x, y, on_x), (y, x, on_y)):
            if not present:
                continue
            if abs(abs(across - T / 2) - 2) < 0.6:
                return GREY_LIGHT
            if int(along) % 3 == 0 and abs(across - T / 2) < 3.5:
                return (120, 84, 54)
        return (150, 138, 120) if (int(x) + int(y)) % 3 else (130, 120, 104)
    return paint


def rail(mask):
    return diamond(rail_paint(mask, grass_under))


def rail_bridge(axis, frame=0):
    mask = E | W if axis == 'x' else N | S
    return diamond(rail_paint(mask, lambda x, y, i, j: water_colour(i, j, frame)))


def rail_crossing(rail_axis):
    """A railway across a street: the rails over the road, between white stripes"""
    road_mask = N | S if rail_axis == 'x' else E | W
    rail_mask = E | W if rail_axis == 'x' else N | S
    street = road_paint(road_mask, 'street', grass_under)
    track = rail_paint(rail_mask, street)

    def paint(x, y, i, j):
        across = y if rail_axis == 'x' else x
        if abs(abs(across - T / 2) - 5) < 0.6 and arms(road_mask, x, y, 4):
            return WHITE if int(x + y) % 2 else (40, 40, 50)
        return track(x, y, i, j)

    return diamond(paint)


# --- Lots -----------------------------------------------------------------------------------------------------------

LOTS = {
    'lawn': lambda x, y: speckle(x, y, 2, (110, 178, 84), (134, 196, 100), (84, 150, 64)),
    'pavement': lambda x, y: (196, 192, 184) if (int(x) // 2 + int(y) // 2) % 2 else (176, 172, 166),
    'concrete': lambda x, y: speckle(x, y, 4, (170, 166, 156), (190, 186, 176), (140, 136, 128), 13),
    'tarmac': lambda x, y: speckle(x, y, 6, (100, 98, 110), (120, 118, 130), (84, 82, 94), 17),
}

ZONE_TINTS = {'residential': (110, 196, 92), 'commercial': (92, 156, 255), 'industrial': (240, 200, 70)}
ZONE_LOTS = {'residential': 'lawn', 'commercial': 'pavement', 'industrial': 'concrete'}


def lot(kind):
    return diamond(lambda x, y, i, j: LOTS[kind](x, y))


def zone(kind, column, row):
    """A tile of an empty zone, at (column, row) in it: the lot, tinted with the zone's colour, and edged in it"""
    tint = ZONE_TINTS[kind]
    base = LOTS[ZONE_LOTS[kind]]

    def paint(x, y, i, j):
        edge = (column == 0 and x < 1.5) or (column == 2 and x > T - 1.5) or (row == 0 and y < 1.5) or \
               (row == 2 and y > T - 1.5)
        if edge:
            return shade(tint, 0.8) if int(x + y) % 3 else tint
        return mix(base(x, y), tint, 0.35)

    return diamond(paint)


# --- The cells, and their places ------------------------------------------------------------------------------------

def cells():
    """Every cell of the ground, in order: [(name, image)]. Names: grass0-3, dirt, water<mask>_<frame>,
    road_<kind>_<mask>, bridge_<kind>_<axis>, rail<mask>, railbridge_<axis>, crossing_<axis>, rubble0-3, flood0-1,
    radiation, scorched, lot_<kind>, zone_<kind>_<column><row>"""
    out = []
    for seed in range(4):
        out.append(('grass%d' % seed, grass(seed)))
    out.append(('dirt', dirt()))
    for land in range(16):
        for frame in range(4):
            out.append(('water%d_%d' % (land, frame), water(land, frame)))
    for kind in ROAD_CLASSES:
        for mask in range(16):
            out.append(('road_%s_%d' % (kind, mask), road(mask, kind)))
        for axis in 'xy':
            out.append(('bridge_%s_%s' % (kind, axis), bridge(axis, kind)))
    for mask in range(16):
        out.append(('rail%d' % mask, rail(mask)))
    for axis in 'xy':
        out.append(('railbridge_%s' % axis, rail_bridge(axis)))
        out.append(('crossing_%s' % axis, rail_crossing(axis)))
    for seed in range(4):
        out.append(('rubble%d' % seed, rubble(seed)))
    for frame in range(2):
        out.append(('flood%d' % frame, flood(frame)))
    out.append(('radiation', radiation()))
    out.append(('scorched', scorched()))
    for kind in LOTS:
        out.append(('lot_%s' % kind, lot(kind)))
    for kind in ZONE_TINTS:
        for row in range(3):
            for column in range(3):
                out.append(('zone_%s_%d%d' % (kind, column, row), zone(kind, column, row)))
    return out
