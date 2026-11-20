"""
1:1 drill templates for the 1590XX enclosure, generated from tayda-drill-1590XX.txt (the authoritative hole list).

    python make_drill_templates.py     # writes face-drill.pdf/.png and side-drill.pdf/.png next to this file

A template is one face of the enclosure seen from outside, with that face's centre (the origin of the Tayda file) at
the centre of the page, x to the right and y up. Every hole is drawn at its true diameter with a centre cross and its
diameter in mm. The PDFs are written directly; the PNGs (20 px/mm, like the artwork PNGs) need Pillow >= 10.1.
"""
import os, zlib
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
HOLES = os.path.join(HERE, "tayda-drill-1590XX.txt")

# Tayda side letter -> output name, template width x height in mm (same pages as the print artwork), caption
FACE_NOTE = [
    (6.0, "TONE3000 DIY PEDAL - TOP FACE (A) DRILL TEMPLATE"),
    (5.0, "117 x 141 mm at 1:1. Print at 100 %, no scaling. Numbers are hole diameters in mm."),
    (5.0, "Centre it on the face: the ticks mark the face's centre lines."),
    (5.0, "The jack wall (E, side-drill) runs along the right-hand edge."),
]
SIDE_NOTE = [
    (5.0, "TONE3000 DIY PEDAL"), (5.0, "JACK WALL (E)"), (5.0, "DRILL TEMPLATE"), (5.0, ""),
    (5.0, "32 x 135 mm at 1:1."), (5.0, "Print at 100 %, no scaling."), (5.0, "Numbers are hole"),
    (5.0, "diameters in mm."), (5.0, ""),
    (5.0, "Centre it on the wall:"), (5.0, "the ticks mark the wall's"), (5.0, "centre lines."), (5.0, ""),
    (5.0, "Same way up as face-drill;"), (5.0, "this wall runs along its"), (5.0, "right-hand edge."),
]
TEMPLATES = {
    "A": dict(name="face-drill", w=117.0, h=141.0, title="TONE3000 DIY Pedal - top face (A) drill template",
              notes=[(-54.0, -52.0, FACE_NOTE)]),
    "E": dict(name="side-drill", w=32.0, h=135.0, title="TONE3000 DIY Pedal - jack wall (E) drill template",
              notes=[(-14.0, 50.0, SIDE_NOTE), (-14.0, 60.0, [(5.0, "POTS / FOOTSWITCH END")]),
                     (-14.0, -62.5, [(5.0, "ROTARY / LED END")])]),
}

MM = 72 / 25.4                       # PDF points per mm
BLACK, RED, FILL = (0, 0, 0), (0.86, 0.08, 0.08), (0.87, 0.87, 0.87)
OUTLINE_W, CROSS_W, EDGE_W = 0.2, 0.15, 0.15          # line widths, mm
CROSS_OVER, TICK, LABEL_PT = 1.0, 4.0, 5.5            # cross overhang and edge tick length (mm), label size (pt)


def read_holes(path):
    """{side: [(diameter, x, y), ...]} from the Tayda drill file (side, diameter, x, y; mm from the face centre)."""
    holes = {}
    for line in open(path):
        if line.strip():
            side, d, x, y = line.split()
            holes.setdefault(side, []).append((float(d), float(x), float(y)))
    return holes


def layout(t, holes):
    """Display list in mm, origin at the page centre, y up: ('line', ...), ('disc', ...) and ('text', ...) items."""
    w2, h2, e = t["w"] / 2, t["h"] / 2, EDGE_W / 2
    items = [("line", x0, y0, x1, y1, BLACK, EDGE_W) for x0, y0, x1, y1 in (
        (-w2 + e, -h2 + e, w2 - e, -h2 + e), (w2 - e, -h2 + e, w2 - e, h2 - e),            # outline
        (w2 - e, h2 - e, -w2 + e, h2 - e), (-w2 + e, h2 - e, -w2 + e, -h2 + e),
        (0, h2, 0, h2 - TICK), (0, -h2, 0, -h2 + TICK), (-w2, 0, -w2 + TICK, 0), (w2, 0, w2 - TICK, 0))]  # ticks
    for d, x, y in holes:
        r = d / 2
        items.append(("disc", x, y, r, FILL, BLACK, OUTLINE_W))
        items.append(("line", x - r - CROSS_OVER, y, x + r + CROSS_OVER, y, RED, CROSS_W))
        items.append(("line", x, y - r - CROSS_OVER, x, y + r + CROSS_OVER, RED, CROSS_W))
        items.append(("text", x + r + CROSS_OVER + 0.6, y - 0.36 * LABEL_PT / MM, LABEL_PT, f"{d:g}", BLACK))
    for x, y, lines in t["notes"]:
        for pt, s in lines:
            items.append(("text", x, y, pt, s, BLACK))
            y -= 1.3 * pt / MM
    return items


def write_pdf(path, t, items):
    X, Y = lambda x: (x + t["w"] / 2) * MM, lambda y: (y + t["h"] / 2) * MM
    n = lambda *v: " ".join(f"{a:.3f}" for a in v)
    ops = []
    for it in items:
        if it[0] == "line":
            _, x0, y0, x1, y1, col, lw = it
            ops.append(f"{n(*col)} RG {n(lw * MM)} w {n(X(x0), Y(y0))} m {n(X(x1), Y(y1))} l S")
        elif it[0] == "disc":
            _, x, y, r, fill, col, lw = it
            cx, cy, r, k = X(x), Y(y), r * MM, r * MM * 0.5522847498            # four Bezier quadrants
            ops.append(f"{n(*fill)} rg {n(*col)} RG {n(lw * MM)} w {n(cx + r, cy)} m "
                       f"{n(cx + r, cy + k, cx + k, cy + r, cx, cy + r)} c {n(cx - k, cy + r, cx - r, cy + k, cx - r, cy)} c "
                       f"{n(cx - r, cy - k, cx - k, cy - r, cx, cy - r)} c {n(cx + k, cy - r, cx + r, cy - k, cx + r, cy)} c b")
        elif it[4]:                                                              # text (blank lines only add space)
            _, x, y, pt, s, col = it
            s = s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
            ops.append(f"BT /F1 {n(pt)} Tf {n(*col)} rg {n(X(x), Y(y))} Td ({s}) Tj ET")
    stream = zlib.compress("\n".join(ops).encode("cp1252"), 9)
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {n(t['w'] * MM, t['h'] * MM)}] /Contents 4 0 R "
             f"/Resources << /Font << /F1 5 0 R >> >> >>").encode(),
            b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream) + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            f"<< /Title ({t['title']}) /Creator (make_drill_templates.py) >>".encode()]
    out, offsets = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, len(objs), xref)
    open(path, "wb").write(out)


def write_png(path, t, items, px_mm=20, ss=3):
    s = px_mm * ss                                                   # drawn oversized, then scaled down (antialiasing)
    im = Image.new("RGB", (round(t["w"] * s), round(t["h"] * s)), "white")
    draw = ImageDraw.Draw(im)
    X, Y = lambda x: (x + t["w"] / 2) * s, lambda y: (t["h"] / 2 - y) * s
    rgb = lambda c: tuple(round(255 * v) for v in c)
    for it in items:
        if it[0] == "line":
            _, x0, y0, x1, y1, col, lw = it
            h = lw * s / 2                                           # axis-aligned only: draw as a rectangle
            draw.rectangle([min(X(x0), X(x1)) - (h if x0 == x1 else 0), min(Y(y0), Y(y1)) - (h if y0 == y1 else 0),
                            max(X(x0), X(x1)) + (h if x0 == x1 else 0), max(Y(y0), Y(y1)) + (h if y0 == y1 else 0)],
                           fill=rgb(col))
        elif it[0] == "disc":
            _, x, y, r, fill, col, lw = it
            for rr, c in ((r + lw / 2, col), (r - lw / 2, fill)):
                draw.ellipse([X(x) - rr * s, Y(y) - rr * s, X(x) + rr * s, Y(y) + rr * s], fill=rgb(c))
        elif it[4]:                                                  # text
            _, x, y, pt, txt, col = it
            draw.text((X(x), Y(y)), txt, font=ImageFont.load_default(pt / MM * s), fill=rgb(col), anchor="ls")
    dpi = px_mm * 25.4
    im.resize((round(t["w"] * px_mm), round(t["h"] * px_mm)), Image.LANCZOS).save(path, dpi=(dpi, dpi))


if __name__ == "__main__":
    holes = read_holes(HOLES)
    unknown = sorted(set(holes) - set(TEMPLATES))
    if unknown:
        raise SystemExit(f"{HOLES}: no template defined for side(s) {', '.join(unknown)}")
    for side, t in TEMPLATES.items():
        for d, x, y in holes.get(side, []):
            if abs(x) + d / 2 > t["w"] / 2 or abs(y) + d / 2 > t["h"] / 2:
                raise SystemExit(f"side {side}: {d:g} mm hole at ({x:g}, {y:g}) is outside the {t['w']:g} x {t['h']:g} mm template")
            if side != "A" and x:
                # every wall hole has been on the wall's centre line so far, so it has never mattered which long edge
                # of the strip Tayda's +x points to. Find that out before drawing an off-centre one.
                raise SystemExit(f"side {side}: hole at x = {x:g} is off the wall's centre line; check Tayda's x direction first")
    for side, t in TEMPLATES.items():
        items = layout(t, holes.get(side, []))
        write_pdf(os.path.join(HERE, t["name"] + ".pdf"), t, items)
        write_png(os.path.join(HERE, t["name"] + ".png"), t, items)
        print(f"{t['name']}.pdf/.png: side {side}, {len(holes.get(side, []))} holes")
