# Configuración

AgentShip combina tres capas de configuración, en este orden:

| Capa | Archivo | Confianza |
|---|---|---|
| Defaults | `config/*.json` del plugin | — |
| Usuario | `$CLAUDE_CONFIG_DIR/agentship/config.json` (por defecto `~/.claude/agentship/config.json`) | Alta: es tu máquina |
| Proyecto | `<proyecto>/agentship.config.json` | **Baja: es contenido del repositorio.** Solo puede **endurecer** la política, y es el único lugar donde se declaran comandos. |

`node <plugin>/src/cli.ts config --project <dir>` muestra la configuración efectiva y sus errores. Una configuración inválida detiene la ejecución en lugar de usar los defaults en silencio. AgentShip nunca escribe en estos archivos.

## Ejemplo de configuración de usuario

```json
{
  "model_profile": "balanced",
  "codex": { "enabled": "auto", "timeout_seconds": 900, "model": "gpt-5.6-sol" },
  "retries": { "tests_per_wave": 2, "review_rounds": 1, "llm_output": 1 },
  "tiers": { "haiku": { "runtime": "claude", "model": "haiku", "effort": "low" } },
  "profiles": { "mine": { "classifier": "haiku", "planner": "deep" } }
}
```

## Ejemplo de configuración de proyecto (`agentship.config.json`)

```json
{
  "commands": { "test": "npm test", "lint": "npm run lint", "typecheck": "npm run typecheck", "timeout_seconds": 1200 },
  "policies": {
    "domain_min_risk": { "accounting": "HIGH" },
    "independent_review": { "required_at_risk": "MEDIUM" }
  },
  "domains": {
    "tax": {
      "description": "Impuestos y retenciones",
      "agents": { "research": ["tax-*"], "review": ["tax-*"] },
      "checklist": ["Las tasas son datos con fecha de vigencia", "El redondeo sigue la norma local"]
    }
  }
}
```

## Claves

| Clave | Capas | Valores | Default |
|---|---|---|---|
| `model_profile` | usuario, proyecto | nombre de perfil | `balanced` |
| `tiers.<n>` | usuario, proyecto | `{runtime: claude\|codex, model, effort: low…max}` | fast, balanced, strong, reasoning, deep, external |
| `profiles.<n>.<rol>` | usuario, proyecto | nombre de tier | `balanced`, `economy`, `quality` |
| `retries.{tests_per_wave,review_rounds,llm_output}` | usuario, proyecto | 0–5 (intentos extra) | 2, 1, 1 |
| `codex.enabled` | usuario, proyecto | `"auto"`, `true` o `false` | `"auto"` |
| `codex.timeout_seconds` | usuario, proyecto | 30–3600 | 900 |
| `codex.model` | usuario, proyecto | modelo de Codex o `null` (usa el de `~/.codex/config.toml`) | `null` |
| `commands.{test,lint,typecheck}` | **solo proyecto** | una línea | se toman de los scripts de `package.json` |
| `commands.timeout_seconds` | solo proyecto | 10–7200 | 1200 |
| `policies.risk_floor`, `high_risk_confirmed_downgrade_floor`, `domain_min_risk` | usuario; el proyecto solo puede endurecerlas | ver `config/default-policies.json` | |
| `policies.independent_review.required_at_risk` | usuario; el proyecto solo puede bajarlo | `LOW\|MEDIUM\|HIGH` | `HIGH` |
| `policies.independent_review.offered_on_routes` | usuario, proyecto | lista de rutas | `["LARGE"]` |
| `policies.proposals.*` | usuario, proyecto | `max` (1–3) y los disparadores | ver workflows |
| `domains.<n>` | usuario, proyecto | domain pack | 7 dominios |
| `max_specialists_per_phase` | usuario, proyecto | 0–5 | 2 |

## Perfiles de modelos

Cada rol se asigna a un tier dentro de cada perfil, y cada tier se traduce a `{runtime, model, effort}`. Se usan aliases (`sonnet`, `opus`), nunca IDs. Son hipótesis iniciales; compáralas con `tests/e2e/run-eval.sh`.

| Rol | balanced | economy | quality |
|---|---|---|---|
| classifier, discovery | sonnet low | sonnet low | sonnet medium |
| proposer, domain_research | opus medium | sonnet medium | opus high |
| requirements | sonnet medium | sonnet low | sonnet high |
| architect, planner | opus high | opus medium | opus high |
| implementer | sonnet medium | sonnet medium | sonnet high |
| internal_reviewer, domain_review | sonnet high | sonnet medium | opus high |
| fallback_reviewer | opus high | opus medium | opus high |
| independent_reviewer | Codex | Codex | Codex |

**Escalamiento:** después de 2 fallos seguidos en un paso, el `implementer` pasa al tier `deep`. Con el `planner` ocurre después de 1 fallo. Lo devuelve `cli.ts retry … --role <rol>`.

Por ejecución: `/agentship:dev --profile economy <tarea>`.

## Comandos del proyecto y aprobación

AgentShip ejecuta `test`, `lint` y `typecheck` **solo si**:

1. el proyecto los declara (en `agentship.config.json` o en los scripts de `package.json`), y
2. el desarrollador aprobó **esa misma línea de comando** para **ese proyecto**.

Las aprobaciones se guardan en `$CLAUDE_CONFIG_DIR/agentship/approved-commands.json`, fuera del repositorio, así que un repo no puede aprobarse a sí mismo. Si el comando cambia, hay que aprobarlo de nuevo. Además, la skill no tiene pre-autorizado `approve-command`, de modo que Claude Code le pide permiso al desarrollador cada vez.

## Especialistas

Consulta `config/domain-packs.json`. Para agregar especialistas:

- **Del proyecto:** pon agentes en `<proyecto>/.claude/agents/`. Tienen prioridad sobre los demás.
- **Colección VoltAgent:** instala solo las categorías que uses (cada una suma descripciones al contexto de todas las sesiones):

  ```bash
  claude plugin marketplace add VoltAgent/awesome-claude-code-subagents
  claude plugin install voltagent-domains
  ```

## Variables de entorno

| Variable | Uso |
|---|---|
| `CLAUDE_CONFIG_DIR` | Directorio de usuario de Claude Code: configuración de usuario, aprobaciones, agentes y plugins instalados. Default: `~/.claude`. |
| `CLAUDE_PLUGIN_ROOT` | Lo define Claude Code; la skill lo usa para invocar el CLI. |
| `AGENTSHIP_CODEX_BIN` | Ruta a otro ejecutable de Codex. Los tests lo usan para un Codex falso. |
| `AGENTSHIP_EVAL_TASK` | Etiqueta de tarea para la evaluación de perfiles (`run-eval.sh`). |
