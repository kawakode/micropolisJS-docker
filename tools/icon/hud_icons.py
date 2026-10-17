#
# KawaCity: the small icons of the heads-up display and of the windows' titles, drawn by hand, pixel by pixel, in the
# palette and with the outlines of the rest of the game's pictures.
#
# This code is released under the GNU GPL v3, with some additional terms. Please see the files LICENSE and COPYING
# for details.

from PIL import Image

SIZE = 16

PALETTE = {
    'o': (7, 10, 31),
    'y': (250, 210, 72), 'Y': (200, 150, 40), 'l': (255, 240, 160),
    'w': (246, 244, 232), 'g': (188, 188, 200), 'G': (130, 130, 148), 'k': (70, 66, 84),
    'b': (92, 156, 255), 'B': (52, 92, 196), 'c': (170, 210, 245),
    'r': (214, 66, 52), 'R': (150, 40, 30), 'p': (240, 120, 170),
    'e': (110, 196, 92), 'E': (58, 130, 56),
    'n': (196, 150, 100), 'N': (150, 104, 64),
    'v': (150, 120, 190),
}

def overlay(rows, pattern, x, y):
    """The rows, with the pattern's characters (but '.') laid over them from column x, row y"""
    rows = list(rows)
    for j, line in enumerate(pattern):
        row = list(rows[y + j])
        for i, char in enumerate(line):
            if char != '.':
                row[x + i] = char
        rows[y + j] = ''.join(row)
    return rows


ICONS = [
    # A gold coin, with a dollar sign
    ('budget', overlay([
        '.....oooooo.....',
        '...ooyyyyyyoo...',
        '..oyyllllllyyo..',
        '.oyllllllllllYo.',
        '.oyllllllllllYo.',
        'oyllllllllllllYo',
        'oyllllllllllllYo',
        'oyllllllllllllYo',
        'oyllllllllllllYo',
        'oyllllllllllllYo',
        '.oyllllllllllYo.',
        '.oyllllllllllYo.',
        '..oYllllllllYo..',
        '...ooYYYYYYoo...',
        '.....oooooo.....',
        '................',
    ], ['..Y..', '.YYYY', 'Y.Y..', 'Y.Y..', '.YYY.', '..Y.Y', '..Y.Y', 'YYYY.', '..Y..'], 5, 3)),
    # A clipboard, with ticks
    ('evaluation', [
        '.....oooooo.....',
        '..oooogkkgoooo..',
        '.onnnoggggonnno.',
        '.onwwwwwwwwwwNo.',
        '.onwewwkkkkwwNo.',
        '.onweewwwwwwwNo.',
        '.onwwwwkkkkwwNo.',
        '.onwewwwwwwwwNo.',
        '.onweewkkkkwwNo.',
        '.onwwwwwwwwwwNo.',
        '.onwrwwkkkkwwNo.',
        '.onwwwwwwwwwwNo.',
        '.onwwwwwwwwwwNo.',
        '.oNNNNNNNNNNNNo.',
        '..oooooooooooo..',
        '................',
    ]),
    # Rising bars
    ('graphs', [
        '................',
        '................',
        '.........oooo...',
        '.........oeEo...',
        '.........oeEo...',
        '......ooooeEo...',
        '......obBoeEo...',
        '......obBoeEo...',
        '...oooobBoeEo...',
        '...oyYobBoeEo...',
        '...oyYobBoeEo...',
        '...oyYobBoeEo...',
        '.oooooooooooooo.',
        '.okkkkkkkkkkkko.',
        '.oooooooooooooo.',
        '................',
    ]),
    # Two little towns, with a road between them
    ('neighbours', [
        '................',
        '...o.......o....',
        '..oro.....obo...',
        '.orrro...obbbo..',
        'orrrrro.obbbbbo.',
        'owwwwwo.owwwwwo.',
        'owkwkwo.owkwkwo.',
        'owwwwwo.owwwwwo.',
        'owkwwwo.owwwkwo.',
        'ooooooo.ooooooo.',
        '................',
        'oooooooooooooooo',
        'okkkkkkkkkkkkkko',
        'okyykkyykkyykkko',
        'oooooooooooooooo',
        '................',
    ]),
    # A tornado
    ('disasters', [
        '................',
        'oooooooooooooo..',
        'oggggggggggggGo.',
        '.ooGGGGGGGGGoo..',
        '..ogggggggggGo..',
        '...oooGGGGGo....',
        '....ogggggGo....',
        '.....oGGGGo.....',
        '......ogggGo....',
        '.....oGGGo......',
        '......oggGo.....',
        '.......oGGo.....',
        '......ogGo......',
        '.......ogo......',
        '........o.......',
        '................',
    ]),
    # A camera
    ('picture', [
        '................',
        '................',
        '.....oooooo.....',
        '....okkkkkko....',
        '.oooooooooooooo.',
        'ogggggggggggrrGo',
        'oggggoooooggggGo',
        'ogggobbcbboggggo',
        'oggGobccbbBoGggo',
        'oggGobbbbbBoGggo',
        'ogggobbbbBBogggo',
        'oggggoooooggggGo',
        'oGGGGGGGGGGGGGGo',
        '.oooooooooooooo.',
        '................',
        '................',
    ]),
    # An "i", in a blue disc
    ('about', [
        '................',
        '.....oooooo.....',
        '...oobbbbbboo...',
        '..obbbbwwbbbBo..',
        '.obbbbbwwbbbbBo.',
        '.obbbbbbbbbbbBo.',
        'obbbbbwwwbbbbbBo',
        'obbbbbbwwbbbbbBo',
        'obbbbbbwwbbbbbBo',
        'obbbbbbwwbbbbbBo',
        '.obbbbbwwbbbbBo.',
        '.obbbbwwwwbbbBo.',
        '..oBbbbbbbbbBo..',
        '...ooBBBBBBoo...',
        '.....oooooo.....',
        '................',
    ]),
    # A gear
    ('settings', [
        '................',
        '......oooo......',
        '...oo.oggo.oo...',
        '..oggoogGooggo..',
        '..ogggggggggGo..',
        '...ogggooogGo...',
        '.oooggo...oGooo.',
        '.oggggo...oGGGo.',
        '.oggggo...oGGGo.',
        '.oooggo...oGooo.',
        '...oggGoooGGo...',
        '..ogggGGGGGGGo..',
        '..oGGooGGooGGo..',
        '...oo.oGGo.oo...',
        '......oooo......',
        '................',
    ]),
    # A floppy disk
    ('save', [
        '................',
        'ooooooooooooooo.',
        'oBBoggggggggoBBo',
        'oBBoggggggggoBBo',
        'oBBoggggkgggoBBo',
        'oBBoggggkgggoBBo',
        'oBBoooooooooBBBo',
        'oBBBBBBBBBBBBBBo',
        'oBBwwwwwwwwwwBBo',
        'oBBwkkkkkkkkwBBo',
        'oBBwwwwwwwwwwBBo',
        'oBBwkkkkkkkkwBBo',
        'oBBwwwwwwwwwwBBo',
        'oBBwwwwwwwwwwBBo',
        'oooooooooooooooo',
        '................',
    ]),
    # A magnifying glass
    ('query', [
        '................',
        '....oooooo......',
        '...occcccco.....',
        '..occwwcccco....',
        '.occwccccccco...',
        '.occcccccccco...',
        '.occcccccccco...',
        '.occcccccccco...',
        '..occcccccco....',
        '...occccccoNo...',
        '....oooooooNNo..',
        '..........oNNNo.',
        '...........oNNNo',
        '............oNNo',
        '.............oo.',
        '................',
    ]),
    # A cup
    ('trophy', [
        '................',
        '..oooooooooooo..',
        'oooyllllllllyooo',
        'oyoylllllllyYoyo',
        'oyoyyllllllyYoyo',
        '.oyoyyllllyYYoo.',
        '..oooyyyyyYYoo..',
        '.....oyyyYYo....',
        '......oyYYo.....',
        '......oyYo......',
        '......oyYo......',
        '.....oyyYYo.....',
        '....ooooooooo...',
        '....onnnnnnNo...',
        '....ooooooooo...',
        '................',
    ]),
    # A flag
    ('scenario', [
        '................',
        '.oo.............',
        '.ogoooooooooo...',
        '.ogorrrrrrrrRo..',
        '.ogorrwwrrrrRo..',
        '.ogorrwwrrrrRo..',
        '.ogorrrrrrrrRo..',
        '.ogorrrrrrrrRo..',
        '.ogoooooooooo...',
        '.ogo............',
        '.ogo............',
        '.ogo............',
        '.ogo............',
        'ooGooo..........',
        'oNNNNo..........',
        'oooooo..........',
    ]),
    # A heart
    ('heart', [
        '................',
        '................',
        '..oooo....oooo..',
        '.oppwpo..opppRo.',
        'oppwwppooppppRRo',
        'opppppppppppppRo',
        'opppppppppppppRo',
        'opppppppppppppRo',
        '.opppppppppppRo.',
        '..opppppppppRo..',
        '...opppppppRo...',
        '....oppppppo....',
        '.....oppRRo.....',
        '......oRRo......',
        '.......oo.......',
        '................',
    ]),
]


def draw(rows):
    assert len(rows) == SIZE and all(len(row) == SIZE for row in rows), rows
    image = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    for j, row in enumerate(rows):
        for i, char in enumerate(row):
            if char != '.':
                image.putpixel((i, j), PALETTE[char] + (255,))
    return image
