# FLAMA · Salón

Control de bebidas del salón: cierre diario, ingresos de mercadería, stock y control de descuadres. HTML, CSS y JavaScript vanilla, sin build. Separado por completo de la web de cocina: otro repositorio, otra dirección y otro esquema en la base.

## Pantallas

- **Cierre del día** (salón, sin PIN): por bebida, stock al cierre y venta directa; destilados en botellas cerradas más ml de la abierta (la app convierte a ml); tragos vendidos según el sistema; nota del día. Días anteriores a ayer requieren PIN.
- **Ingresos** (salón, sin PIN): fecha, bebida de la lista y cantidad. Si la bebida tiene otras presentaciones (botella y lata) muestra un aviso para confirmar. "Eventual" da de alta una bebida que no está en la lista. Borrar un ingreso requiere PIN.
- **Ver stock**: últimos 7 cierres en columnas.
- **Control**: para cada cierre, teórico = stock del cierre anterior + ingresos + ajustes − ventas directas − consumo por tragos; descuadre = real − teórico. Resumen del período y detalle día por día por bebida.
- **Utensilios** (conteo aparte, jueves, sábado y lunes): **Conteo** por utensilio con alerta si baja (bordó) o sube (naranja) respecto del conteo anterior; **Novedades** de baja o incorporación con motivo; **Resumen** con inicial, último, diferencia, justificado y sin justificar, más el historial de conteos. El primer conteo de cada utensilio define su stock inicial.
- **Caja**: calculadora para cerrar la caja. Contador de billetes por denominación (en `config.js`), pagos de caja con concepto, efectivo según el sistema y resultado: Caja OK si contado = sistema − pagos (coincidencia exacta), o cuánto falta o sobra. No guarda nada en la base; los valores quedan solo en la pestaña hasta cerrarla.
- **Ajustes** (PIN): ajustes de stock con motivo, alta y baja de bebidas, tragos y recetas, utensilios (alta, baja, corrección del stock inicial, cierre de período), cambio de PIN.

## Base de datos

Proyecto Supabase "Marvel Compartido", esquema `flama_salon` (no expuesto por la API). La web solo llama a funciones `public.salon_*`. SQL en `supabase/salon.sql`. Los datos de la planilla `FLAMA_stock_bebidas.xlsx` (28/09 al 14/10/2026) se importaron: stock inicial como cierre del 27/09, destilados convertidos de botellas a ml.

## Correr en local

```bash
python -m http.server 8124
```

Abrir http://localhost:8124.

## Publicar

Rama `main` → GitHub Pages. Las referencias a css/js en `index.html` llevan `?v=AAAAMMDDnn`: cambiar el número en cada publicación para que los celulares bajen la versión nueva.
