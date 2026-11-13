# Compatibilidad

| Entorno | Estado | Notas |
|---|---|---|
| Windows 11 + Git Bash, Claude Code CLI | **Verificado** (tests, validate, instalación aislada, Codex real) | El shim `codex.cmd` de npm se ejecuta a través del shell con argumentos citados; nunca recibe texto del ticket. Los timeouts matan el árbol de procesos completo con `taskkill /T`. |
| Claude Code Desktop (sesiones locales) | Esperado | Usa el mismo plugin y la misma skill. No se ha probado aparte. |
| WSL2 | Esperado | Es Linux. El plugin y Codex tienen que estar instalados **dentro** de WSL, y `CLAUDE_CONFIG_DIR` es el de WSL. |
| macOS / Linux | Esperado | Sin código específico de plataforma, salvo el `taskkill` de Windows. |

## Requisitos

| Dependencia | Versión | Si falta |
|---|---|---|
| Node.js | ≥ 22.18 (ejecuta TypeScript sin build) | La skill muestra `AgentShip CLI failed to start` |
| Claude Code | ≥ 2.1.292 (probado con 2.1.312) | — |
| git | cualquiera reciente | Sin git no hay diff para las revisiones ni detección de cambios externos; `doctor` lo avisa |
| Codex CLI | opcional; probado con 0.145.0 (necesita `--sandbox`, `--output-schema`, `--output-last-message`, `--ephemeral` y `--cd`) | Las ejecuciones HIGH piden aprobar un fallback; `doctor` muestra el motivo |
| Especialistas (VoltAgent, etc.) | opcionales | Se usa `general-purpose` con el checklist del dominio |

## Diferencias conocidas

- **Modelo de Codex:** Codex usa el modelo de `~/.codex/config.toml`. Si tu cuenta no admite ese modelo (por ejemplo, un modelo de API con una cuenta de ChatGPT), la revisión falla con un mensaje claro. Configura `codex.model` en AgentShip, por ejemplo con `"gpt-5.6-sol"`, sin tocar la configuración de Codex.
- **Sandbox de Codex en Windows:** el sandbox read-only no puede lanzar procesos ("Access is denied"). Por eso AgentShip le pasa el diff, la tarea, los criterios y los requisitos **dentro del prompt**, y exige que Codex declare `coverage`. Si no revisó todo, el estado es `incomplete`, que nunca cuenta como revisión aprobada.
- **Duración de Codex:** una revisión real tarda varios minutos (la prueba sobre un proyecto de juguete tardó unos 5). El timeout por defecto es de 900 s.
- **Effort de los especialistas externos:** el Agent tool solo admite el modelo como override. El effort de un especialista externo es el que declare en su frontmatter.
- **Rutas largas en Windows:** usa directorios cortos para los fixtures de E2E (ver troubleshooting).
