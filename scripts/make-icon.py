from PIL import Image, ImageDraw
import os

os.makedirs('build', exist_ok=True)
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((24, 24, S - 24, S - 24), radius=230, fill=(27, 32, 45, 255))
for i in range(230, 0, -2):
    a = int(40 * (1 - i / 230))
    d.ellipse((S * 0.52 - i, S * 0.20 - i, S * 0.52 + i, S * 0.20 + i),
              fill=(242, 167, 107, max(0, a)))
d.arc((160, 250, 700, 790), start=50, end=300, fill=(245, 176, 113, 255), width=70)
d.arc((324, 250, 864, 790), start=230, end=120, fill=(116, 214, 190, 255), width=70)
d.ellipse((430, 430, 594, 594), fill=(255, 247, 236, 255))
d.ellipse((470, 470, 554, 554), fill=(245, 176, 113, 255))
d.rounded_rectangle((330, 850, 694, 882), radius=16, fill=(255, 247, 236, 90))
img.save('build/icon.png')
img.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icon', os.path.getsize('build/icon.ico'))
