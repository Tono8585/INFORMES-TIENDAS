# Informe Stock Tiendas — App Next.js (Vercel)

App con dos partes separadas:

- **`/admin`** — página privada donde TÚ subes el CSV y el Excel, revisas el
  informe, y descargas un fichero `data.json` con los datos ya procesados.
- **`/`** (la URL que compartes con el equipo) — todo el mundo ve el informe
  directamente, sin ningún botón de subida ni pantalla intermedia.

## Cómo funciona

El procesamiento del CSV/Excel sigue ocurriendo **en tu navegador** (no en
un servidor). Una vez generado el informe en `/admin`, descargas un
`data.json` (con los datos ya agregados, mucho más ligero que los ficheros
originales) y lo subes a la carpeta `public/` de tu repositorio de GitHub.
Vercel redespliega solo, y la página principal (`/`) lee ese `data.json` y
muestra el informe a cualquiera que entre — sin que tengan que subir nada.

## Actualizar el informe cada semana

1. Entra a `tuapp.vercel.app/admin` (solo tú necesitas conocer esta URL).
2. Sube el CSV y el Excel, pulsa "Generar informe".
3. Revisa que los datos son correctos (Resumen y Parrilla).
4. Pulsa "⬇ Descargar data.json" — se descarga un archivo `data.json`.
5. Ve a tu repositorio en GitHub → carpeta `public` → archivo `data.json` →
   icono de editar (lápiz) o "Add file → Upload files" → sube el nuevo
   `data.json` reemplazando al anterior → **Commit changes**.
6. Espera 1-2 minutos a que Vercel redespliegue automáticamente.
7. La URL principal (`/`) ya muestra los datos nuevos para todo el mundo.

## Cómo desplegarlo en Vercel (primera vez)

### Paso 1 — Cuenta de GitHub y Vercel
Si no tienes, créate una cuenta gratis en https://github.com y otra en
https://vercel.com (puedes entrar directamente con tu cuenta de GitHub).

### Paso 2 — Subir el proyecto a GitHub
Sube **toda la estructura de carpetas tal cual está** (respeta mayúsculas y
minúsculas, especialmente la carpeta `app` en minúsculas):

```
├── package.json
├── next.config.js
├── .gitignore
├── README.md
├── public/
│   └── data.json
└── app/
    ├── layout.jsx
    ├── page.jsx
    ├── globals.css
    ├── lib/
    │   └── reportLogic.jsx
    └── admin/
        └── page.jsx
```

Si tu navegador no te deja arrastrar carpetas al subir a GitHub, puedes usar
"Add file → Create new file" y escribir la ruta completa en el nombre (por
ejemplo `app/lib/reportLogic.jsx`) — GitHub crea las carpetas automáticamente
al detectar las barras `/`.

### Paso 3 — Desplegar en Vercel
1. En Vercel, botón **Add New → Project**.
2. Selecciona el repositorio que acabas de subir.
3. Vercel detecta automáticamente que es un proyecto Next.js — no hay que
   tocar ninguna configuración. Pulsa **Deploy**.
4. En 1-2 minutos tendrás una URL pública tipo
   `https://informe-stock-tiendas-tuusuario.vercel.app`.

### Paso 4 — Generar el primer informe
Ve a `tuapp.vercel.app/admin`, sube los ficheros, genera el informe, descarga
el `data.json` y súbelo a `public/data.json` en GitHub (ver sección de
arriba). Después de eso, comparte solo la URL principal (`/`) con tu equipo.

## Rendimiento y límites a tener en cuenta

- Con CSVs de 100-200MB, el procesamiento en `/admin` puede tardar uno o dos
  minutos y usa varios cientos de MB de memoria del navegador. Probado con
  un fichero real de 220MB sin problemas en un ordenador normal.
- El `data.json` resultante (los datos ya agregados) pesa bastante menos
  que los ficheros originales — del orden de 10-15MB — por lo que subirlo a
  GitHub y que la gente lo cargue en `/` es rápido.
- El procesamiento en `/admin` se hace con streaming (fila a fila) para
  minimizar el uso de memoria del navegador.

## Diferencias frente al informe HTML anterior

- No hay import/export de listas de MC por Excel en la Parrilla (se puede
  añadir si hace falta).
- No hay zoom al hacer clic en la foto.
- Si la foto de un modelo no existe en el CDN de Mango, simplemente
  desaparece (no hay reintento automático de varias secuencias de foto como
  en el HTML).
- El resto de la lógica (Tabla 1 por País con banderas y Top 100 dinámico,
  Tabla 2 por PG+Familia, filtros de Rango/Familia/Phase-in/Tienda/Mercado,
  Excluir Online, Disponibilidad, Blocked) es la misma que en el HTML.

## Aviso de privacidad

Tus ficheros de origen (CSV/Excel) nunca salen de tu navegador — solo se
sube a GitHub el `data.json` ya agregado (sin el detalle fila a fila
original). Aun así, ese `data.json` sigue conteniendo información de stock,
ventas y tiendas a nivel de modelo — confirma con quien lleve seguridad de
datos en Mango si esto es aceptable para compartir con la URL pública, ya
que cualquiera con el enlace de `/` puede consultarlo (no de `/admin`, que
solo tú deberías conocer).

