# Reporte de Importación de Horarios

Generado automáticamente por `scripts/importSchedule.ts` el 28/10/2026, 02:38:22.

## 1. Resumen Ejecutivo
- **Archivos procesados:** 5 (`1er año.xlsx`, `2do año.xlsx`, `3er año.xlsx`, `4to año.xlsx`, `5to año.xlsx`)
- **Total de comisiones generadas (deduplicadas y filtradas):** 337
- **Franjas reservadas de electivas generadas (`reservedElectiveSlots`):** 29
- **Ofertas de materias y términos:** 71
- **Comisiones que cambiaron de turno según horario real:** 43 comisiones
- **Validación del esquema:**  APROBADA (sin errores)

---

## 2. Comisiones por Archivo
| Archivo | Hojas Válidas | Comisiones Generadas | Hojas Omitidas |
| :--- | :---: | :---: | :---: |
| **1er año.xlsx** | 19 | **141** | 0 |
| **2do año.xlsx** | 14 | **78** | 1 |
| **3er año.xlsx** | 9 | **52** | 1 |
| **4to año.xlsx** | 6 | **39** | 0 |
| **5to año.xlsx** | 7 | **28** | 0 |
| **TOTAL** | **55** | **337** | **2** |

---

## 3. Hojas Omitidas (2)
- **2do año.xlsx** / `Hoja 2`: Hoja vacía o sin celdas válidas
- **3er año.xlsx** / `Seminario`: Hoja especial omitida a propósito (ej. Seminario o nombres no de curso)

> **Confirmación sobre hojas particulares:**
> - `Seminario` (en `3er año.xlsx`): se omite a propósito por ser una grilla agregada de titulación intermedia con formato multi-curso no asociable a una comisión estándar.
> - `Hoja 2` (en `2do año.xlsx`): se omite por ser una hoja completamente vacía sin datos.
> - `3K8` (en `3er año.xlsx`): procesada con éxito emitiendo sus franjas de electivas a `reservedElectiveSlots`.
> - `4K1A` y `4K1B` (en `4to año.xlsx`): procesadas con éxito generando comisiones para la electiva `408` (`Experiencia e Interfaces de Usuario - UIX`) y franjas reservadas.

---

## 4. Anomalías Detectadas y Resueltas

### (a) Comisiones sospechosas descartadas (2)
Módulos individuales de 45 minutos sin docentes que correspondían a abreviaturas residuales (ej. "AS") en años superiores sin respaldo en la tabla de docentes:
- **4to año.xlsx** / `4k2` (celda D26): Materia ID 16 en franja LUN 15:40-16:25. Motivo: Comisión 2C de 1 solo módulo (45 min) sin docentes y sin respaldo en tabla de docentes.
- **4to año.xlsx** / `4K4` (celda F17): Materia ID 16 en franja MIE 17:20-18:05. Motivo: Comisión 2C de 1 solo módulo (45 min) sin docentes y sin respaldo en tabla de docentes.

### (b) Docentes en tabla sin clases en la grilla (51)
Docentes listados en la tabla de docentes de una hoja que no tienen horas asignadas en la grilla semanal de ese curso:
- **1er año.xlsx** / `1K1`: Materia ID **4** con docentes [Deza, Adriana Aurora].
- **1er año.xlsx** / `1K1B`: Materia ID **4** con docentes [Flores, Elisa Carolina].
- **1er año.xlsx** / `1K2`: Materia ID **4** con docentes [Flores, Elisa Carolina].
- **1er año.xlsx** / `1K3`: Materia ID **4** con docentes [Zaninetti, Sergio Francisco].
- **1er año.xlsx** / `1K4`: Materia ID **4** con docentes [Musso, María de los Ángeles].
- **1er año.xlsx** / `1K14`: Materia ID **4** con docentes [Deza, Adriana Aurora].
- **1er año.xlsx** / `1K17`: Materia ID **4** con docentes [Flores, Elisa Carolina].
- **2do año.xlsx** / `2K11B`: Materia ID **16** con docentes [Jewsbury, Alejandra María; Teicher, Romina Gabriela; Ortiz Quiroz, Valeria].
- **2do año.xlsx** / `2K11B`: Materia ID **13** con docentes [Paz Menvielle, María Alejandra; Constable, Leticia Edith; Arcidiácono, Marcelo José María].
- **2do año.xlsx** / `2K11B`: Materia ID **17** con docentes [Infante, Roberto Adrian; Stefanich, Clarisa Liliana].
- **2do año.xlsx** / `2K11B`: Materia ID **14** con docentes [Ligorria, Laura Del Carmen; Moreno, Juan Carlos; Scandolo, Carlos Ivan].
- **3er año.xlsx** / `3K1`: Materia ID **301** con docentes [Romero, Rubén Aníbal; Romani, German Ariel].
- **3er año.xlsx** / `3K1`: Materia ID **99** con docentes [Herrera, Daniel Rodolfo; Ortiz, Maria Cecilia].
- **3er año.xlsx** / `3K2`: Materia ID **301** con docentes [Steffolani, Felipe Adrian; Romani, German Ariel; Bendezu González, Jonathan Leonel; Díaz Mac William, Rodrigo Tomás].
- **3er año.xlsx** / `3K2`: Materia ID **99** con docentes [Arenas, Maria Silvina; Mac William, Maria Irene].
- **3er año.xlsx** / `3K3`: Materia ID **301** con docentes [Serrano, Diego Javier; Romani, German Ariel].
- **3er año.xlsx** / `3K4`: Materia ID **301** con docentes [Bett, Gustavo Federico; Scarafia Altamira, Diego; Bendezu González, Jonathan Leonel].
- **3er año.xlsx** / `3K4`: Materia ID **99** con docentes [Arenas, Maria Silvina; Aquino, Francisco Alejandro].
- **3er año.xlsx** / `3K7`: Materia ID **301** con docentes [Harach Fosch, Jorge Luis; Parun Rua, Ivo].
- **3er año.xlsx** / `3K8`: Materia ID **301** con docentes [Romani, German Ariel].
- **4to año.xlsx** / `4k1`: Materia ID **403** con docentes [Bratti, Alicia Gabriela; Chichalof Roberts, Mabel Beatriz].
- **4to año.xlsx** / `4k1`: Materia ID **402** con docentes [Villarreal, Gustavo Javier; Flores, Nora Viviana].
- **4to año.xlsx** / `4k1`: Materia ID **401** con docentes [Cuevas, Juan Carlos; Mana, Franco].
- **4to año.xlsx** / `4k2`: Materia ID **403** con docentes [Bratti, Alicia Gabriela; Chichalof Roberts, Mabel Beatriz; Hoya Sánchez, Roberto Alejandro].
- **4to año.xlsx** / `4k2`: Materia ID **401** con docentes [Cuevas, Juan Carlos; Moya, Vanesa Veronica].
- **4to año.xlsx** / `4k2`: Materia ID **402** con docentes [Villarreal, Gustavo Javier; Flores, Nora Viviana].
- **4to año.xlsx** / `4K3`: Materia ID **403** con docentes [Bravo, Estela Maris; Chichalof Roberts, Mabel Beatriz; Hoya Sánchez, Roberto Alejandro].
- **4to año.xlsx** / `4K3`: Materia ID **402** con docentes [Zigaran, Jose Carlos; Peralta, Lorena Daniela].
- **4to año.xlsx** / `4K4`: Materia ID **404** con docentes [Zea Cárdenas, Ninfa Milagros; Pardo, Alfredo Luis].
- **4to año.xlsx** / `4K4`: Materia ID **403** con docentes [Bratti, Alicia Gabriela; Velez, German Eduardo].
- **4to año.xlsx** / `4K4`: Materia ID **401** con docentes [Mana, Franco; Gimenez Zens, Ines Luz; Moya, Vanesa Veronica].
- **4to año.xlsx** / `4K4`: Materia ID **406** con docentes [Odetti, Maria Alejandra; Kabusch, Andrés Ricardo].
- **5to año.xlsx** / `5K1`: Materia ID **507** con docentes [Carignano, Claudia Etna; Rustan, Silvina].
- **5to año.xlsx** / `5K1`: Materia ID **504** con docentes [Gigena, Elias Fernando; Balut Cabezas, Jorge Ariel].
- **5to año.xlsx** / `5K1`: Materia ID **512** con docentes [Cuevas, Juan Carlos; Castro, Claudia Susana; Gimenez Zens, Ines Luz].
- **5to año.xlsx** / `5K1`: Materia ID **505** con docentes [Gigena, Elias Fernando; Balut Cabezas, Jorge Ariel].
- **5to año.xlsx** / `5k2`: Materia ID **502** con docentes [Mana, Franco; Gimenez Zens, Ines Luz].
- **5to año.xlsx** / `5k2`: Materia ID **504** con docentes [Martinez, Daniel Ignacio; Gigena, Elias Fernando; Balut Cabezas, Jorge Ariel].
- **5to año.xlsx** / `5k2`: Materia ID **512** con docentes [Cuevas, Juan Carlos; Gimenez Zens, Ines Luz].
- **5to año.xlsx** / `5k2`: Materia ID **507** con docentes [Peretto, Claudia Beatriz; Rosa, Sergio Hernan].
- **5to año.xlsx** / `5k2`: Materia ID **505** con docentes [Martinez, Daniel Ignacio; Balut Cabezas, Jorge Ariel; Gigena, Elias Fernando].
- **5to año.xlsx** / `5k3`: Materia ID **504** con docentes [Srur, Leandro Paolo; Martinez, Daniel Ignacio; Ruffinatti, Adrian Feliciano].
- **5to año.xlsx** / `5k3`: Materia ID **507** con docentes [Rustan, Silvina; Gualpa, Mariano Martín].
- **5to año.xlsx** / `5k3`: Materia ID **508** con docentes [Montoya, Fanny Esther; Bravo, Estela Maris; Nieto, Claudia Andrea].
- **5to año.xlsx** / `5k3`: Materia ID **501** con docentes [Medina, Oscar Carlos; Romero, Rubén Aníbal].
- **5to año.xlsx** / `5k3`: Materia ID **506** con docentes [Barra, Mario Augusto; Galvan, Diego Roman].
- **5to año.xlsx** / `5k3`: Materia ID **514** con docentes [Liberatori, Marcelo Sadi; Damiano, Luis Esteban; Rustan, Silvina].
- **5to año.xlsx** / `5K4`: Materia ID **505** con docentes [Srur, Leandro Paolo; Ruffinatti, Adrian Feliciano; Martinez, Daniel Ignaci].
- **5to año.xlsx** / `5K4`: Materia ID **506** con docentes [Sacco, Pablo Alberto; Callejas, Marisa Del Carmen].
- **5to año.xlsx** / `5K4`: Materia ID **509** con docentes [Parisi, Germán Nicolás; Bertola, Federico Javier; Hick, Lucas Michel Karim].
- **5to año.xlsx** / `5K4`: Materia ID **510** con docentes [Romero, María Soledad; Romero, Rubén Aníbal].

### (c) Choques internos dentro de una misma comisión
 **0 choques internos.** Ninguna comisión tiene superposición entre sus propios horarios.

### (d) Comisiones sin docentes asignados (8)
Comisiones cuya grilla contenía materias oficiales pero no contaban con profesores especificados en la columna de docentes de la planilla:
- Materia ID **5** - Comisión **1K16** (tarde): SAB 14:55-18:05
- Materia ID **13** - Comisión **2K1B** (mañana): MAR 10:25-11:10, MAR 11:20-12:50, JUE 08:00-09:30, JUE 09:40-11:10
- Materia ID **16** - Comisión **2K3B** (mañana): MIE 08:00-09:30, MIE 09:40-10:25, JUE 11:20-12:50
- Materia ID **23** - Comisión **3K5B** (noche): LUN 17:20-18:05, LUN 18:15-19:45, MIE 17:20-18:05, MIE 18:15-19:45
- Materia ID **408** - Comisión **4K1A** (mañana): MAR 10:25-11:10, MAR 11:20-12:50, MIE 10:25-11:10, MIE 11:20-12:50
- Materia ID **408** - Comisión **4K1B** (mañana): MAR 10:25-11:10, MAR 11:20-12:50, MIE 10:25-11:10, MIE 11:20-12:50
- Materia ID **507** - Comisión **5K3B** (noche): LUN 18:15-19:45, LUN 19:55-20:40, JUE 18:15-19:45, JUE 19:55-20:40
- Materia ID **509** - Comisión **4K3** (noche): JUE 17:20-18:05, JUE 18:15-19:45

### (e) Casos de nombres de docentes corregidos
- **4to año.xlsx / 4k2 (R10C12):** `"Zanatta, Valentin\nSantiago"` fue unificado correctamente a `"Zanatta, Valentin Santiago"` sin partir el nombre en dos docentes separados.

---

## 5. Colección de Franjas Reservadas de Electivas (`reservedElectiveSlots`)
Se detectaron **29 franjas reservadas de electivas genéricas** (ej. `Elect`, `Electiva 1`, `Electiva 2`, `Electiva 1 GMP / GIP`, `Electiva 4 - 5`, etc.) que quedan a disposición del armador de horarios:
- Curso **3K1** (2C, turno mañana): etiqueta `"Elect"` en MAR 08:00-09:30, MAR 09:40-11:10, MIE 08:00-09:30, MIE 09:40-11:10
- Curso **3K2** (2C, turno mañana): etiqueta `"Elect"` en MAR 10:25-11:10, MAR 11:20-12:50, JUE 08:00-09:30, JUE 09:40-11:10
- Curso **3K3** (2C, turno tarde): etiqueta `"Elect"` en MAR 14:55-16:25, MAR 16:35-17:20, VIE 14:55-16:25, VIE 16:35-17:20
- Curso **3K4** (2C, turno noche): etiqueta `"Elect"` en MAR 19:55-21:25, MAR 21:35-23:05, MIE 19:55-21:25, MIE 21:35-23:05
- Curso **3K5** (1C, turno noche): etiqueta `"Electiva"` en MIE 19:55-21:25, MIE 21:35-23:05, VIE 19:55-21:25, VIE 21:35-23:05
- Curso **3K7** (2C, turno tarde): etiqueta `"Elect"` en MAR 16:35-18:05, VIE 13:15-14:45
- Curso **3K8** (2C, turno tarde): etiqueta `"Elect"` en LUN 14:55-16:25, LUN 16:35-17:20, JUE 14:55-16:25, JUE 16:35-17:20
- Curso **4K1** (1C, turno mañana): etiqueta `"Electiva 1 GMP / GIP"` en MAR 11:20-12:50
- Curso **4K1** (1C, turno mañana): etiqueta `"Electiva 2"` en MIE 10:25-11:10, MIE 11:20-12:50, VIE 10:25-11:10, VIE 11:20-12:50
- Curso **4K1** (1C, turno mañana): etiqueta `"Electiva 1"` en VIE 08:00-09:30, VIE 09:40-10:25
- Curso **4K2** (1C, turno tarde): etiqueta `"Electiva 1"` en MIE 15:40-16:25, MIE 16:35-18:05, JUE 15:40-16:25, JUE 16:35-18:05
- Curso **4K2** (1C, turno tarde): etiqueta `"Electiva 2"` en JUE 13:15-14:45, JUE 14:55-15:40, VIE 13:15-14:45, VIE 14:55-15:40
- Curso **4K3** (1C, turno noche): etiqueta `"Electiva 1"` en MAR 18:15-19:45, MAR 19:55-20:40, JUE 20:40-21:25, JUE 21:35-23:05
- Curso **4K4** (2C, turno noche): etiqueta `"Electiva 1"` en MAR 18:15-19:45, MAR 19:55-20:40, VIE 18:15-19:45, VIE 19:55-20:40
- Curso **4K4** (2C, turno noche): etiqueta `"Electiva 2"` en JUE 20:40-21:25, JUE 21:35-23:05, VIE 20:40-21:25, VIE 21:35-23:05
- Curso **5K1** (1C, turno mañana): etiqueta `"Electiva 1"` en JUE 11:20-12:50, JUE 13:15-14:00, VIE 10:25-11:10, VIE 11:20-12:50
- Curso **5K1** (2C, turno mañana): etiqueta `"Electiva 2"` en LUN 10:25-11:10, LUN 11:20-12:50, MIE 08:00-09:30, MIE 09:40-10:25
- Curso **5K1** (2C, turno mañana): etiqueta `"Electiva 3"` en JUE 10:25-11:10, JUE 11:20-12:50, VIE 10:25-11:10, VIE 11:20-12:50
- Curso **5K2** (1C, turno tarde): etiqueta `"Electiva 1"` en MIE 15:40-16:25, MIE 16:35-18:05, VIE 15:40-16:25, VIE 16:35-18:05
- Curso **5K2** (2C, turno tarde): etiqueta `"Electiva 3"` en MIE 13:15-14:00, MIE 14:55-15:40, VIE 13:15-14:00, VIE 14:55-15:40
- Curso **5K2** (2C, turno tarde): etiqueta `"Electiva 2"` en JUE 15:40-16:25, JUE 16:35-18:05, VIE 15:40-16:25, VIE 16:35-18:05
- Curso **5K3** (1C, turno noche): etiqueta `"Electiva 1"` en LUN 20:40-21:25, LUN 21:35-23:05, VIE 20:40-21:25, VIE 21:35-23:05
- Curso **5K3** (2C, turno noche): etiqueta `"Electiva 3"` en LUN 18:15-19:45, LUN 19:55-20:40
- Curso **5K3** (2C, turno noche): etiqueta `"Electiva 4 - 5"` en LUN 20:40-21:25, LUN 21:35-23:05
- Curso **5K3** (2C, turno noche): etiqueta `"Electiva 4 - 3"` en JUE 17:20-18:05, JUE 18:15-19:45, JUE 19:55-20:40
- Curso **5K3** (2C, turno noche): etiqueta `"Electiva 5"` en VIE 18:15-19:45, VIE 19:55-20:40
- Curso **5K4** (1C, turno noche): etiqueta `"Electiva 1"` en MIE 20:40-21:25, MIE 21:35-23:05, VIE 20:40-21:25, VIE 21:35-23:05
- Curso **5K4** (2C, turno noche): etiqueta `"Electiva 2"` en LUN 18:15-19:45, LUN 19:55-20:40, JUE 17:20-18:05, JUE 18:15-19:45
- Curso **5K4** (2C, turno noche): etiqueta `"Electiva 3"` en LUN 20:40-21:25, LUN 21:35-23:05, VIE 20:40-21:25, VIE 21:35-23:05

---

## 6. Verificación de Cursos de Ejemplo

### (a) 2do Año - Curso 2K1 (Fixture de Validación)
| Materia ID | Término | Turno | Franjas Horarias | Docentes |
| :---: | :---: | :---: | :--- | :--- |
| 9 | A | mañana | LUN 09:40-11:10 | MAR 08:00-09:30 | MAR 09:40-10:25 | Savorgnano, Marcela Alejandra |
| 10 | A | mañana | MIE 08:00-09:30 | MIE 09:40-10:25 | VIE 10:25-11:10 | VIE 11:20-12:05 | Gómez Astudillo, Luis Eduardo; Musso, Javier Horacio |
| 13 | 1C | mañana | MAR 10:25-11:10 | MAR 11:20-12:50 | JUE 08:00-09:30 | JUE 09:40-11:10 | Montoya, Fanny Esther; Paez, Nancy Del Valle |
| 13 | 1C | mañana | MAR 10:25-11:10 | MAR 11:20-12:50 | JUE 08:00-09:30 | JUE 09:40-11:10 | _Sin docentes_ |
| 14 | 2C | mañana | MAR 10:25-11:10 | MAR 11:20-12:50 | JUE 08:00-09:30 | JUE 09:40-11:10 | Corso, Cynthia Lorena; Polliotto, Martin Dario; Casatti, Martín Gustavo |
| 15 | A | mañana | LUN 08:00-09:30 | VIE 12:05-12:50 | Serna, Monica Mariel; Allende, Sandra Liliana; Parisi, Germán Nicolás |
| 16 | A | mañana | MIE 10:25-11:10 | MIE 11:20-12:50 | VIE 08:00-09:30 | VIE 09:40-10:25 | Mac William, Maria Irene; Castro, Claudia Susana; Botta, Oscar Ernesto |
| 17 | 1C | mañana | LUN 11:20-12:50 | JUE 11:20-12:50 | Infante, Roberto Adrian; Righetti, Andrea Fabiana |

### (b) 1er Año - Curso 1K1
| Materia ID | Término | Turno | Franjas Horarias | Docentes |
| :---: | :---: | :---: | :--- | :--- |
| 1 | A | mañana | LUN 08:00-09:30 | LUN 09:40-10:25 | MAR 08:00-09:30 | Romoli, Irene Esther; Galarza, Emilce Daniela |
| 1 | A | mañana | LUN 08:00-09:30 | LUN 09:40-10:25 | MAR 08:00-09:30 | Higa, Nancy Roxana; Lazarte, Marcelo Máximo |
| 2 | A | mañana | LUN 10:25-11:10 | LUN 11:20-12:50 | MIE 12:05-12:50 | García, Alfredo Antonio; Peralta, Lorena Daniela |
| 2 | A | mañana | LUN 10:25-11:10 | LUN 11:20-12:50 | MIE 12:05-12:50 | Ochoa Rodríguez, Pablo Alejandro; Diguilio, Eliana |
| 3 | A | mañana | MAR 09:40-11:10 | MIE 09:40-11:10 | MIE 11:20-12:05 | Catan, Julio Cesar; Beletti Campos, Juan Pablo |
| 3 | A | mañana | MAR 09:40-11:10 | MIE 09:40-11:10 | MIE 11:20-12:05 | Pereira Berella, Antonio Martín; Natchef, Natalia |
| 5 | 1C | mañana | JUE 08:00-09:30 | JUE 09:40-10:25 | VIE 10:25-11:10 | VIE 11:20-12:50 | Casoria, Fernando Italo; Liendo, Susana Beatriz; Rodriguez, Jorge Alberto |
| 5 | 1C | mañana | JUE 08:00-09:30 | JUE 09:40-10:25 | VIE 10:25-11:10 | VIE 11:20-12:50 | Jurio, Maria Aurelia; Di Gionantonio, María Alejandra Mabel; Auquer, Marcelo Javier |
| 6 | A | mañana | MAR 11:20-12:50 | MIE 08:00-09:30 | Fritelli, Valerio; Bett, Gustavo; Molina Recabarren, Francisco |
| 6 | A | mañana | MAR 11:20-12:50 | MIE 08:00-09:30 | Tartabini, Marcela Edith; Romani, German Ariel; Cugura, Ignacio Cruz |
| 7 | 2C | mañana | JUE 09:40-11:10 | JUE 11:20-12:50 | VIE 08:00-09:30 | VIE 09:40-11:10 | Cayuelo, Pablo Oscar; Meloni, Brenda; Oscar, Botta |
| 7 | 2C | mañana | JUE 09:40-11:10 | JUE 11:20-12:50 | VIE 08:00-09:30 | VIE 09:40-11:10 | Paz Menvielle, María Alejandra; Serna, Monica Mariel |
| 8 | 1C | mañana | JUE 10:25-11:10 | JUE 11:20-12:50 | VIE 08:00-09:30 | VIE 09:40-10:25 | Ortiz, Maria Cecilia; Herrera, Daniel Rodolfo; Turanzas, Susana Beatriz |
| 8 | 1C | mañana | JUE 10:25-11:10 | JUE 11:20-12:50 | VIE 08:00-09:30 | VIE 09:40-10:25 | Bratti, Alicia Gabriela; Allende, Sandra Liliana; Destefanis, Maria Laura |
| 11 | 2C | mañana | JUE 08:00-09:30 | VIE 11:20-12:50 | Careto, Fernando Javier |
| 11 | 2C | mañana | JUE 08:00-09:30 | VIE 11:20-12:50 | Vernini, Alfredo; Careto, Fernando |

### (c) 4to Año - Curso 4K1
| Materia ID | Término | Turno | Franjas Horarias | Docentes |
| :---: | :---: | :---: | :--- | :--- |
| 24 | 2C | mañana | MIE 08:00-09:30 | MIE 09:40-11:10 | Vazquez De Novoa, Santiago Roberto; Zanatta, Hugo Alberto |
| 25 | 2C | mañana | MAR 11:20-12:50 | JUE 10:25-11:10 | JUE 11:20-12:50 | Meles, Silvia Judith; Crespo, María Mickaela; Garnero, Constanza |
| 26 | A | mañana | LUN 12:05-12:50 | MAR 08:00-09:30 | Sanchez, Cecilia Beatriz; Gibellini, Fabian Alejandro; Ciceri, Leonardo Ramón |
| 27 | A | mañana | LUN 10:25-11:10 | LUN 11:20-12:05 | MAR 09:40-11:10 | Carignano, Claudia Etna; Peretto, Claudia Beatriz; Sánchez, Claudia Andrea |
| 28 | 1C | mañana | MIE 08:00-09:30 | MIE 09:40-10:25 | JUE 10:25-11:10 | JUE 11:20-12:50 | Sanchez, Daniel Mario; Berrotaran, Juan Jose; Auquer, Marcelo Javier |
| 29 | 2C | mañana | MIE 11:20-12:50 | VIE 08:00-09:30 | VIE 09:40-10:25 | Pailos, Hugo; Polliotto, Martin Dario |
| 30 | A | mañana | LUN 08:00-09:30 | LUN 09:40-10:25 | JUE 08:00-09:30 | JUE 09:40-10:25 | Romero, Ruben Orlando; Balut Cabezas, Jorge Ariel; Zoppetti, Darío Germán |
| 405 | 2C | mañana | VIE 10:25-11:10 | VIE 11:20-12:50 | Sanabria, Fernando Mario; Casatti, Martín Gustavo |
| 408 | 1C | mañana | MAR 10:25-11:10 | MAR 11:20-12:50 | MIE 10:25-11:10 | MIE 11:20-12:50 | _Sin docentes_ |
| 408 | 2C | mañana | MAR 10:25-11:10 | MAR 11:20-12:50 | MIE 10:25-11:10 | MIE 11:20-12:50 | _Sin docentes_ |

---

## 7. Advertencias y Materias No Mapeadas (0)
_Todas las celdas mapearon correctamente a materias del plan, electivas registradas o franjas reservadas._
