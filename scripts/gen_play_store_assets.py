#!/usr/bin/env python3
# Play Store görselleri üretici:
#   1) app-icon-512.png          — mevcut app icon'un 512x512 (32-bit) hali
#   2) feature-graphic-1024x500.png — store banner (oyunun tema/font hissiyle)
#
# Tasarım, ana ekran logosunu (app/index.tsx) ve src/ui/theme.ts paletini birebir
# izler: ince aralıklı "GİZEMLİ" + kalın ışıldayan "SAYILAR" (ice + cyan glow),
# soluk arka plan rakamları (faintDigit), sağda icon "?" motifi, koyu indigo
# radyal gradyan zemin, amber vurgu. Keskinlik için 2x render edip küçültülür.
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets", "images")
OUT = os.path.join(ROOT, "store-assets", "play-store")
os.makedirs(OUT, exist_ok=True)

# --- tema renkleri (src/ui/theme.ts) ---
BG_TOP   = (10, 20, 40)    # #0a1428
BG_MID   = (15, 31, 64)    # ~bgMid, merkez biraz daha açık
BG_EDGE  = (6, 9, 16)      # ~#060c1a vinyet ucu (biraz daha koyu)
CYAN     = (47, 168, 224)  # #2fa8e0
ICE      = (214, 244, 255) # #d6f4ff  (ışıldayan başlık)
DIM      = (142, 151, 201) # #8e97c9
AMBER    = (255, 200, 87)  # #ffc857
FAINT    = (47, 168, 224)  # faintDigit taban rengi (düşük alfa ile)

S = 2  # süper-örnekleme
FW, FH = 1024, 500
W, H = FW * S, FH * S

# --- font çözümü (mono = oyunun his) ---
def first_font(cands, size):
    for p in cands:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    # son çare: PIL default (boyutsuz) — olmamalı
    return ImageFont.load_default()

MONO_BOLD = [
    "/usr/share/fonts/liberation-mono-fonts/LiberationMono-Bold.ttf",
    "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf",
    "/usr/share/fonts/nimbus-mono-ps/NimbusMonoPS-Bold.otf",
]
MONO_REG = [
    "/usr/share/fonts/liberation-mono-fonts/LiberationMono-Regular.ttf",
    "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf",
    "/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf",
]

def font_bold(px): return first_font(MONO_BOLD, px)
def font_reg(px):  return first_font(MONO_REG, px)

# --- tracked (harf aralıklı) metin çizimi ---
def text_width(font, s, tracking):
    w = 0
    for ch in s:
        w += font.getlength(ch) + tracking
    return w - tracking if s else 0

def draw_tracked(draw, xy, s, font, fill, tracking, anchor_top=True):
    x, y = xy
    asc, desc = font.getmetrics()
    for ch in s:
        # 'la' = sol/ascender üst hizalama
        draw.text((x, y), ch, font=font, fill=fill, anchor="la" if anchor_top else "ls")
        x += font.getlength(ch) + tracking

# === radyal gradyan zemin (numpy'siz: küçük ızgara -> LANCZOS büyüt) ===
def radial_bg():
    gw, gh = 256, 125
    small = Image.new("RGB", (gw, gh))
    px = small.load()
    cx, cy = gw / 2.0, gh * 0.46  # merkez biraz yukarıda
    maxd = ((gw * 0.62) ** 2 + (gh * 0.72) ** 2) ** 0.5
    for j in range(gh):
        for i in range(gw):
            d = (((i - cx)) ** 2 + ((j - cy) * (gw / gh) * 0.5) ** 2) ** 0.5
            t = min(1.0, d / maxd)
            # merkez: BG_MID -> orta: BG_TOP -> kenar: BG_EDGE
            if t < 0.5:
                u = t / 0.5
                c = tuple(int(BG_MID[k] + (BG_TOP[k] - BG_MID[k]) * u) for k in range(3))
            else:
                u = (t - 0.5) / 0.5
                c = tuple(int(BG_TOP[k] + (BG_EDGE[k] - BG_TOP[k]) * u) for k in range(3))
            px[i, j] = c
    return small.resize((W, H), Image.LANCZOS).convert("RGBA")

img = radial_bg()

# === soluk arka plan rakamları (faintDigit) ===
def add_faint_digits():
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # (metin, x_final, y_final, boyut_final, alfa, renk)
    digits = [
        ("7", 120, 150, 240, 18, FAINT),
        ("3", 470, 250, 300, 14, FAINT),
        ("9", 250, 330, 180, 16, FAINT),
        ("4", 690, 90,  150, 14, FAINT),
        ("1", 880, 300, 200, 16, FAINT),
        ("8", 560, 40,  120, 12, AMBER),
        ("2", 60,  340, 110, 12, FAINT),
    ]
    for s, x, y, sz, a, col in digits:
        f = font_bold(sz * S)
        d.text((x * S, y * S), s, font=f, fill=col + (a,))
    return layer

img = Image.alpha_composite(img, add_faint_digits())

# === sağda "?" icon motifi + cyan glow halo ===
def add_question_motif():
    fg = Image.open(os.path.join(ASSETS, "app-icon-foreground.png")).convert("RGBA")
    bbox = fg.getbbox()  # şeffaf kenarları kırp -> sadece "?" + nokta
    if bbox:
        fg = fg.crop(bbox)
    target_h = int(330 * S)
    scale = target_h / fg.height
    fg = fg.resize((int(fg.width * scale), target_h), Image.LANCZOS)
    # konum: sağ, dikey ortada (güvenli boşluk içinde)
    cx = int(815 * S)
    px = cx - fg.width // 2
    py = (H - fg.height) // 2
    # glow halo: alfa maskesinden cyan silüet, bulanık
    alpha = fg.split()[3]
    glow = Image.new("RGBA", fg.size, (0, 0, 0, 0))
    glow_fill = Image.new("RGBA", fg.size, CYAN + (255,))
    glow.paste(glow_fill, (0, 0), alpha)
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    halo.paste(glow, (px, py), glow)
    halo = halo.filter(ImageFilter.GaussianBlur(28 * S))
    # halo'yu hafiflet
    ha = halo.split()[3].point(lambda v: int(v * 0.55))
    halo.putalpha(ha)
    out = Image.alpha_composite(img, halo)
    out.alpha_composite(fg, (px, py))
    return out

img = add_question_motif()

draw = ImageDraw.Draw(img)

# === başlık bloğu (sol) — ana ekran logosunu yansıtır ===
PAD_X = 78  # güvenli iç boşluk
x0 = PAD_X * S

# "GİZEMLİ" — ince, dim, geniş aralık
f_top = font_reg(36 * S)
tr_top = 16 * S
y_top = 150 * S
draw_tracked(draw, (x0, y_top), "GİZEMLİ", f_top, DIM + (255,), tr_top)

# "SAYILAR" — kalın, ice + cyan glow
f_big = font_bold(98 * S)
tr_big = 8 * S
y_big = 196 * S
say_w = text_width(f_big, "SAYILAR", tr_big)
# glow katmanı
glow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow_layer)
draw_tracked(gd, (x0, y_big), "SAYILAR", f_big, CYAN + (255,), tr_big)
glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(20 * S))
img = Image.alpha_composite(img, glow_layer)
draw = ImageDraw.Draw(img)
# keskin ice metin
draw_tracked(draw, (x0, y_big), "SAYILAR", f_big, ICE + (255,), tr_big)

# amber vurgu: SAYILAR altında ince çizgi + amber nokta (icon nokta motifi yankısı)
line_y = (196 + 132) * S
asc, _ = f_big.getmetrics()
draw.line([(x0, line_y), (x0 + int(say_w * 0.62), line_y)], fill=CYAN + (255,), width=max(2, 3 * S))
dot_r = 7 * S
dot_cx = x0 + int(say_w * 0.62) + 16 * S
draw.ellipse([dot_cx - dot_r, line_y - dot_r, dot_cx + dot_r, line_y + dot_r], fill=AMBER + (255,))

# alt başlık
f_sub = font_reg(25 * S)
tr_sub = 6 * S
y_sub = 352 * S
draw_tracked(draw, (x0, y_sub), "ÇEVRİMİÇİ SAYI DÜELLOSU", f_sub, CYAN + (255,), tr_sub)

# küçük marka etiketi (alt)
f_tag = font_reg(16 * S)
y_tag = 408 * S
draw_tracked(draw, (x0, y_tag), "VAVİZOF GAMES", f_tag, DIM + (255,), 4 * S)

# === küçült + kaydet (TAM 1024x500) ===
feature = img.convert("RGB").resize((FW, FH), Image.LANCZOS)
feature_path = os.path.join(OUT, "feature-graphic-1024x500.png")
feature.save(feature_path, "PNG")

# === 1) app icon 512x512 (mevcut tasarımı koru, 32-bit) ===
icon_src = Image.open(os.path.join(ASSETS, "app-icon.png")).convert("RGBA")
icon512 = icon_src.resize((512, 512), Image.LANCZOS)
icon_path = os.path.join(OUT, "app-icon-512.png")
icon512.save(icon_path, "PNG")

# --- doğrulama ---
for p in (icon_path, feature_path):
    im = Image.open(p)
    print(f"{os.path.basename(p)}: {im.size[0]}x{im.size[1]} mode={im.mode} "
          f"bytes={os.path.getsize(p)}")
print("OUT_DIR:", OUT)
