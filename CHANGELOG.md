# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [1.0.0-rc.1] — 2026-11-12

Release candidate de v1.0 (Hitos 3 a 6). La versión 1.0.0 se publicará cuando una corrida E2E con Claude real haya pasado por las tres rutas.

### Agregado

- **Revisión independiente con Codex (H3).**
  - Detección: versión, login y flags requeridos.
  - Adapter read-only (`codex exec --sandbox read-only --output-schema`) con timeout y logs.
  - Comprobación de que Codex no modificó archivos.
  - Adjudicación obligatoria de cada hallazgo por Claude: `CONFIRMED`, `FALSE_POSITIVE`, `NEEDS_INVESTIGATION` o `UNVERIFIABLE`.
  - Si el riesgo es HIGH y Codex no está disponible, hay que aprobar un fallback: una revisión de Claude en contexto limpio, o renunciar a la revisión.
- **Gates, estado y recuperación (H4).**
  - `state.json` con las fases de cada ruta y transiciones validadas por código.
  - Gates de tests, lint, typecheck, review, revisión independiente, gate humano y resumen.
  - Reintentos acotados y configurables, con escalamiento de modelo.
  - Excepciones explícitas para hallazgos bloqueantes.
  - Reanudación con `--resume <run_id> [--proposal n | --approve]`.
  - Detección de commits externos y de cambios previos del desarrollador sobre los archivos del plan.
  - Los comandos del proyecto se ejecutan solo si el desarrollador los aprobó una vez para ese proyecto.
- **Modelos y telemetría (H5).**
  - Tiers y perfiles (`balanced`, `economy`, `quality`, o perfiles propios) y flag `--profile`.
  - `event`, `report` (`report.json` y `report.md`) y `compare` para comparar perfiles sobre las mismas tareas.
  - Script `tests/e2e/run-eval.sh` con un set fijo de 6 tareas.
- **Distribución (H6).**
  - `marketplace.json`: se instala con `claude plugin marketplace add` y `claude plugin install`.
  - Configuración global (`~/.claude/agentship/config.json`) y por proyecto (`agentship.config.json`). El proyecto solo puede endurecer la política.
  - Comandos `config` y `doctor`.
  - Test de instalación, actualización y desinstalación en un `CLAUDE_CONFIG_DIR` aislado.
  - Documentación de compatibilidad.

### Corregido (E2E con Claude real)

- Codex podía devolver `ok` sin haber revisado nada cuando su sandbox no podía lanzar procesos (Windows). Ahora el diff y el contexto van en el prompt, y se exige `coverage: complete`; si no, el estado es `incomplete`.
- Carrera al aprobar comandos desde ejecuciones paralelas: ahora hay un archivo por proyecto con escritura atómica.
- Responder preguntas desde otra sesión: `phase <p> wait` y `--resume <id> <respuestas>`.
- La skill da el formato JSON de revisión a los especialistas, y la telemetría registra el effort.

### Cambiado

- `approve`, `approve-command` y `exception` ya no están pre-autorizados en la skill. Claude Code le pide permiso al desarrollador antes de cada uno.
- `default-models.json` pasa a la versión 3 (tiers, perfiles y escalamiento).

## [0.2.0] — 2026-11-12

### Agregado

- Fase de Propuestas (H2.7), motor de fases nativo (H2.8) y registro de especialistas por dominio (H2.9).

### Eliminado

- Integración con GSD Core.

## [0.1.0] — 2026-10-29

### Agregado

- Hito 2: plugin, clasificador, política de routing determinista y workflows SMALL, MEDIUM y LARGE.
