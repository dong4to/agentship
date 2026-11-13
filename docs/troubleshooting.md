# Troubleshooting

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `/agentship:dev` no aparece | El plugin no está cargado | Arranca con `claude --plugin-dir <ruta>` o, si la sesión ya estaba abierta, usa `/reload-plugins`. Comprueba con `claude plugin validate <ruta>`. |
| La skill muestra `AgentShip CLI failed to start` | No hay `node` en el `PATH`, o la versión es < 22.18 | `node --version`. Hace falta ≥ 22.18 para ejecutar TypeScript sin build. |
| La ruta sale `error` | El clasificador devolvió JSON inválido o incompleto, o un flag no es válido | Mira `errors` en `decision.json`. AgentShip reintenta una vez y después se detiene; nunca cae en SMALL. |
| `confirm_downgrade` | Pediste bajar de ruta una tarea HIGH | Re-ejecuta con `--confirm-downgrade`. El mínimo es MEDIUM. |
| Siempre aparecen propuestas | La ruta es ≥ MEDIUM, la confianza no es HIGH o hay varios enfoques válidos | Usa `--no-proposals` si ya sabes qué enfoque quieres. |
| La ejecución se detuvo esperando una propuesta (headless) | En modo `-p` no hay a quién preguntar | `/agentship:dev --resume <run_id> --proposal <n>`. El `run_id` es el nombre de la carpeta en `.agentship/runs/`. |
| `run … has no proposals.json to resume` | El `run_id` no corresponde a una ejecución que se haya detenido en las propuestas | Revisa la carpeta en `.agentship/runs/`. |
| El riesgo sube solo a HIGH o MEDIUM | El clasificador detectó un dominio con riesgo mínimo (payments, auth, accounting…) | Es intencional (`domain_min_risk`). Mira `reasons` en `decision.json`. |
| `agents.json` muestra `agent: null` | No hay instalado ningún especialista de ese dominio | Se usa `general-purpose` con el checklist del dominio. Para tener especialistas, consulta [configuración](configuration.md#especialistas). |
| `plan-check` falla con "at most 2 wave(s)" | El planner partió una tarea MEDIUM en demasiadas waves | La skill le pide un nuevo plan una vez. Si la tarea de verdad es grande, re-ejecútala con `--route large`. |
| `needs: approval` al correr tests | El comando del proyecto aún no fue aprobado para este proyecto | La skill te muestra el comando y te pregunta. Claude Code también te pide permiso para `approve-command`. Si el comando cambia, hay que aprobarlo de nuevo. |
| `needs: declaration` | El proyecto no declara un comando de tests | Agrega `commands.test` a `agentship.config.json` o `scripts.test` a `package.json`. |
| `phase … done` devuelve errores y el estado es `blocked` | Un gate no se cumple (tests, review, Codex, artefacto faltante) | Lee `errors`: dicen qué falta. Ninguna ruta reporta éxito con un gate abierto. |
| `retry limit reached` | Se agotaron los reintentos configurados | La skill se detiene y reporta. Puedes subir `retries.*` en tu config de usuario (máximo 5). |
| `tree-check` falla | HEAD o la rama cambiaron desde el inicio, o el plan toca archivos que ya tenías modificados | Revisa qué pasó. AgentShip no sobrescribe tu trabajo; confirma con el desarrollador antes de seguir. |
| Codex `error` con "model … is not supported" | El modelo de `~/.codex/config.toml` no está disponible para tu cuenta | Configura `codex.model` en `~/.claude/agentship/config.json` con un modelo admitido, por ejemplo `"gpt-5.6-sol"`. |
| Codex `unavailable` | No está instalado, no tiene sesión iniciada o le faltan flags | `node src/cli.ts doctor` muestra el motivo. En HIGH tendrás que aprobar un fallback. |
| Codex `timeout` | La revisión superó `codex.timeout_seconds` | Súbelo (máximo 3600) o aprueba el fallback. |
| Codex `modified_files` | El working tree cambió mientras Codex revisaba | Se descarta su revisión. Repite la revisión sin editar archivos mientras corre. |
| `config_errors` al iniciar | Configuración de usuario o de proyecto inválida, o un proyecto intentando relajar la política | `node src/cli.ts config --project <dir>` muestra cada error. |
| Retomar en otra sesión | — | `/agentship:dev --resume <run_id>`, `--resume <run_id> --proposal <n>` o `--resume <run_id> --approve` (gate humano). El `run_id` es la carpeta en `.agentship/runs/`. |
| Write o Edit denegados con "… which is a sensitive file" | Con `--plugin-dir`, Claude Code protege todo lo que está bajo la raíz del plugin. Un proyecto dentro del repo de AgentShip no se puede editar. | Ejecuta AgentShip sobre proyectos que estén fuera del directorio del plugin. Los fixtures E2E van en `%TEMP%`, no dentro del repo. |
| La E2E en Windows falla con "path longer than allowed" | El directorio temporal tiene una ruta demasiado larga para Win32 | Usa un directorio corto fuera del repo, por ejemplo `/tmp/as-e2e` en Git Bash. |
| Avisos LF/CRLF de git en Windows | Git convierte finales de línea con `core.autocrlf` | Son solo informativos; no afectan a AgentShip. |
