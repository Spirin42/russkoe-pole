#!/usr/bin/env python3
"""Build the portable single HTML. Python standard library; no npm/install needed."""
import base64
import json
from pathlib import Path

root = Path(__file__).resolve().parent
template = (root / "template.html").read_text()
assets = {key: "data:image/webp;base64," + base64.b64encode((root / "assets" / (key + ".webp")).read_bytes()).decode() for key in ("main", "evening", "reference", "reference-extra")}
credits = '''<p>Фотография фасада: <a href="https://unsplash.com/photos/white-and-gray-concrete-building-QNh6enATMpM" target="_blank" rel="noopener noreferrer">Dima Pima / Unsplash</a>, Киев. <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">Unsplash License</a>.</p><p>Визуальный референс, окна и балконы: <a href="https://friendfunction.ru/shop/interior/nochnik-panelka-khrushchevka-mini/" target="_blank" rel="noopener noreferrer">«Хрущевка мини», Anokhin Nikita store / Friend Function</a> — изображение, предоставленное автором проекта, и дополнительная фотография из указанной им галереи.</p><p>Дополнительные бетонные фактуры — из предоставленной фотографии вечерней панельки. Все источники используются фрагментарно, с цветовой обработкой и программной композицией. Координаты поля вымышлены.</p>'''
for token, data in (("/*__STYLE__*/", (root / "style.css").read_text()), ("/*__ASSETS__*/", json.dumps(assets)), ("/*__RENDERER__*/", (root / "renderer.js").read_text()), ("/*__APP__*/", (root / "app.js").read_text()), ("<!--__CREDITS__-->", credits)):
    template = template.replace(token, data)
# index.html в корне: этот же файл раздаёт GitHub Pages.
(root / "index.html").write_text(template)
print(f"index.html: {len(template.encode()):,} bytes")
