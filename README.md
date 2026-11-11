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

## Visión por computadora real

Con un video local cargado, el visor puede analizar fotogramas con la API serverless de Roboflow:
detección de personas, pose de 17 puntos, balón opcional y ángulos articulares medidos sobre la imagen.

El navegador envía el fotograma a `/api/vision` (función de Vercel en `api/vision.ts`), que guarda la clave
y consulta a Roboflow. Configura la variable de entorno en el servidor:

| Variable | Uso |
|---|---|
| `ROBOFLOW_API_KEY` | Clave de la API de Roboflow. Obligatoria. |
| `ROBOFLOW_POSE_MODEL` | Modelo de pose. Por defecto `coco-pose-detection/1`. |
| `ROBOFLOW_OBJECT_MODEL` | Modelo de objetos para el balón. Por defecto `coco/25`. |

En local, copia `.env.example` a `.env`; `npm run dev` sirve `/api/vision` con el mismo código.
Cada análisis consume inferencias de tu cuenta de Roboflow: una por fotograma, dos si se detecta el balón.

## Qué es real y qué está simulado

Real, con la clave configurada:

- Cajas de personas, esqueleto, balón y ángulos del fotograma analizado, sobre tu propio video.

Funciona en el navegador, sin backend:

- Reproducción del video local que subas, con velocidad, cámara lenta y saltos.
- Recortes e historial, guardados en `localStorage`.
- Descarga de informes (Markdown) y datos (CSV), y copia de enlaces.

Está simulado con datos de ejemplo (`src/data/sports.ts`):

- Los eventos, KPIs, mapa de calor, diagnósticos e informes, y las capas del fotograma ilustrado de demostración.
- La identificación de dorsales y equipos, y las zonas: el modelo solo detecta personas, pose y balón.
- El procesamiento de la ingesta y la reproducción de YouTube, HLS o RTMP.
- Las cámaras 2 y 3 (reencuadran el mismo fotograma) y la vista 3D.
- La exportación de video (MP4), que necesita un servicio de render.
