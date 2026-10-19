#
# KawaCity: the icons of the tool bar, drawn in isometric pixel art (see iso.py): each tool shows what it builds, on
# a piece of land.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.

import math

from iso import (Box, Line, Solid, Sprite, cylinder, fit, gable, grass, mix, render, shade, slab, sphere, to_image,
                 transparent, walls, COM, DIRT, DIRT_DARK, GRASS, GRASS_DARK, GREY, GREY_DARK, GREY_LIGHT, IND, KERB,
                 OUTLINE, RED, RED_DARK, RES, ROAD, ROAD_LINE, SMOKE, SMOKE_PALETTE, TREE, TREE_PALETTE, WATER,
                 WATER_FOAM, WATER_LIGHT, WHITE, YELLOW)

SIZE = 32

# The land each icon stands on, in world units
N = 13
THICKNESS = 2

CONCRETE = (176, 174, 168)
CONCRETE_DARK = (150, 148, 144)
ASPHALT = ROAD
BRICK = (196, 98, 64)
BRICK_DARK = (150, 72, 48)
NAVY = (52, 74, 156)
NAVY_DARK = (36, 52, 116)

HOUSE_WALLS = walls(WHITE, (200, 196, 186), WHITE)
GLASS = walls((60, 104, 206), (38, 70, 156), (150, 160, 190), ((146, 192, 238), 2, 3), ((250, 210, 72), 5))
OFFICE = walls((236, 226, 196), (190, 178, 150), (210, 200, 176), ((70, 110, 200), 2, 3))
POLE = walls((140, 100, 60), (110, 76, 46), (150, 110, 70))

# Sprites
BLADES = ['....w....', '....w....', '....w....', '....h....', '...w.w...', '..w...w..', '.w.....w.']
BLADES_PALETTE = {'w': WHITE, 'h': GREY}
STEAM = ['..ss..', '.sSSs.', 'sSSSSs', '.ssss.']
# A cooling tower, broader than tall, narrowing towards its top, steaming
COOLING_TOWER = ['....ssSSs.....', '..sSSSSSSs....', '...sssSs......', '..rrrrrrrrrr..', '.rkkkkkkkkkkr.',
                 '..rrrrrrrrrr..', '..LLLLLMMMDD..', '...LLLLMMMD...', '...LLLLMMMD...', '..LLLLLMMMDD..',
                 '.LLLLLLMMMMDD.', 'LLLLLLLMMMMDDD', '.LLLLLLMMMMDD.']
COOLING_TOWER_PALETTE = {'s': (200, 204, 220), 'S': (232, 236, 255), 'r': (214, 216, 226), 'k': (60, 62, 74),
                         'L': (236, 238, 244), 'M': (196, 200, 212), 'D': (150, 154, 170)}
FLAG = ['rrrr', 'rrrr', 'rrr.']
FLAG_PALETTE = {'r': RED}
CROSS = ['.www.', 'wwrww', 'wrrrw', 'wwrww', '.www.']
CROSS_PALETTE = {'r': RED, 'w': WHITE}
LIGHTS = ['rrbb']
LIGHTS_PALETTE = {'r': (232, 70, 54), 'b': (92, 156, 255)}
JET = ['.b.', 'bwb', '.b.']
CAR = ['.kb.', 'wwww', 'kwwk']
CAR_PALETTE = {'k': (30, 26, 40), 'b': (92, 156, 255), 'w': WHITE}
JET_PALETTE = {'b': WATER_LIGHT, 'w': WATER_FOAM}
PLANE = ['...w...', 'wwwwwww', '...w...', '..www..']
PLANE_PALETTE = {'w': WHITE}
MAGNIFIER = ['...oooo......', '..oLLLLo.....', '.oLwwLLLo....', 'oLLwLLLLLo...', 'oLLLLLLLLo...', 'oLLLLLLLLo...',
             '.oLLLLLLo....', '..oLLLLo.....', '...oooohh....', '........hhh..', '.........hhh.', '..........hh.']
MAGNIFIER_PALETTE = {'o': GREY_DARK, 'L': (170, 210, 245), 'w': WHITE, 'h': (140, 100, 60)}


def land(top, thickness=THICKNESS, edge=GRASS_DARK):
    return Box(0, 0, -thickness, N, N, 0, slab(top, thickness, edge))


def tinted(colour, amount=0.22):
    return lambda x, y: mix(grass(x, y), colour, amount)


def tree(x, y):
    return Sprite(x, y, 0, TREE, TREE_PALETTE)


def house(x0, y0, x1, y1, wall_height, roof_height, along, roof=(RED, RED_DARK)):
    wall = (200, 196, 186) if along == 'x' else WHITE
    return [Box(x0, y0, 0, x1, y1, wall_height, HOUSE_WALLS),
            gable(x0, y0, x1, y1, wall_height, roof_height, roof, wall, along)]


# --- The icons ------------------------------------------------------------------------------------------------------

def residential():
    shapes = [land(tinted(RES))]
    shapes += house(1, 1, 6, 5, 2.5, 2.5, 'x')
    shapes += house(7, 6, 11, 11, 2.5, 2.5, 'y', ((230, 130, 60), (180, 96, 40)))
    shapes += house(1, 8, 5, 12, 2, 2, 'x', ((92, 120, 200), (64, 88, 160)))
    return shapes, [tree(10, 2.5), tree(12, 12)], []


def commercial():
    def paving(x, y):
        return mix(CONCRETE, COM, 0.25) if (x + y) % 4 else mix(CONCRETE_DARK, COM, 0.25)

    def shop(face, u, v):
        if face == 'top':
            return (220, 228, 250)
        if face == 'left' and v >= 2.2:
            return RED if int(u) % 2 == 0 else WHITE
        if face == 'left' and 0.5 <= v < 1.8 and int(u) % 3 != 0:
            return (250, 210, 72)
        return (92, 156, 255) if face == 'left' else (60, 116, 210)

    shapes = [land(paving), Box(1, 1, 0, 7, 7, 9, GLASS), Box(7.5, 1, 0, 11.5, 5, 6, OFFICE),
              Box(2, 8.5, 0, 9, 12, 3, shop)]
    return shapes, [tree(11.5, 11.5)], []


def industrial():
    def yard(x, y):
        return mix(DIRT, IND, 0.3) if (x * 3 + y) % 7 else DIRT_DARK

    shed = walls((240, 200, 70), (196, 156, 52), (150, 150, 168))
    shapes = [land(yard, edge=None), Box(1, 2, 0, 9, 11, 3.5, shed)]
    for x0 in (1, 3.7, 6.4):
        shapes.append(gable(x0, 2, x0 + 2.6, 11, 3.5, 2, ((170, 172, 186), (120, 122, 138)), (196, 156, 52), 'y'))
    shapes.append(cylinder(11, 4, 0, 8, 0.9, ((232, 92, 72), RED, RED_DARK), (60, 50, 50),
                           [(5.5, 6.5, (WHITE, (210, 206, 196), (170, 166, 160)))]))
    return shapes, [Sprite(12, 3.5, 9, SMOKE, SMOKE_PALETTE)], []


def roadway(kind):
    """Streets cross; a dirt road, an avenue or a highway runs straight"""
    def street(x, y):
        on_x, on_y = 5 <= y < 8, 5 <= x < 8
        if on_x or on_y:
            if on_x and not on_y and y == 6 and x % 3 < 2:
                return ROAD_LINE
            if on_y and not on_x and x == 6 and y % 3 < 2:
                return ROAD_LINE
            return ASPHALT
        if y in (4, 8) or x in (4, 8):
            return KERB
        return grass(x, y)

    def dirt(x, y):
        if 4 <= y < 9:
            return DIRT_DARK if y in (5, 7) and x % 4 else DIRT
        return grass(x, y)

    def avenue(x, y):
        if 3 <= y < 10:
            if y == 6:
                return GRASS_DARK
            if y in (4, 8) and x % 3 < 2:
                return WHITE
            return ASPHALT
        if y in (2, 10):
            return KERB
        return grass(x, y)

    if kind == 'street':
        return [land(street)], [tree(2, 2), tree(11, 11.5)], []
    if kind == 'dirt':
        return [land(dirt)], [tree(2, 2), tree(11, 11.5)], []
    if kind == 'avenue':
        return [land(avenue)], [tree(1.5, 1.5), tree(12, 12)], []

    # A highway, raised on pillars over the land
    def deck(face, u, v):
        if face == 'top':
            y = int(v)
            if y in (0, 5):
                return ROAD_LINE
            if y in (2, 3) and int(u) % 3 < 2 and y == 2:
                return WHITE
            return (60, 58, 72)
        return CONCRETE if face == 'left' else CONCRETE_DARK

    pillar = walls(CONCRETE, CONCRETE_DARK, CONCRETE)
    shapes = [land(grass), Box(3, 5, 0, 4.2, 7, 4, pillar), Box(9.5, 5, 0, 10.7, 7, 4, pillar),
              Box(0, 3.5, 4, N, 9.5, 5.2, deck)]
    return shapes, [tree(11, 12)], []


def rail():
    def track(x, y):
        if 4 <= y < 9:
            if y in (5, 7):
                return GREY_LIGHT
            return (120, 84, 54) if x % 2 == 0 else (150, 138, 120)
        return grass(x, y)

    return [land(track)], [tree(2, 2), tree(11.5, 11.5)], []


def port():
    def quay(x, y):
        if y >= 7:
            return WATER_LIGHT if (x * 2 + y) % 7 == 0 else WATER
        return CONCRETE if (x + y) % 3 else CONCRETE_DARK

    def container(colour):
        return walls(colour, shade(colour, 0.75), shade(colour, 1.15))

    crane = walls(YELLOW, (200, 160, 50), YELLOW)
    shapes = [land(quay, edge=None),
              Box(1, 1, 0, 4, 3, 1.5, container(RED)), Box(1, 3.3, 0, 4, 5.3, 1.5, container((60, 116, 210))),
              Box(1, 1, 1.5, 4, 3, 3, container((80, 170, 90))),
              Box(7, 2, 0, 7.8, 2.8, 8, crane), Box(7, 5.2, 0, 7.8, 6, 8, crane),
              Box(6.5, 1.5, 8, 8.3, 11, 9, crane)]
    return shapes, [], []


def airport():
    def tarmac(x, y):
        if 6 <= y < 11:
            if y == 8 and x % 3 < 2:
                return WHITE
            if x <= 1 and y in (6, 7, 9, 10):
                return WHITE
            return ASPHALT
        return CONCRETE

    hangar = walls((210, 210, 220), (170, 170, 184), (210, 210, 220))
    shapes = [land(tarmac, edge=None), Box(1, 1, 0, 7, 5, 3, hangar),
              gable(1, 1, 7, 5, 3, 2, ((200, 204, 214), (150, 154, 170)), (170, 170, 184), 'x')]
    return shapes, [Sprite(9.5, 8.5, 0.5, PLANE, PLANE_PALETTE)], []


def wire():
    # Two wires along the line of poles, light so that they show on the tool bar's dark buttons
    shapes = [land(grass), Box(2.4, 6, 0, 3.4, 7, 7.5, POLE), Box(9.4, 6, 0, 10.4, 7, 7.5, POLE),
              Box(2.4, 5, 7, 3.4, 8, 7.6, POLE), Box(9.4, 5, 7, 10.4, 8, 7.6, POLE)]
    lines = [Line((0, y, 7.6), (N, y, 7.6), (200, 204, 220)) for y in (5.3, 7.7)]
    return shapes, [], lines


def wind():
    mast = walls(WHITE, (200, 196, 186), WHITE)
    # Masts a unit wide, set so that their front edge does not fall between two pixels
    shapes = [land(grass), Box(2.4, 7, 0, 3.4, 8, 6, mast), Box(9, 2.4, 0, 10, 3.4, 7, mast)]
    sprites = [Sprite(2.9, 7.5, 6 + 3, BLADES, BLADES_PALETTE), Sprite(9.5, 2.9, 7 + 3, BLADES, BLADES_PALETTE)]
    return shapes, sprites, []


def solar():
    def panel(face, u, v):
        if face == 'top':
            return (150, 190, 240) if int(u) % 3 == 0 else (52, 80, 170)
        return GREY if face == 'left' else GREY_DARK

    shapes = [land(grass)]
    for y in (1.5, 5, 8.5):
        shapes.append(Box(1, y, 0.6, 12, y + 2.5, 1.2, panel))
    return shapes, [], []


def gas():
    def ground(x, y):
        return CONCRETE if (x + y) % 3 else CONCRETE_DARK

    plant = walls((210, 214, 224), (164, 168, 182), (180, 184, 196))
    tank = (WHITE, (214, 216, 222), (170, 174, 186))
    shapes = [land(ground, edge=None), Box(1, 1, 0, 6, 7, 4, plant),
              sphere(9.5, 3.5, 2.4, 2.2, tank), sphere(9.5, 9.5, 2.4, 2.2, tank),
              cylinder(3, 3, 4, 6.5, 0.7, (GREY_LIGHT, GREY, GREY_DARK), GREY_DARK)]
    return shapes, [], []


def coal():
    def yard(x, y):
        return DIRT if (x + 2 * y) % 5 else DIRT_DARK

    plant = walls(BRICK, BRICK_DARK, (120, 110, 110))
    stack = ((150, 150, 160), GREY, GREY_DARK)
    shapes = [land(yard, edge=None), Box(1, 2, 0, 8, 9, 5, plant),
              cylinder(3, 4, 5, 8, 0.8, stack, (50, 50, 60)), cylinder(6, 4, 5, 8, 0.8, stack, (50, 50, 60)),
              sphere(10.5, 10, 0, 2.4, ((70, 66, 76), (46, 44, 54), (30, 28, 38)), 0.55)]
    sprites = [Sprite(3.5, 3.5, 8.5, SMOKE, SMOKE_PALETTE), Sprite(6.5, 3.5, 9, SMOKE, SMOKE_PALETTE)]
    return shapes, sprites, []


def nuclear():
    def ground(x, y):
        return CONCRETE if (x + y) % 3 else grass(x, y)

    shapes = [land(ground), Box(8.5, 9, 0, 12.5, 12.5, 2, walls(WHITE, (200, 196, 186), GREY_LIGHT)),
              sphere(10.5, 10.7, 2, 1.6, ((236, 236, 244), (196, 200, 212), (156, 160, 176)))]
    return shapes, [Sprite(5, 5, 0, COOLING_TOWER, COOLING_TOWER_PALETTE)], []


def service(walls_paint, sprite=None):
    def ground(x, y):
        if y >= 10:
            return CONCRETE
        return grass(x, y)

    shapes = [land(ground), Box(2, 2, 0, 11, 9, 5, walls_paint)]
    return shapes, sprite or [], []


def police():
    def paint(face, u, v):
        if face == 'top':
            return GREY_LIGHT
        if 2.6 <= v < 3.4:
            return WHITE
        if face == 'left' and 0.8 <= v < 2.2 and int(u) % 3 == 1:
            return (146, 192, 238)
        return NAVY if face == 'left' else NAVY_DARK

    return service(paint, [Sprite(6.5, 5.5, 5, LIGHTS, LIGHTS_PALETTE), Sprite(9, 11.5, 0, CAR, CAR_PALETTE)])


def fire():
    def paint(face, u, v):
        if face == 'top':
            return GREY_LIGHT
        if face == 'left' and v < 3.4 and 1 <= u % 4.5 < 3.8:
            return (60, 56, 70) if v < 3 else WHITE
        if 3.8 <= v < 4.4:
            return WHITE
        return RED if face == 'left' else RED_DARK

    return service(paint)


def hospital():
    def paint(face, u, v):
        if face == 'top':
            return GREY_LIGHT
        if 0.8 <= v < 2.2 and int(u) % 3 == 1:
            return (146, 192, 238) if face == 'left' else (110, 150, 196)
        return WHITE if face == 'left' else (204, 204, 210)

    # A red cross on the roof
    return service(paint, [Sprite(7.5, 6.5, 5, CROSS, CROSS_PALETTE)])


def school():
    building = walls(BRICK, BRICK_DARK, BRICK, (WHITE, 2, 4))
    shapes = [land(tinted((240, 150, 70), 0.15)), Box(1, 2, 0, 9, 8, 3.5, building),
              gable(1, 2, 9, 8, 3.5, 2.5, ((120, 122, 138), (90, 92, 108)), BRICK_DARK, 'x')]
    lines = [Line((11, 3, 0), (11, 3, 10), GREY_LIGHT)]
    return shapes, [Sprite(12.5, 1.5, 10, FLAG, FLAG_PALETTE)], lines


def university():
    def stone(face, u, v):
        if face == 'top':
            return (210, 200, 176)
        if v >= 4.2:
            return (240, 232, 210) if face == 'left' else (200, 190, 166)
        if int(u * 2) % 3 == 0:
            return (250, 246, 230) if face == 'left' else (214, 206, 186)
        return (190, 178, 150) if face == 'left' else (160, 148, 124)

    shapes = [land(grass), Box(1, 2, 0, 12, 10, 5, stone),
              cylinder(6.5, 6, 5, 6.2, 2.4, ((236, 226, 196), (210, 200, 176), (180, 170, 146)), (210, 200, 176)),
              sphere(6.5, 6, 6.2, 2.2, ((120, 210, 180), (80, 170, 150), (50, 130, 120)))]
    return shapes, [], []


def library():
    def stone(face, u, v):
        if face == 'top':
            return (210, 200, 176)
        if v >= 3.6:
            return (240, 232, 210) if face == 'left' else (200, 190, 166)
        if int(u * 2) % 3 == 0:
            return (250, 246, 230) if face == 'left' else (214, 206, 186)
        return (176, 164, 138) if face == 'left' else (146, 134, 112)

    shapes = [land(grass), Box(2, 3, 0, 11, 10, 4.4, stone),
              gable(2, 3, 11, 10, 4.4, 2.4, ((120, 122, 138), (90, 92, 108)), (214, 206, 186), 'x')]
    return shapes, [], []


def compact(walls_paint, sprite=None):
    """A smaller building than service's, on a smaller lot: the compact stations"""
    def ground(x, y):
        if y >= 9 or x >= 9:
            return CONCRETE
        return grass(x, y)

    return [land(ground), Box(3, 3, 0, 9, 8, 4, walls_paint)], sprite or [], []


def police_post():
    def paint(face, u, v):
        if face == 'top':
            return GREY_LIGHT
        if 2.2 <= v < 2.9:
            return WHITE
        if face == 'left' and 0.8 <= v < 1.8 and int(u) % 3 == 1:
            return (146, 192, 238)
        return NAVY if face == 'left' else NAVY_DARK

    return compact(paint, [Sprite(5.5, 4.5, 4, LIGHTS, LIGHTS_PALETTE), Sprite(10.5, 10, 0, CAR, CAR_PALETTE)])


def fire_post():
    def paint(face, u, v):
        if face == 'top':
            return GREY_LIGHT
        if face == 'left' and v < 2.8 and 0.6 <= u % 3 < 2.4:
            return (60, 56, 70) if v < 2.4 else WHITE
        if 3.2 <= v < 3.7:
            return WHITE
        return RED if face == 'left' else RED_DARK

    return compact(paint)


def statue():
    def paving(x, y):
        return (226, 214, 186) if (x + y) % 2 else (196, 184, 158)

    figure = ['.b.', '.B.', 'bBb', 'bBb', '.B.', '.B.', 'B.B']
    plinth = Box(4.5, 4.5, 0, 8.5, 8.5, 2.5, walls((236, 230, 214), (206, 198, 182), (236, 230, 214)))
    return [land(paving, edge=None), plinth], [Sprite(6.5, 6.5, 2.5, figure, {'b': (214, 178, 92), 'B': (170, 134, 62)})], []


def town_hall():
    hall = walls((246, 240, 226), (206, 198, 182), (220, 214, 200), ((110, 160, 220), 2, 3))
    red = ((200, 80, 60), (160, 60, 44))
    shapes = [land(grass), Box(1, 2, 0, 12, 8, 5, hall), gable(1, 2, 12, 8, 5, 2, red, (206, 198, 182), 'x'),
              Box(5, 3, 0, 8, 6, 9, walls((246, 240, 226), (206, 198, 182), (220, 214, 200))),
              gable(5, 3, 8, 6, 9, 2.5, red, (206, 198, 182), 'x')]
    return shapes, [], []


def tower():
    steel = ((236, 238, 246), (196, 200, 214), (150, 154, 172))
    shapes = [land(grass), cylinder(6.5, 6.5, 0, 16, 1.2, steel, (210, 212, 222)),
              cylinder(6.5, 6.5, 13, 15, 2.6, steel, (220, 222, 232)), sphere(6.5, 6.5, 15, 2.6, steel),
              cylinder(6.5, 6.5, 16, 20, 0.4, steel, WHITE)]
    return shapes, [], []


def recycling():
    def yard(x, y):
        return CONCRETE if (x + y) % 2 else CONCRETE_DARK

    hall = walls((140, 150, 160), (110, 118, 128), (160, 168, 178), ((176, 214, 246), 3, 3))
    shapes = [land(yard), Box(1, 1, 0, 8, 7, 4.5, hall)]
    bins = [((52, 110, 210), (36, 80, 160)), ((58, 150, 70), (40, 110, 50)), ((236, 196, 60), (190, 150, 40))]
    for i, (light, dark_) in enumerate(bins):
        shapes.append(Box(9.5, 1.5 + 3.5 * i, 0, 12, 4 + 3.5 * i, 2, walls(light, dark_, mix(light, WHITE, 0.3))))
    return shapes, [], []


def waterworks():
    rim = ((226, 228, 236), (186, 190, 204), (146, 150, 168))
    shapes = [land(grass)]
    for cx, cy in ((3.5, 3.5), (9.5, 3.5), (3.5, 9.5)):
        shapes.append(cylinder(cx, cy, 0, 1.2, 2.8, rim, WATER))
    shapes.append(Box(7, 7, 0, 12, 12, 3.5, walls(WHITE, (204, 204, 210), (60, 110, 200), ((110, 160, 220), 2, 2))))
    return shapes, [], []


def park():
    def path(x, y):
        return (214, 196, 150) if abs(x - y) <= 1 else grass(x, y)

    return [land(path)], [tree(3, 9), tree(9, 3), tree(10.5, 10), tree(2.5, 2.5)], []


def garden():
    flowers = [(240, 120, 170), (250, 210, 72), (232, 70, 54), (250, 246, 230)]

    def beds(x, y):
        if x in (0, N - 1) or y in (0, N - 1):
            return GRASS_DARK
        if x % 3 == 1 and y % 2 == 1:
            return flowers[(x + y) // 2 % 4]
        if x % 3 == 1:
            return (58, 130, 56)
        return grass(x, y)

    return [land(beds)], [], []


def plaza():
    def paving(x, y):
        return (226, 214, 186) if (x + y) % 2 else (196, 184, 158)

    basin = cylinder(6.5, 6.5, 0, 1.4, 3.2, (GREY_LIGHT, GREY, GREY_DARK), WATER)
    water = cylinder(6.5, 6.5, 0, 1.2, 2.6, (WATER, WATER, WATER), WATER_LIGHT)
    return [land(paving, edge=None), basin, water], [Sprite(6.5, 6.5, 1.3, JET, JET_PALETTE)], []


def bigpark():
    def pond(x, y):
        if (x - 8.5) ** 2 / 9 + (y - 8) ** 2 / 6 <= 1:
            return WATER_LIGHT if (x + y) % 5 == 0 else WATER
        return grass(x, y)

    return [land(pond)], [tree(2.5, 2.5), tree(3, 8), tree(8, 2.5), tree(12, 4), tree(4.5, 12)], []


def stadium():
    cx, cy, rx, ry = 6.5, 6.5, 6, 5

    def ellipse(x, y):
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2

    def stands_inside(x, y, z):
        e = ellipse(x, y)
        return 0.45 <= e <= 1 and z <= 1 + 2.5 * (e - 0.45) / 0.55

    def stands_paint(x, y, z):
        e = ellipse(x, y)
        if e > 0.92:
            return (200, 204, 214) if y > cy else (160, 164, 180)
        return (92, 156, 255) if int((e - 0.45) * 12) % 2 == 0 else (60, 116, 210)

    def pitch(x, y):
        if ellipse(x, y) < 0.45:
            return WHITE if x == 6 or abs(ellipse(x, y) - 0.2) < 0.03 else (80, 170, 70)
        return grass(x, y)

    stands = Solid(cx - rx, cy - ry, 0, cx + rx, cy + ry, 3.5, stands_inside, stands_paint)
    return [land(pitch), stands], [], []


def trees():
    return [land(grass)], [tree(x, y) for x, y in ((3, 3), (8, 2.5), (2.5, 8.5), (7, 7), (11.5, 6.5), (6.5, 11.5),
                                                   (11.5, 11.5))], []


def water():
    def waves(x, y):
        if x == 0 or y == 0:
            return WATER_FOAM
        return WATER_LIGHT if (x * 2 + y * 3) % 7 == 0 else WATER

    return [land(waves, edge=None)], [], []


def landfill():
    def half(x, y):
        if x + y > 13:
            return WATER_LIGHT if (x + y) % 5 == 0 else WATER
        return DIRT if (x * 3 + y) % 5 else DIRT_DARK

    mound = sphere(4.5, 4.5, 0, 3.6, ((180, 146, 100), DIRT, DIRT_DARK), 0.6)
    return [land(half, edge=None), mound], [], []


def bulldozer(size):
    # The land it clears grows with its size, edged in the colour of its preview on the map
    half = 1.5 + (size - 1) / 6.0 * 5
    lo, hi = int(round(8 - half)), int(round(8 + half)) - 1

    def cleared(x, y):
        if lo <= x <= hi and lo <= y <= hi:
            if x in (lo, hi) or y in (lo, hi):
                return (251, 113, 133)
            return DIRT
        return grass(x, y)

    body = walls(YELLOW, (200, 160, 50), (255, 228, 120))
    cab = walls((146, 192, 238), (110, 150, 200), YELLOW)
    track = walls((60, 56, 70), (44, 40, 54), (80, 76, 90))
    blade = walls(GREY_LIGHT, GREY, GREY_LIGHT)
    shapes = [land(cleared), Box(1.5, 1.5, 0, 6.5, 2.6, 1.2, track), Box(1.5, 5.4, 0, 6.5, 6.5, 1.2, track),
              Box(2, 2.6, 0.5, 6, 5.4, 2.6, body), Box(2.4, 3, 2.6, 4.6, 5, 4.6, cab),
              Box(6.8, 1, 0, 7.4, 7, 2.2, blade)]
    return shapes, [], []


def query():
    shapes = [land(grass)] + house(2, 2, 7, 6, 2.5, 2.5, 'x')
    return shapes, [tree(10, 3), Sprite(11.5, 11.5, 3, MAGNIFIER, MAGNIFIER_PALETTE)], []


# Each tool, and its icon
ICONS = [
    ('query', query),
    ('bulldozer', lambda: bulldozer(1)),
    ('bulldozer3', lambda: bulldozer(3)),
    ('bulldozer5', lambda: bulldozer(5)),
    ('bulldozer7', lambda: bulldozer(7)),
    ('residential', residential),
    ('commercial', commercial),
    ('industrial', industrial),
    ('road', lambda: roadway('street')),
    ('dirtroad', lambda: roadway('dirt')),
    ('avenue', lambda: roadway('avenue')),
    ('highway', lambda: roadway('highway')),
    ('rail', rail),
    ('port', port),
    ('airport', airport),
    ('wire', wire),
    ('wind', wind),
    ('solar', solar),
    ('gas', gas),
    ('coal', coal),
    ('nuclear', nuclear),
    ('police', police),
    ('fire', fire),
    ('school', school),
    ('university', university),
    ('park', park),
    ('garden', garden),
    ('plaza', plaza),
    ('bigpark', bigpark),
    ('stadium', stadium),
    ('trees', trees),
    ('water', water),
    ('landfill', landfill),
    ('hospital', hospital),
    ('library', library),
    ('policepost', police_post),
    ('firepost', fire_post),
    ('statue', statue),
    ('townhall', town_hall),
    ('tower', tower),
    ('recycling', recycling),
    ('waterworks', waterworks),
]


def draw(builder):
    shapes, sprites, lines = builder()
    origin = fit(shapes, sprites, SIZE, SIZE)
    return to_image(render(SIZE, SIZE, shapes, sprites, origin, transparent, lines))
