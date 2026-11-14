# Kora

Aplicación web para el análisis de video con IA en baloncesto y fútbol. Hecha con React, Vite, Tailwind CSS y Lucide.

## Uso

```bash
npm install
npm run dev
```

`npm run build` compila a `dist/`, `npm run typecheck` revisa los tipos y `npm test` ejecuta las pruebas.

## Pantallas

| Ruta | Pantalla |
|---|---|
| `/` | Subir video: deporte, video local o URL, otros ángulos de cámara y demos |
| `/analisis` | Video: visor con capas, cámaras, vista 3D, cámara lenta, recortes, KPIs y panel lateral |
| `/coach` | AI Coach: la técnica de cada jugador medida en su video, con foto, clave y ejercicio |
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
| `ROBOFLOW_POSE_MODEL` | Modelo de pose. Por defecto `coco-pose-detection/3` (YOLOv8m-pose, 17 puntos). |
| `ROBOFLOW_POSE_MODEL_PRECISE` | Modelo de pose para los recortes del AI Coach. Por defecto, el mismo. |
| `ROBOFLOW_OBJECT_MODEL` | Modelo de objetos para el balón. Por defecto `coco/25`. |

En local, copia `.env.example` a `.env`; `npm run dev` sirve `/api/vision` con el mismo código.
Cada análisis consume inferencias de tu cuenta de Roboflow: una por fotograma, dos si se detecta el balón.
El AI Coach añade hasta 320 recortes por análisis, cada uno con pose y balón.

## AI Coach: la técnica medida en el video

Al pulsar **Analizar video** (o **Analizar mi técnica** en `/coach`), después de la pasada general se mide de cerca
a las dos personas que más se ven (`src/lib/coach/`):

1. **Captura densa** (`windows.ts`, `densePose.ts`, `pipeline.ts`). En cada instante se recorta a la persona, se amplía
   y se le mide la pose, de 10 a 24 veces por segundo según lo que dure el video. En fútbol, alrededor de cada
   posible golpeo se vuelven a mirar todos los fotogramas.
2. **Gestos** (`actions/`). Reconoce tiros de baloncesto (las manos suben del pecho a por encima de la cabeza),
   golpeos de fútbol (el balón sale disparado desde un pie que barre mientras el otro aguanta) y carreras
   (los pies se alternan).
3. **Chequeos** (`checks.ts`). En cada gesto mide lo que miraría un entrenador: en el tiro, base, piernas, codo,
   brazo, final y cuerpo; en el golpeo, pie y rodilla de apoyo, cuerpo y final; en la carrera, brazos, rodillas y tronco.
4. **Informe** (`report.ts`, `content.ts`). Un solo foco con su foto, por qué importa, una clave y un ejercicio;
   hasta dos cosas para después; lo que ya hace bien; y lo que no se pudo ver, con el consejo para grabarlo.

Reglas que sigue para no decir de más:

- Cada medida declara desde dónde se ve. De frente no se puede ver doblarse el codo ni la rodilla: las piernas se
  deducen de lo que bajan las caderas (vale desde cualquier ángulo) y lo demás se da por «no se pudo ver».
- Un fallo visto una sola vez nunca es «para corregir»: queda como «algo para probar», con seguridad baja.
- Los umbrales dejan una franja ancha sin comentario: la pose sobre video tiene varios grados de error.
- Con otro jugador encima, o sin ver el balón cuando hay más gente, el gesto no se califica.
- No hay diagnósticos médicos ni comentarios sobre el cuerpo.

Los textos están escritos para jugadores desde los 12 años. Las pruebas (`readability.test.ts`) miden cada uno con
el índice de Szigriszt-Pazos y exigen el nivel «bastante fácil» de la escala INFLESZ, frases de 16 palabras como
mucho y nada de jerga.

### Etiquetar a un jugador y elegir a quién medir

En `/analisis`, pulsa a una persona sobre el video (o su fila en «Rendimiento por jugador») para abrir su ficha y
ponerle **nombre y dorsal**. La etiqueta se ve sobre el video, en las barras, en el Coach y en el informe descargable.
Desde la ficha, o en «Elige a quién medir» de `/coach`, se le pide al Coach que mida **solo a esa persona**: reutiliza
la pasada general, así que no vuelve a gastar inferencias en el video completo. La etiqueta vale para ese análisis:
al volver a analizar el video, el seguimiento reparte números nuevos.

Límites conocidos: no reconoce todavía entradas al aro, pases, regates ni defensa; el seguimiento puede confundir
a dos jugadores que se cruzan; un video a cámara lenta se mide igual, pero sin cadencia de carrera; y de un
golpeo visto de frente solo se mide el final.

### Modo continuo: tres métodos

El análisis continuo se puede hacer de tres formas, que el usuario elige en el visor (la elección se recuerda):

| Método | Qué da | Dónde corre |
|---|---|---|
| Navegador · pose | Esqueleto y ángulos de hasta 6 personas cercanas | En el equipo del usuario |
| Navegador · equipo | Cajas de hasta 30 personas y el balón, con esqueleto en las más visibles | En el equipo del usuario |
| Roboflow | Lo mismo que el análisis por fotograma, cada 0,8 s | En el servicio de visión (consume créditos) |

Los dos métodos locales usan MediaPipe dentro de un Web Worker (`src/lib/vision.worker.ts`), así que la interfaz
no se frena mientras detectan. El runtime WASM se copia de `node_modules` a `public/mediapipe` al ejecutar
`npm run dev` o `npm run build`, y los modelos (6 a 7 MB cada uno) se descargan de Google al usarlos por primera vez.

## Qué es real y qué está simulado

Real, con la clave configurada:

- Cajas de personas, esqueleto, balón y ángulos del fotograma analizado, sobre tu propio video.
- **Analizar video**: muestrea un fotograma por segundo, y uno intermedio donde hay movimiento (hasta 80 s por análisis), y calcula KPIs y eventos de ese video:
  personas en cuadro, velocidad máxima, distancia, sprints, balón detectado, mapa de calor sobre la imagen y,
  en baloncesto, posibles tiros (ambas manos sobre la cabeza). Velocidades y distancias son estimaciones: usan
  la altura de cada persona (1,75 m) como escala y no descuentan el movimiento de la cámara.
- **Ficha de persona**: al pulsar una fila de «Rendimiento por jugador» se abre una ventana con su foto recortada
  del video, sus estadísticas, su velocidad en el tiempo, los eventos detectados y la pose de ese fotograma.
- **AI Coach**: tiros, golpeos y carreras de los protagonistas, medidos en el video (ver arriba).

Funciona en el navegador, sin backend:

- Reproducción del video local que subas, con velocidad, cámara lenta y saltos. El video y su análisis se guardan
  en IndexedDB, dentro del navegador, así que siguen ahí al recargar; «Quitar» los borra.
- Sin video, el visor muestra una demostración dibujada marcada como tal, con el botón para subir el tuyo.
- Recortes e historial, guardados en `localStorage`.
- Descarga de informes (Markdown) y datos (CSV), y copia de enlaces.

Está simulado con datos de ejemplo (`src/data/sports.ts`):

- Todo lo de las demostraciones sin video propio, y siempre la comparativa, los rangos de la pestaña Biomecánica y los informes de Jugadas IA.
- Pérdidas, goles y canastas: no se detectan en el video real.
- La identificación de dorsales y equipos, y las zonas: el modelo solo detecta personas, pose y balón.
- El procesamiento de la ingesta y la reproducción de YouTube, HLS o RTMP.
- Las cámaras 2 y 3 (reencuadran el mismo fotograma) y la vista 3D.
- La exportación de video (MP4), que necesita un servicio de render.
