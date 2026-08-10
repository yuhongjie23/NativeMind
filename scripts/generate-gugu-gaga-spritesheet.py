from pathlib import Path

from PIL import Image, ImageDraw


FRAME_WIDTH = 192
FRAME_HEIGHT = 208
COLUMNS = 8
ROWS = 9
PIXEL_SCALE = 4
CELL_WIDTH = FRAME_WIDTH // PIXEL_SCALE
CELL_HEIGHT = FRAME_HEIGHT // PIXEL_SCALE

TRANSPARENT = (0, 0, 0, 0)
OUTLINE = (83, 75, 61, 255)
BODY = (229, 202, 126, 255)
BODY_LIGHT = (242, 220, 151, 255)
BODY_SHADOW = (194, 161, 91, 255)
BEAK = (218, 145, 65, 255)
BEAK_LIGHT = (237, 169, 82, 255)
EYE = (58, 55, 49, 255)
FOOT = (205, 126, 52, 255)
BOOK_OUTLINE = (65, 78, 77, 255)
BOOK = (102, 137, 132, 255)
BOOK_PAGE = (210, 203, 173, 255)
SPARKLE = (246, 216, 128, 255)
SHADOW = (52, 50, 44, 64)


def ellipse(draw, box, fill):
    draw.ellipse(tuple(round(value) for value in box), fill=fill)


def rectangle(draw, box, fill):
    draw.rectangle(tuple(round(value) for value in box), fill=fill)


def draw_shadow(draw, width=22, y=46, offset=0):
    left = 24 - width // 2 + offset
    ellipse(draw, (left, y - 2, left + width, y + 1), SHADOW)


def draw_book(draw, page_shift=0):
    rectangle(draw, (11, 39, 37, 45), BOOK_OUTLINE)
    rectangle(draw, (12, 39, 23, 44), BOOK_PAGE)
    rectangle(draw, (25, 39 + page_shift, 36, 44), BOOK_PAGE)
    rectangle(draw, (23, 39, 25, 45), BOOK)
    rectangle(draw, (13, 43, 22, 44), BOOK)
    rectangle(draw, (26, 43 + page_shift, 35, 44), BOOK)


def draw_duck(
    draw,
    *,
    bob=0,
    offset_x=0,
    blink=False,
    eyes_closed=False,
    look=0,
    head_drop=0,
    body_drop=0,
    left_wing=0,
    right_wing=0,
    feet_phase=0,
    concerned=False,
    book=False,
    page_shift=0,
    sparkles=False,
):
    base_x = offset_x
    body_y = bob + body_drop
    head_y = bob + head_drop
    draw_shadow(draw, offset=base_x)

    if feet_phase == 0:
        rectangle(draw, (17 + base_x, 41 + body_y, 22 + base_x, 44 + body_y), OUTLINE)
        rectangle(draw, (26 + base_x, 41 + body_y, 31 + base_x, 44 + body_y), OUTLINE)
        rectangle(draw, (18 + base_x, 41 + body_y, 22 + base_x, 43 + body_y), FOOT)
        rectangle(draw, (26 + base_x, 41 + body_y, 30 + base_x, 43 + body_y), FOOT)
    elif feet_phase == 1:
        rectangle(draw, (15 + base_x, 40 + body_y, 21 + base_x, 43 + body_y), OUTLINE)
        rectangle(draw, (28 + base_x, 41 + body_y, 33 + base_x, 44 + body_y), OUTLINE)
        rectangle(draw, (16 + base_x, 40 + body_y, 20 + base_x, 42 + body_y), FOOT)
        rectangle(draw, (28 + base_x, 41 + body_y, 32 + base_x, 43 + body_y), FOOT)
    else:
        rectangle(draw, (17 + base_x, 41 + body_y, 22 + base_x, 44 + body_y), OUTLINE)
        rectangle(draw, (27 + base_x, 40 + body_y, 33 + base_x, 43 + body_y), OUTLINE)
        rectangle(draw, (18 + base_x, 41 + body_y, 22 + base_x, 43 + body_y), FOOT)
        rectangle(draw, (28 + base_x, 40 + body_y, 32 + base_x, 42 + body_y), FOOT)

    ellipse(draw, (10 + base_x, 19 + body_y, 38 + base_x, 43 + body_y), OUTLINE)
    ellipse(draw, (11 + base_x, 20 + body_y, 37 + base_x, 42 + body_y), BODY)
    ellipse(draw, (15 + base_x, 21 + body_y, 34 + base_x, 36 + body_y), BODY_LIGHT)
    rectangle(draw, (12 + base_x, 36 + body_y, 36 + base_x, 41 + body_y), BODY_SHADOW)
    ellipse(draw, (12 + base_x, 32 + body_y, 36 + base_x, 42 + body_y), BODY_SHADOW)

    left_box = (8 + base_x, 24 + body_y - left_wing, 16 + base_x, 37 + body_y)
    right_box = (32 + base_x, 24 + body_y - right_wing, 40 + base_x, 37 + body_y)
    ellipse(draw, left_box, OUTLINE)
    ellipse(draw, (left_box[0] + 1, left_box[1] + 1, left_box[2] - 1, left_box[3] - 1), BODY_SHADOW)
    ellipse(draw, right_box, OUTLINE)
    ellipse(draw, (right_box[0] + 1, right_box[1] + 1, right_box[2] - 1, right_box[3] - 1), BODY_SHADOW)

    ellipse(draw, (13 + base_x, 8 + head_y, 35 + base_x, 30 + head_y), OUTLINE)
    ellipse(draw, (14 + base_x, 9 + head_y, 34 + base_x, 29 + head_y), BODY)
    ellipse(draw, (17 + base_x, 10 + head_y, 31 + base_x, 20 + head_y), BODY_LIGHT)
    rectangle(draw, (22 + base_x, 5 + head_y, 25 + base_x, 10 + head_y), OUTLINE)
    rectangle(draw, (23 + base_x, 4 + head_y, 26 + base_x, 8 + head_y), BODY_SHADOW)
    rectangle(draw, (20 + base_x, 6 + head_y, 23 + base_x, 9 + head_y), BODY_SHADOW)

    eye_y = 17 + head_y
    if blink or eyes_closed:
        rectangle(draw, (18 + base_x, eye_y + 1, 21 + base_x, eye_y + 1), EYE)
        rectangle(draw, (27 + base_x, eye_y + 1, 30 + base_x, eye_y + 1), EYE)
    elif concerned:
        rectangle(draw, (18 + base_x, eye_y, 20 + base_x, eye_y + 1), EYE)
        rectangle(draw, (28 + base_x, eye_y, 30 + base_x, eye_y + 1), EYE)
        rectangle(draw, (19 + base_x, eye_y - 1, 21 + base_x, eye_y - 1), OUTLINE)
        rectangle(draw, (27 + base_x, eye_y - 1, 29 + base_x, eye_y - 1), OUTLINE)
    else:
        rectangle(draw, (18 + base_x + look, eye_y, 20 + base_x + look, eye_y + 2), EYE)
        rectangle(draw, (28 + base_x + look, eye_y, 30 + base_x + look, eye_y + 2), EYE)

    beak_y = 22 + head_y + (1 if concerned else 0)
    rectangle(draw, (20 + base_x, beak_y, 28 + base_x, beak_y + 4), OUTLINE)
    rectangle(draw, (21 + base_x, beak_y, 27 + base_x, beak_y + 2), BEAK_LIGHT)
    rectangle(draw, (21 + base_x, beak_y + 3, 27 + base_x, beak_y + 3), BEAK)

    if book:
        draw_book(draw, page_shift=page_shift)
    if sparkles:
        rectangle(draw, (7, 13, 8, 16), SPARKLE)
        rectangle(draw, (6, 14, 9, 15), SPARKLE)
        rectangle(draw, (39, 18, 40, 21), SPARKLE)
        rectangle(draw, (38, 19, 41, 20), SPARKLE)


def draw_sleep(draw, progress=1, phase=0):
    draw_shadow(draw, width=28, y=46)
    top = 28 + min(progress, 2)
    bottom = 44
    ellipse(draw, (8, top, 40, bottom), OUTLINE)
    ellipse(draw, (9, top + 1, 39, bottom - 1), BODY_SHADOW)
    ellipse(draw, (13, top, 31, bottom - 3), BODY)
    rectangle(draw, (15, 35 + phase, 19, 35 + phase), EYE)
    rectangle(draw, (24, 35 + phase, 28, 35 + phase), EYE)
    rectangle(draw, (29, 37 + phase, 36, 40 + phase), OUTLINE)
    rectangle(draw, (30, 37 + phase, 35, 39 + phase), BEAK)
    rectangle(draw, (23, 25 + progress, 25, 30 + progress), OUTLINE)
    rectangle(draw, (24, 24 + progress, 26, 28 + progress), BODY)
    if phase == 1:
        rectangle(draw, (39, 25, 40, 26), BODY_LIGHT)
        rectangle(draw, (41, 22, 42, 23), BODY_LIGHT)


def build_frame(index):
    image = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), TRANSPARENT)
    draw = ImageDraw.Draw(image)

    if 0 <= index <= 7:
        bob = [0, -1, -1, -2, -1, 0, 0, 0][index]
        draw_duck(draw, bob=bob, blink=index in (6, 7))
    elif 8 <= index <= 15:
        phase = index - 8
        draw_duck(draw, bob=[0, 0, 1, 1, 0, 0, -1, 0][phase], head_drop=2, look=-1, book=True, page_shift=1 if phase in (3, 4) else 0)
    elif 16 <= index <= 23:
        phase = index - 16
        draw_duck(draw, bob=[0, -1, -1, 0, 0, -1, 0, 0][phase], head_drop=phase % 3, left_wing=[0, 2, 5, 7, 5, 3, 1, 0][phase], look=-1 if phase < 4 else 1)
    elif 24 <= index <= 31:
        phase = index - 24
        draw_duck(draw, bob=[0, -1, -2, -2, -1, 0, 0, 0][phase], left_wing=[0, 3, 6, 8, 6, 3, 1, 0][phase], right_wing=[0, 3, 6, 8, 6, 3, 1, 0][phase], sparkles=phase in (2, 3, 4))
    elif 32 <= index <= 39:
        phase = index - 32
        draw_duck(draw, bob=[0, 1, 2, 2, 2, 1, 1, 0][phase], head_drop=[0, 1, 2, 3, 3, 2, 1, 0][phase], body_drop=1 if phase in (2, 3, 4, 5) else 0, concerned=True)
    elif 40 <= index <= 43:
        phase = index - 40
        draw_duck(draw, bob=[0, -1, -1, 0][phase], right_wing=[1, 8, 4, 1][phase])
    elif 44 <= index <= 47:
        phase = index - 44
        draw_duck(draw, bob=[0, -2, -2, 0][phase], left_wing=[2, 7, 9, 2][phase], right_wing=[2, 7, 9, 2][phase], sparkles=phase in (1, 2))
    elif 48 <= index <= 51:
        phase = index - 48
        if phase < 2:
            draw_duck(draw, bob=phase, head_drop=phase * 3, body_drop=phase * 2, eyes_closed=phase == 1)
        else:
            draw_sleep(draw, progress=phase, phase=0)
    elif 52 <= index <= 55:
        phase = index - 52
        draw_sleep(draw, progress=2, phase=1 if phase in (1, 2) else 0)
    elif 56 <= index <= 59:
        phase = index - 56
        if phase < 2:
            draw_sleep(draw, progress=1, phase=0)
        else:
            draw_duck(draw, bob=1 if phase == 2 else 0, blink=phase == 2, left_wing=3 if phase == 2 else 0, right_wing=3 if phase == 2 else 0)
    elif 60 <= index <= 63:
        phase = index - 60
        draw_duck(draw, bob=[0, -1, -1, 0][phase], look=-1, head_drop=1, left_wing=2 if phase in (1, 2) else 0)
    elif 64 <= index <= 67:
        phase = index - 64
        draw_duck(draw, bob=[0, -1, 0, -1][phase], offset_x=[-1, 0, 1, 0][phase], look=1, feet_phase=1 if phase % 2 == 0 else 2, right_wing=2 if phase % 2 else 0)
    else:
        phase = index - 68
        draw_duck(draw, bob=[0, -1, 0, -1][phase], offset_x=[1, 0, -1, 0][phase], look=-1, feet_phase=2 if phase % 2 == 0 else 1, left_wing=2 if phase % 2 else 0)

    return image.resize((FRAME_WIDTH, FRAME_HEIGHT), Image.Resampling.NEAREST)


def main():
    root = Path(__file__).resolve().parents[1]
    output = root / "public" / "companions" / "gugu-gaga" / "animations" / "gugu-gaga-v01.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (FRAME_WIDTH * COLUMNS, FRAME_HEIGHT * ROWS), TRANSPARENT)
    for index in range(COLUMNS * ROWS):
        frame = build_frame(index)
        sheet.alpha_composite(frame, ((index % COLUMNS) * FRAME_WIDTH, (index // COLUMNS) * FRAME_HEIGHT))
    alpha = sheet.getchannel("A")
    for index in range(COLUMNS * ROWS):
        left = (index % COLUMNS) * FRAME_WIDTH
        top = (index // COLUMNS) * FRAME_HEIGHT
        frame_alpha = alpha.crop((left, top, left + FRAME_WIDTH, top + FRAME_HEIGHT))
        if frame_alpha.getbbox() is None:
            raise RuntimeError(f"frame {index} is empty")
    sheet.save(output, format="PNG", optimize=True)
    print(output)


if __name__ == "__main__":
    main()
