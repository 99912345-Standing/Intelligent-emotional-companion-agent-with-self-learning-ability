import sys
from bs4 import BeautifulSoup

sys.stdout.reconfigure(encoding='utf-8')
for i in (1, 2):
    raw = f'docs/articles/raw/article0{i}-dom.html'
    with open(raw, encoding='utf-8') as handle:
        html = handle.read()
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(['script', 'style', 'noscript', 'svg']):
        tag.decompose()
    lines = [line.strip() for line in soup.get_text('\n').splitlines() if line.strip()]
    text = '\n'.join(lines).lstrip('\ufeff')
    target = f'docs/articles/article0{i}-text.txt'
    with open(target, 'w', encoding='utf-8') as handle:
        handle.write(text)
    print(i, len(text))
    print(text[:900])
    print('---')
