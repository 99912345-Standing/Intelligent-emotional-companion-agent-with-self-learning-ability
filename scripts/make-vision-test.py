import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs('resources', exist_ok=True)
S = 512
img = Image.new('RGB', (S, S), (250, 247, 241))
d = ImageDraw.Draw(img)
d.rounded_rectangle((50, 210, 250, 250), radius=14, fill=(217, 95, 65))
d.rounded_rectangle((50, 270, 200, 310), radius=14, fill=(232, 173, 92))
d.ellipse((300, 150, 470, 320), outline=(31, 111, 106), width=18)
d.ellipse((350, 200, 420, 270), fill=(31, 111, 106))
font = None
for candidate in [
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
]:
    if os.path.exists(candidate):
        try:
            font = ImageFont.truetype(candidate, 120)
            break
        except Exception:
            pass
if font:
    text = '42'
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((S - w) / 2, (S - h) / 2 - 50), text, font=font, fill=(27, 32, 45))
else:
    d.rectangle((180, 180, 330, 330), fill=(27, 32, 45))
img.save('resources/vision-test.png')
print('vision test image ready')
