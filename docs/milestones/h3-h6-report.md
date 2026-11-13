# Hitos 3 a 6: reporte de entrega (AgentShip 1.0.0-rc.1)

Fecha: 2026-11-12 · Rama: `feat/h2-proposals-native-engine` · Sin push.

## Entorno verificado

| Elemento | Versión / estado |
|---|---|
| SO | Windows 11, Git Bash |
| Node | v22.21.1 |
| Codex CLI | 0.145.0, con sesión de ChatGPT iniciada |
| Configuración global | Sin cambios. Las pruebas de instalación usaron un `CLAUDE_CONFIG_DIR` temporal. |

## Qué se entregó por hito

### H3: Revisión independiente con Codex

- `src/integrations/codex/codex.ts`:
  - Detección: `--version`, `login status` y los flags de `exec --help` (no se asumen).
  - Adapter: `codex exec --sandbox read-only --cd <proyecto> --ephemeral --output-schema config/codex-review.schema.json --output-last-message <archivo> -`, con el prompt por stdin.
  - Timeout que mata el árbol de procesos.
  - Captura de stdout y stderr en `run_dir`.
  - Huella del working tree antes y después: si Codex modifica algo, el resultado es `modified_files` y la revisión se descarta.
- Estados normalizados: `ok`, `unavailable`, `disabled`, `timeout`, `error`, `invalid_output` y `modified_files`. Solo `ok` puede satisfacer el gate.
- Adjudicación: cada hallazgo necesita un veredicto (`CONFIRMED`, `FALSE_POSITIVE`, `NEEDS_INVESTIGATION` o `UNVERIFIABLE`) con su razonamiento. Bloquean los HIGH confirmados y sin resolver, y los HIGH en `NEEDS_INVESTIGATION`.
- Riesgo HIGH sin Codex: el desarrollador aprueba un fallback, que puede ser una revisión de Claude en contexto limpio (que también tiene que pasar) o la renuncia explícita.

### H4: Gates, seguridad y recuperación

- `state.json`:
  - fases por ruta, con orden obligatorio;
  - gates de inicio (`tree-check`, y el gate humano en LARGE);
  - gates de cierre (artefactos, tests, lint y typecheck, review, revisión independiente, summary);
  - estado `blocked` cuando falla un gate.
- Reintentos acotados (`tests:<label>`, `review` y `llm:<agente>`) con escalamiento de modelo.
- Comandos del proyecto: se ejecutan solo si están declarados y el desarrollador aprobó **esa línea exacta** para **ese proyecto**. La aprobación se guarda fuera del repo.
- `approve`, `approve-command` y `exception` no están en `allowed-tools`, así que Claude Code muestra un prompt de permisos para cada uno.
- Recuperación:
  - línea base de git (HEAD, rama y archivos ya modificados);
  - `tree-check` detecta commits externos y cambios del desarrollador sobre los archivos del plan;
  - `--resume <run_id>` retoma en la fase pendiente, y `--approve` aprueba el gate humano desde otra sesión.
- CI básica: no se agregó un workflow de GitHub Actions porque implicaría publicar en el remoto. `npm run check` es el gate local (ver "Pendiente").

### H5: Modelos, contexto y telemetría

- Tiers y perfiles (`balanced`, `economy`, `quality` y perfiles propios), `--profile` y escalamiento. Siempre con aliases, nunca con IDs.
- `event`, `report` (`report.json` y `report.md`) y `compare` (por perfil y por tarea). Los tokens se registran solo si el runtime los reporta; nunca se estiman ni se convierten a dinero.
- `tests/e2e/run-eval.sh`: 6 tareas fijas (bug, feature, arquitectura, seguridad, concurrencia y regresión), ejecutadas una vez por perfil y comparadas al final.

### H6: Distribución y madurez

- `.claude-plugin/marketplace.json`: se instala con `claude plugin marketplace add` y `claude plugin install agentship@agentship`.
- Configuración de usuario (`~/.claude/agentship/config.json`) y de proyecto (`agentship.config.json`). El proyecto solo puede endurecer la política y es el único que declara comandos.
- `config` y `doctor`, que dan mensajes claros cuando falta Node, git, Codex, la configuración o el comando de tests.
- `tests/e2e/install-test.sh`: instalación, carga, `doctor` sobre la copia instalada, actualización y desinstalación, todo en un `CLAUDE_CONFIG_DIR` aislado.
- CHANGELOG, versionado semántico (`1.0.0-rc.1`) y documentación de compatibilidad.

## Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| `npm run check`: `tsc`, `node --test` y `claude plugin validate --strict` | **Pasa.** El conteo de tests está en la salida del commit. |
| Flujos completos del CLI sobre un repo git temporal (`tests/integration/workflow.test.ts`): ruta MEDIUM completa; tests que fallan, bloquean y agotan los reintentos; excepción explícita; HIGH sin Codex con fallback; Codex que falla de 5 maneras distintas más un timeout; gate humano y reanudación con `--approve`; cambios externos; configuración inválida | **Pasa** |
| **Codex real** (0.145.0) sobre un proyecto de juguete con un bug conocido | **Pasa** con `codex.model = gpt-5.6-sol`: un hallazgo HIGH correcto con evidencia, sin modificar archivos, en unos 5 minutos. El primer intento falló porque `~/.codex/config.toml` usa `gpt-6.1-sol`, que la cuenta de ChatGPT no admite. AgentShip lo reportó como `error` (nunca como aprobado) y ahora muestra la causa. |
| `tests/e2e/install-test.sh` | **Pasa**: marketplace add, install, list, doctor, update y uninstall |

## E2E con Claude real (2026-11-13)

Se usó el fixture `examples/sample-project`, con un clon por tarea fuera del repo. Claude Code 2.1.312 corrió en modo headless (`claude -p`) con el plugin cargado por `--plugin-dir`. Las respuestas a las preguntas y la aprobación del gate las dio el harness: es un proyecto de juguete.

| Tarea | Ruta | Resultado |
|---|---|---|
| Clamp de `applyDiscount` | SMALL / LOW | **done** en 49 s: implement → test → summary. Test nuevo, `npm test` en verde. |
| Estados de órdenes | MEDIUM / LOW | **done** en 196 s: plan con Opus, 2 waves, tests por wave, review PASS (2 hallazgos LOW). La telemetría registró 52 k tokens reportados por agente. |
| Store asíncrono y enchufable | LARGE / MEDIUM | Se detuvo en *requirements* con 5 preguntas de diseño. Con `--resume <id> <respuestas>` llegó al **gate humano** (4 waves, 25 criterios). Con `--resume <id> --approve` quedó **done** en 310 s: 59 tests, review con 25 de 25 criterios, UAT. |
| `owner` pasa `isAdmin` | LARGE / **HIGH** (auth, security, payments) | Especialistas de research con Opus (`general-purpose`, porque no hay agentes instalados). Detectó un hueco previo: `canRefund(null, {})` devolvía `true`. Pasó por el gate humano y quedó **done** en 394 s. **Codex encontró un bug HIGH real** (owner sin id podía reembolsar). Claude lo adjudicó como CONFIRMED, se corrigió con 6 tests y el gate lo verificó. |

### Problemas que encontró la E2E (ya corregidos)

1. **Codex respondía "ok" sin haber revisado nada.** En Windows, su sandbox read-only no puede lanzar procesos ("Access is denied"). En la tarea LARGE devolvió 0 hallazgos sin haber leído el diff. Se corrigió así:
   - el diff, la tarea, los criterios y los requisitos van **dentro del prompt**;
   - el schema exige `coverage`, `limitations` y `reviewed_files`, y cualquier `coverage` distinta de `complete` da el estado `incomplete`, que nunca satisface el gate.

   Al repetirlo con Codex real, revisó los 15 archivos (`coverage: complete`) y reportó 2 hallazgos MEDIUM válidos, a pesar de que el sandbox seguía fallando.
2. **Carrera en las aprobaciones de comandos.** 4 ejecuciones en paralelo reescribían el mismo archivo, y una aprobación se perdió. Ahora hay un archivo por proyecto, escrito de forma atómica, con un test de concurrencia.
3. **No se podía responder preguntas desde otra sesión.** Se agregaron `phase <p> wait` y `--resume <id> <respuestas>`, que guarda las respuestas en `answers-N.md`.
4. **El formato de revisión de los especialistas.** La skill ahora les da el JSON exacto (antes fallaban una vez y se reintentaba).
5. **El effort faltaba en la telemetría.** Ahora se toma del rol.

### Observaciones (no son bugs de AgentShip)

- En los permisos headless de la E2E, el `implementer` no siempre pudo ejecutar tests desde su shell. AgentShip los corrió igual a través de `cli run`, que es la evidencia que cuentan los gates.
- En HIGH-risk, la corrección pedida por Codex llegó después de las revisiones interna y de especialistas, que no se volvieron a ejecutar. El gate solo exige tests en verde y la adjudicación resuelta.

## Pendiente (no se hizo)

- La **evaluación de perfiles** (`run-eval.sh`), que consume modelos.
- **LICENSE** e **icono**: son decisiones del dueño del repo. `validate` los avisa, pero no bloquean.
- **Workflow de CI en GitHub:** requiere push.
- **Worktrees para cambios concurrentes:** AgentShip ejecuta las waves en serie, así que hoy no hacen falta.
