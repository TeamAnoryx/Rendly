#!/usr/bin/env python3
"""One-off migration: convert a light-theme stylesheet to the dark premium palette.

Property-aware:
  text colours (color, fill, stroke, ...)   lightness inverted, hue kept
  backgrounds / borders / gradients         light -> dark surface (alpha kept),
                                            dark tints -> light tints, dark solids lifted
  shadows                                   always dark
  blue/indigo brand hues                    shifted to the violet primary
Usage: python3 scripts/darken-css.py file.css [more.css ...]   (edits in place)
"""
import colorsys
import re
import sys

COLOR = re.compile(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)")
DECL = re.compile(r"(?P<prop>[-a-zA-Z]+)\s*:\s*(?P<val>[^;{}]+)(?=[;}])")
TEXT_PROPS = {"color", "fill", "stroke", "caret-color", "-webkit-text-fill-color", "text-decoration-color", "column-rule-color"}
SHADOW_PROPS = {"box-shadow", "text-shadow", "filter"}
PRIMARY_H = 252 / 360  # #8b6cff


def parse(c):
    c = c.strip()
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)
    nums = [p.strip() for p in c[c.index("(") + 1:-1].split(",")]
    if len(nums) < 3:
        return None
    try:
        r, g, b = (float(n) / 255 for n in nums[:3])
        a = float(nums[3]) if len(nums) > 3 else 1.0
    except ValueError:
        return None
    return r, g, b, a


def fmt(r, g, b, a):
    R, G, B = (max(0, min(255, round(x * 255))) for x in (r, g, b))
    if a >= 0.999:
        return "#%02x%02x%02x" % (R, G, B)
    return "rgba(%d, %d, %d, %s)" % (R, G, B, ("%.3f" % a).rstrip("0").rstrip("."))


def brand_shift(h, s):
    """Blue/indigo brand hues become the violet primary."""
    if s > 0.25 and 0.55 <= h <= 0.72:
        return PRIMARY_H, max(s, 0.6)
    return h, s


def text_color(r, g, b, a):
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l >= 0.62:  # already light (e.g. white text on a button)
        return fmt(r, g, b, a)
    if l < 0.3:  # ink: near-white with a violet cast
        return fmt(*colorsys.hls_to_rgb(PRIMARY_H, 0.95 - l * 0.3, 0.7), a)
    h, s = brand_shift(h, s)
    if s > 0.25:  # coloured text (links, status): keep the hue, make it readable on dark
        return fmt(*colorsys.hls_to_rgb(h, max(0.7, min(0.82, 1 - l)), min(s, 0.9)), a)
    return fmt(*colorsys.hls_to_rgb(PRIMARY_H, 0.62 + (0.62 - l) * 0.4, 0.18), a)  # greys -> muted


def surface_color(r, g, b, a):
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    h, s = brand_shift(h, s)
    if l >= 0.8:  # white / near-white panels -> dark surface, alpha kept
        return fmt(*colorsys.hls_to_rgb(PRIMARY_H, 0.075 + (1 - l) * 0.25, 0.3), a)
    if l <= 0.32:
        if a < 0.5:  # faint dark tint used as a hover/divider -> faint light tint
            return fmt(1, 1, 1, min(0.5, a * 1.3))
        if s > 0.15 and 0.6 < h < 0.8:  # indigo/violet solid button
            return fmt(*colorsys.hls_to_rgb(PRIMARY_H, 0.58, 0.85), a)
        return fmt(*colorsys.hls_to_rgb(h, 0.17, min(s, 0.35)), a)  # lift so it reads on #07070d
    # mid tones: brand colours, status colours
    if s > 0.25 and h == PRIMARY_H:
        return fmt(*colorsys.hls_to_rgb(PRIMARY_H, 0.71, 1.0), a)
    if s > 0.25:
        return fmt(*colorsys.hls_to_rgb(h, max(l, 0.5), s), a)
    return fmt(*colorsys.hls_to_rgb(h, 0.22, s), a)


def shadow_color(r, g, b, a):
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if l >= 0.8 and a < 0.5:  # light inset highlight: keep but soften
        return fmt(r, g, b, a * 0.4)
    if s > 0.3 and l > 0.32:  # coloured glow
        h, s = brand_shift(h, s)
        return fmt(*colorsys.hls_to_rgb(h, l, s), a)
    return fmt(0, 0, 0, min(0.7, max(a * 2.2, 0.25)))


def convert_value(prop, val):
    p = prop.lower()
    if p.startswith("--"):
        fn = surface_color
    elif p in TEXT_PROPS:
        fn = text_color
    elif p in SHADOW_PROPS:
        fn = shadow_color
    else:
        fn = surface_color

    def sub(m):
        c = parse(m.group(0))
        return fn(*c) if c else m.group(0)

    return COLOR.sub(sub, val)


def convert(css):
    out, i = [], 0
    for m in DECL.finditer(css):
        out.append(css[i:m.start("val")])
        out.append(convert_value(m.group("prop"), m.group("val")))
        i = m.end("val")
    out.append(css[i:])
    return "".join(out)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as f:
            src = f.read()
        with open(path, "w", encoding="utf-8") as f:
            f.write(convert(src))
        print("converted", path)
