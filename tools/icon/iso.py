#
# KawaCity: an isometric renderer for pixel art, shared by the icons and the pictures of the interface.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.
#
# World coordinates: X runs to the bottom right of the screen, Y to the bottom left, Z up. A point is drawn at
# sx = X - Y, sy = (X + Y) / 2 - Z, and is nearer the viewer the larger X + Y + Z. A scene is made of boxes, of solids
# of any shape (roofs, tanks, domes...), of small hand-drawn sprites standing at points of the world, and of lines
# (wires). Each pixel shows the nearest surface it sees, so that edges are clean 2:1 isometric lines; the picture is
# then outlined, as sprites of the 16-bit era were.

import math

from PIL import Image


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
DIRT = (156, 124, 86)
DIRT_DARK = (124, 96, 66)
ROAD = (70, 66, 84)
ROAD_LINE = (250, 210, 72)
KERB = (188, 188, 200)
WATER = (44, 100, 184)
WATER_LIGHT = (110, 160, 230)
WATER_FOAM = (198, 224, 242)
WHITE = (246, 244, 232)
GREY_LIGHT = (188, 188, 200)
GREY = (130, 130, 148)
GREY_DARK = (70, 66, 84)
RED = (214, 66, 52)
RED_DARK = (168, 48, 40)
YELLOW = (250, 210, 72)

RES = (110, 196, 92)
COM = (92, 156, 255)
IND = (240, 200, 70)


def shade(colour, factor):
    return tuple(max(0, min(255, int(round(c * factor)))) for c in colour)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


# --- Shapes ---------------------------------------------------------------------------------------------------------

class Box:
    """A box from (x0, y0, z0) to (x1, y1, z1). paint(face, u, v) gives the colour of a point of a face ('top',
    'left' facing +Y, 'right' facing +X), where u runs along the face and v up it (or along Y on the top)."""

    def __init__(self, x0, y0, z0, x1, y1, z1, paint, flat=False):
        self.x0, self.y0, self.z0, self.x1, self.y1, self.z1 = x0, y0, z0, x1, y1, z1
        self.paint = paint
        # A flat shape (markings on the ground) is not outlined
        self.flat = flat
        # Its extent on the screen
        self.left, self.right = x0 - y1, x1 - y0
        self.top, self.bottom = (x0 + y0) / 2.0 - z1, (x1 + y1) / 2.0 - z0

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

    def colour(self, hit):
        return self.paint(hit[1], hit[2], hit[3])


class Solid:
    """A shape given by inside(X, Y, Z), within the box (x0, y0, z0)-(x1, y1, z1). paint(X, Y, Z) gives the colour of
    the point of its surface seen. Each pixel's line of sight is followed from the top of the box down, in small
    steps, to the first point inside."""

    STEP = 0.2

    def __init__(self, x0, y0, z0, x1, y1, z1, inside, paint):
        self.x0, self.y0, self.z0, self.x1, self.y1, self.z1 = x0, y0, z0, x1, y1, z1
        self.inside = inside
        self.paint = paint
        self.flat = False
        corners = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        self.left = min(x - y for x, y, z in corners)
        self.right = max(x - y for x, y, z in corners)
        self.top = min((x + y) / 2 - z for x, y, z in corners)
        self.bottom = max((x + y) / 2 - z for x, y, z in corners)

    def hit(self, px, py):
        if not (self.left <= px <= self.right and self.top <= py <= self.bottom):
            return None

        # Along the line of sight, X = a + t, Y = b + t, Z = t
        a = py + px / 2
        b = py - px / 2
        t = self.z1
        while t >= self.z0 - 1e-9:
            x, y = a + t, b + t
            if self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1 and self.inside(x, y, t):
                # Find the surface more closely, between this step and the last
                lo, hi = t, t + self.STEP
                for _ in range(6):
                    mid = (lo + hi) / 2
                    if self.x0 <= a + mid <= self.x1 and self.y0 <= b + mid <= self.y1 and \
                            mid <= self.z1 and self.inside(a + mid, b + mid, mid):
                        lo = mid
                    else:
                        hi = mid
                return (a + b + 3 * lo, 'solid', a + lo, b + lo, lo)
            t -= self.STEP
        return None

    def colour(self, hit):
        return self.paint(hit[2], hit[3], hit[4])


def lit(light, mid, dark, brightness):
    """One of three tones, as pixel art shades round shapes: brightness from 0 (dark) to 1 (light)"""
    if brightness > 0.62:
        return light
    if brightness > 0.3:
        return mid
    return dark


def cylinder(cx, cy, z0, z1, radius, side, top, bands=None):
    """An upright cylinder (radius can be a function of the height, for cooling towers). side: (light, mid, dark);
    bands: [(z from, z to, (light, mid, dark))] painted around it"""
    r = radius if callable(radius) else (lambda z: radius)
    widest = max(r(z0 + (z1 - z0) * i / 8.0) for i in range(9))

    def inside(x, y, z):
        return (x - cx) ** 2 + (y - cy) ** 2 <= r(z) ** 2

    def paint(x, y, z):
        if z >= z1 - 0.3:
            return top
        tones = side
        for b0, b1, colours in bands or []:
            if b0 <= z < b1:
                tones = colours
        angle = math.atan2(y - cy, x - cx)
        # Lit from the left (+Y), in shade on the right (+X)
        return lit(tones[0], tones[1], tones[2], 0.5 + 0.5 * math.sin(angle - math.pi / 4))

    return Solid(cx - widest, cy - widest, z0, cx + widest, cy + widest, z1, inside, paint)


def sphere(cx, cy, cz, radius, tones, flatten=1.0):
    """A ball (or a dome, cut by what is under it), flattened vertically if flatten < 1"""
    def inside(x, y, z):
        return (x - cx) ** 2 + (y - cy) ** 2 + ((z - cz) / flatten) ** 2 <= radius ** 2

    def paint(x, y, z):
        nx, ny, nz = (x - cx) / radius, (y - cy) / radius, (z - cz) / (radius * flatten)
        return lit(tones[0], tones[1], tones[2], 0.45 + 0.35 * nz + 0.3 * (ny - nx))

    return Solid(cx - radius, cy - radius, cz - radius * flatten, cx + radius, cy + radius, cz + radius * flatten,
                 inside, paint)


def gable(x0, y0, x1, y1, z0, height, roof, wall, along='x'):
    """A pitched roof on (x0, y0)-(x1, y1), its ridge along X or Y at z0 + height. roof: (light, dark) slopes; wall:
    the colour of its visible gable end"""
    if along == 'x':
        middle, half = (y0 + y1) / 2.0, (y1 - y0) / 2.0

        def inside(x, y, z):
            return z <= z0 + height * (1 - abs(y - middle) / half)

        def paint(x, y, z):
            if x >= x1 - 0.3:
                return wall
            return roof[0] if y >= middle else roof[1]
    else:
        middle, half = (x0 + x1) / 2.0, (x1 - x0) / 2.0

        def inside(x, y, z):
            return z <= z0 + height * (1 - abs(x - middle) / half)

        def paint(x, y, z):
            if y >= y1 - 0.3:
                return wall
            return roof[1] if x >= middle else roof[0]

    return Solid(x0, y0, z0, x1, y1, z0 + height, inside, paint)


class Sprite:
    """A small picture standing at a point of the world: rows of characters, coloured by palette ('.' is empty)"""

    def __init__(self, x, y, z, rows, palette):
        self.x, self.y, self.z = x, y, z
        self.rows = rows
        self.palette = palette


class Line:
    """A line between two points of the world, a pixel wide (a wire, a mast)"""

    def __init__(self, start, end, colour):
        self.start, self.end = start, end
        self.colour = colour


# --- Drawing --------------------------------------------------------------------------------------------------------

def render(width, height, shapes, sprites, origin, background, lines=(), highlight=True, outline=True):
    """Draws the shapes, sprites and lines over the background (a function of the pixel, giving a colour or None for
    a transparent pixel), and outlines them (unless outline is False). A shape's paint may give None: the shape hides
    what is behind it, but shows nothing (to draw only the lights of a building). Returns the pixels, None where
    transparent."""
    ox, oy = origin
    pixels = [[background(i, j) for i in range(width)] for j in range(height)]
    owner = [[None] * width for _ in range(height)]
    face = [[None] * width for _ in range(height)]
    depth = [[-1e9] * width for _ in range(height)]

    for j in range(height):
        for i in range(width):
            px = i + 0.5 - ox
            py = j + 0.5 - oy
            for index, shape in enumerate(shapes):
                hit = shape.hit(px, py)
                if hit and hit[0] > depth[j][i]:
                    depth[j][i] = hit[0]
                    pixels[j][i] = shape.colour(hit)
                    owner[j][i] = index
                    face[j][i] = hit[1]

    def project(point):
        x, y, z = point
        return ox + x - y, oy + (x + y) / 2 - z, x + y + z

    for number, line in enumerate(lines):
        (x0, y0, d0), (x1, y1, d1) = project(line.start), project(line.end)
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for k in range(steps + 1):
            t = k / float(steps)
            i, j = int(math.floor(x0 + (x1 - x0) * t)), int(math.floor(y0 + (y1 - y0) * t))
            d = d0 + (d1 - d0) * t
            if 0 <= i < width and 0 <= j < height and d + 0.5 >= depth[j][i]:
                pixels[j][i] = line.colour
                owner[j][i] = ('line', number)
                face[j][i] = 'line'
                depth[j][i] = d + 0.5

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
    if highlight:
        for j in range(height - 1):
            for i in range(width):
                if face[j][i] == 'top' and face[j + 1][i] in ('left', 'right') and owner[j + 1][i] == owner[j][i] \
                        and pixels[j][i] is not None:
                    pixels[j][i] = mix(pixels[j][i], (255, 255, 255), 0.35)

    if not outline:
        return pixels

    # Flat shapes are drawn, but are not outlined, as if they were the background
    def solid(o):
        if o is None:
            return False
        if isinstance(o, tuple):
            return o[0] != 'line'
        return not shapes[o].flat

    # Outlines: around the whole picture (but the lines), and between objects where the one behind shows above the other
    outlined = [row[:] for row in pixels]
    for j in range(height):
        for i in range(width):
            if not solid(owner[j][i]) and not (isinstance(owner[j][i], tuple) and owner[j][i][0] == 'line'):
                near = [(i + di, j + dj) for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                if any(0 <= a < width and 0 <= b < height and solid(owner[b][a]) for a, b in near):
                    outlined[j][i] = OUTLINE
            elif solid(owner[j][i]) and j + 1 < height and solid(owner[j + 1][i]) and \
                    owner[j + 1][i] != owner[j][i] and depth[j + 1][i] > depth[j][i] + 1.5 and pixels[j][i] is not None:
                # The edge of a nearer object, seen over a farther one
                outlined[j][i] = shade(pixels[j][i], 0.55)

    return outlined


def to_image(pixels):
    height, width = len(pixels), len(pixels[0])
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for j in range(height):
        for i in range(width):
            if pixels[j][i] is not None:
                image.putpixel((i, j), tuple(pixels[j][i]) + (255,))
    return image


def transparent(i, j):
    return None


def enlarge(image, factor):
    return image.resize((image.width * factor, image.height * factor), Image.NEAREST)


def fit(shapes, sprites, width, height, margin=1):
    """The origin that centres the shapes in a picture of the given size (sprites rising above them are allowed for)"""
    left = min(s.left for s in shapes)
    right = max(s.right for s in shapes)
    top = min(s.top for s in shapes)
    bottom = max(s.bottom for s in shapes)
    for sprite in sprites:
        top = min(top, (sprite.x + sprite.y) / 2.0 - sprite.z - len(sprite.rows))
    ox = math.floor((width - (right - left)) / 2.0 - left)
    oy = math.floor((height - (bottom - top)) / 2.0 - top)
    return ox, max(oy, -top + margin)


# --- Painting -------------------------------------------------------------------------------------------------------

def walls(left, right, top, windows=None, lit=None):
    """A building: plain walls, with windows every few pixels if given (windows: (colour, spacing u, spacing v)), some
    of them lit (lit: (colour, one in how many))"""
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


def slab(top, thickness, edge=GRASS_DARK, details=True):
    """A piece of land: top(x, y) gives the colour of its surface, over earth sides"""
    def paint(face, u, v):
        if face == 'top':
            return top(int(u), int(v))
        h = int(v)
        if h >= thickness - 1 and edge is not None:
            return edge if face == 'left' else shade(edge, 0.85)
        if details and (h == thickness // 2 - 1 or (int(u) * 5 + h * 3) % 13 == 0):
            return EARTH_LINE
        return EARTH_LEFT if face == 'left' else EARTH_RIGHT
    return paint


def grass(x, y):
    return GRASS_LIGHT if (x * 3 + y * 5) % 11 == 0 else GRASS


TREE = ['.ggg.', 'gGgGg', 'GgGgD', 'gGgDD', '.DDD.', '..t..']
TREE_SMALL = ['.g.', 'gGD', '.t.']
TREE_PALETTE = {'g': (100, 166, 78), 'G': (58, 130, 56), 'D': (38, 98, 46), 't': (110, 74, 44)}

SMOKE = ['..ss', 'sSs.']
SMOKE_PALETTE = {'s': (200, 204, 220), 'S': (232, 236, 255)}
