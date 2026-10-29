# Configuración (v0.1)

En v0.1 la configuración es la que viene con el plugin. Los overrides por repositorio corresponden al Hito 6.

## `config/default-policies.json`

| Clave | Default | Significado |
|---|---|---|
| `risk_floor.{LOW,MEDIUM,HIGH}` | `SMALL`, `SMALL`, `LARGE` | Ruta mínima según el riesgo |
| `high_risk_confirmed_downgrade_floor` | `MEDIUM` | Mínimo para una tarea HIGH aunque se confirme bajarla |
| `low_confidence` | `discovery` → `clarify` | Documenta el comportamiento ante confianza LOW, que está fijado en el código |

## `config/default-models.json`

Roles → `{runtime, model, effort}`. Se usan alias (`sonnet`, `opus`), nunca IDs fijos. Son hipótesis iniciales (plan §6.1), no resultados de un benchmark.

| Rol | Modelo | Effort | Dónde se aplica en v0.1 |
|---|---|---|---|
| classifier | sonnet | low | Frontmatter del agente y la llamada al agente |
| discovery | sonnet | low | Llamada al agente `Explore` cuando la confianza es LOW |
| implementer (SMALL) | sonnet | medium | Frontmatter de la skill (`model`/`effort` del turno) |
| planner / architect | opus | high | Los gestiona GSD (`model_profile`) |
| demás | — | — | Reservados para hitos posteriores |

### Traducción a GSD

La sección `gsd` sugiere los valores para `.planning/config.json` del proyecto. AgentShip **no escribe** ese archivo; para aplicarlos, usa `/gsd-settings` o `gsd-tools config-set`:

- `model_profile: balanced`: con GSD 1.19.0 resuelve el planner a Opus y el executor y el verifier a Sonnet (verificado con `gsd-tools init quick`).
- `models.planning: opus` y el resto de fases en `sonnet` (claves `models.<phase_type>`, documentadas en GSD v1.40+).

## Variables de entorno

| Variable | Uso |
|---|---|
| `CLAUDE_CONFIG_DIR` | Directorio de usuario de Claude Code. AgentShip lo usa para detectar GSD instalado de forma global o como plugin. Default: `~/.claude`. |
| `CLAUDE_PLUGIN_ROOT` | Lo define Claude Code; la skill lo usa para invocar `src/cli.ts`. |
