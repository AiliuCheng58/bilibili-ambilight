"""Generate the extension's TV mark at each manifest icon size."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

out = Path(__file__).resolve().parent.parent / "src" / "icons"
out.mkdir(parents=True, exist_ok=True)
size = 512
base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(base)
draw.rounded_rectangle((0, 0, 511, 511), 108, fill="#151925")
glow = Image.new("RGBA", (size, size))
gd = ImageDraw.Draw(glow)
gd.ellipse((35, 120, 280, 400), fill=(246, 117, 166, 160))
gd.ellipse((240, 100, 490, 390), fill=(76, 226, 202, 155))
base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(42)))
draw = ImageDraw.Draw(base)
draw.rounded_rectangle((103, 156, 409, 365), 34, fill="#111522", outline="#edc2db", width=12)
draw.line((183, 104, 229, 150), fill="#a6abbf", width=12)
draw.line((329, 104, 283, 150), fill="#a6abbf", width=12)
draw.rounded_rectangle((164, 209, 186, 288), 8, fill="#f495ba")
draw.rounded_rectangle((326, 209, 348, 288), 8, fill="#76e5d0")
draw.arc((219, 249, 293, 309), 10, 170, fill="#dbcfe5", width=9)
for target in (16, 32, 48, 128):
    base.resize((target, target), Image.Resampling.LANCZOS).save(out / f"icon-{target}.png")
print(f"Generated icons: {out}")
