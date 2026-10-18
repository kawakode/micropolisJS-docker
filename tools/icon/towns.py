#
# KawaCity: the neighbouring cities, as small floating islands that grow with them: a village, a town, a city and a
# metropolis (see the Neighbours window).
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.

from iso import (Box, Sprite, fit, gable, grass, render, slab, to_image, transparent, walls, DIRT, KERB, RED, RED_DARK,
                 ROAD, ROAD_LINE, TREE, TREE_PALETTE, WHITE)

SIZE = 32
N = 13

HOUSE_WALLS = walls(WHITE, (200, 196, 186), WHITE)
GLASS = walls((60, 104, 206), (38, 70, 156), (150, 160, 190), ((146, 192, 238), 2, 3), ((250, 210, 72), 5))
OFFICE = walls((236, 226, 196), (190, 178, 150), (210, 200, 176), ((70, 110, 200), 2, 3))
TOWER = walls((150, 120, 190), (112, 88, 150), (180, 170, 200), ((250, 210, 72), 3, 3))
SHOP = walls((92, 156, 255), (60, 116, 210), (220, 228, 250))


def ground(road_kind):
    """Grass, with a road along X: a dirt track for a village, a street with a dashed line for the others"""
    def top(x, y):
        if 6 <= y < 8:
            if road_kind == 'dirt':
                return DIRT
            return ROAD_LINE if y == 6 and x % 3 == 0 else ROAD
        if road_kind == 'street' and y in (5, 8):
            return KERB
        return grass(x, y)
    return Box(0, 0, -3, N, N, 0, slab(top, 3))


def house(x0, y0, x1, y1, along='x', roof=(RED, RED_DARK)):
    wall = (200, 196, 186) if along == 'x' else WHITE
    return [Box(x0, y0, 0, x1, y1, 2, HOUSE_WALLS), gable(x0, y0, x1, y1, 2, 2, roof, wall, along)]


def tree(x, y):
    return Sprite(x, y, 0, TREE, TREE_PALETTE)


def village():
    shapes = [ground('dirt')] + house(1.5, 1.5, 5.5, 5)
    shapes += house(8.5, 9, 12, 12.5, 'y', ((230, 130, 60), (180, 96, 40)))
    return shapes, [tree(10, 2.5), tree(3, 11), tree(12, 5)]


def town():
    shapes = [ground('street')] + house(1, 1, 4.5, 4.5)
    shapes += house(5, 1.5, 8.5, 4.5, 'y', ((92, 120, 200), (64, 88, 160)))
    shapes += house(1.5, 9, 5, 12.5, 'x', ((230, 130, 60), (180, 96, 40)))
    shapes += [Box(8.5, 9, 0, 12.5, 12.5, 3.5, SHOP)]
    return shapes, [tree(11.5, 3)]


def city():
    shapes = [ground('street'), Box(1, 1, 0, 5, 5, 8, GLASS), Box(6, 1.5, 0, 9.5, 4.5, 5, OFFICE),
              Box(8.5, 9, 0, 12.5, 12.5, 4, SHOP)]
    shapes += house(1.5, 9, 5, 12.5, 'x')
    return shapes, [tree(11.5, 3)]


def metropolis():
    shapes = [ground('street'), Box(1, 1, 0, 4.5, 5, 13, GLASS), Box(4.5, 1, 0, 7.5, 3.5, 9, TOWER),
              Box(8, 1, 0, 12, 4.5, 11, OFFICE), Box(1, 9, 0, 5, 12.5, 7, OFFICE),
              Box(8, 9, 0, 12.5, 12.5, 9, GLASS)]
    return shapes, []


TOWNS = [('village', village), ('town', town), ('city', city), ('metropolis', metropolis)]


def draw(builder):
    shapes, sprites = builder()
    return to_image(render(SIZE, SIZE, shapes, sprites, fit(shapes, sprites, SIZE, SIZE), transparent))
