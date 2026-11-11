# Kora

Aplicación web para el análisis de video con IA en baloncesto y fútbol. Hecha con React, Vite, Tailwind CSS y Lucide.

## Uso

```bash
npm install
npm run dev
```

`npm run build` compila a `dist/` y `npm run typecheck` revisa los tipos.

## Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | Ingesta: deporte, video local o URL, otros ángulos de cámara y demos |
| `/analisis` | Visor con capas, cámaras, vista 3D, cámara lenta, recortes, KPIs y panel lateral |
| `/coach` | Diagnósticos técnicos y ejercicios correctivos |
| `/jugadas` | Informe de jugadas clave y ejercicios |
| `/historial` | Análisis guardados |
| `/recortes` | Recortes guardados, con su análisis y exportación |

## Qué es real y qué está simulado

Funciona en el navegador, sin backend:

- Reproducción del video local que subas, con velocidad, cámara lenta y saltos.
- Recortes e historial, guardados en `localStorage`.
- Descarga de informes (Markdown) y datos (CSV), y copia de enlaces.

Está simulado con datos de ejemplo (`src/data/sports.ts`):

- Las capas de visión por computadora, los KPIs, los diagnósticos y los informes: no hay ningún modelo conectado.
- El procesamiento de la ingesta y la reproducción de YouTube, HLS o RTMP.
- Las cámaras 2 y 3 (reencuadran el mismo fotograma) y la vista 3D.
- La exportación de video (MP4), que necesita un servicio de render.
