<p align="center">
  <img src="logo.jpg" alt="Lottie Editor" width="128">
</p>

# Lottie Editor

Web-based Lottie animation editor. Load `.json` Lottie files, edit layers, and export the result.

![Dark glassmorphism UI](https://img.shields.io/badge/theme-dark%20glassmorphism-7c3aed)
![No dependencies](https://img.shields.io/badge/deps-zero-22c55e)

## Features

- **Load & Merge** — загрузка `.json` и `.tgs` (Telegram стикеры) через кнопку или drag & drop
- **Merge** — объединение нескольких Lottie файлов в одну анимацию
- **Auto-Group** — автоматическая группировка импортированных слоёв в Null-родитель
- **Live Preview** — play/pause, перемотка, зацикливание, счётчик фреймов
- **Trim** — обрезка анимации: задание In/Out кадров для изменения длительности
- **Layer Tree** — дерево слоёв с SVG-миниатюрами, типами, выделением, переименованием, удалением
- **Collapsible Groups** — сворачиваемые группы (Null/Precomp) со стрелками ▶/▼
- **Layer Reorder** — перемещение слоёв вверх/вниз с реальным изменением z-order (целыми группами)
- **Cascade Delete** — удаление родителя удаляет всех потомков
- **Multi-Select** — мульти-выделение слоёв (Ctrl+Click)
- **Drag-to-Move** — перетаскивание слоёв прямо на canvas с рамкой выделения
- **Transform Editor** — редактирование позиции, якоря, масштаба, прозрачности
- **Color Palette** — глобальная палитра цветов сгруппированная по HEX с массовым редактированием
- **HSL Correction** — Hue, Saturation, Lightness — глобальная и по группам цветов (красные, оранжевые, жёлтые, зелёные, голубые, синие, фиолетовые, нейтральные)
- **Color Extraction** — из заливок, обводок, градиентов, солидов, эффектов
- **Export** — JSON, TGS, SVG (текущий кадр), PNG (текущий кадр, 2x retina)
- **Frame Markers** — маркеры границ canvas с размером
- **Undo** — Ctrl+Z (до 50 шагов) + кнопка Undo в тулбаре
- **Modular Architecture** — ES modules (9 модулей вместо монолита)

## Tech Stack

Pure vanilla HTML + CSS + JavaScript. No build step, no frameworks.  
External dependencies (CDN): [lottie-web](https://github.com/airbnb/lottie-web), [pako](https://github.com/nodeca/pako) (gzip for TGS).  
SVG export approach inspired by [lottie-to-svg](https://github.com/attikusfinch/lottie-to-svg).

## Getting Started

```bash
# Clone
git clone https://github.com/attikusfinch/lottie-editor-ui.git
cd lottie-editor-ui

# Serve locally (any static server works)
npx -y serve .
```

Open `http://localhost:3000` and load a Lottie `.json` file.

## Author

Made by [@fiscaldev](https://t.me/fiscaldev)

## License

MIT
