# Configuración (v0.2)

En v0.2 la configuración es la que viene con el plugin. Los overrides por repositorio corresponden al Hito 6.

## `config/default-policies.json`

| Clave | Default | Significado |
|---|---|---|
| `risk_floor.{LOW,MEDIUM,HIGH}` | `SMALL`, `SMALL`, `LARGE` | Ruta mínima según el riesgo |
| `high_risk_confirmed_downgrade_floor` | `MEDIUM` | Mínimo para una tarea HIGH aunque se confirme bajarla |
| `low_confidence` | `discovery` → `clarify` | Documenta el comportamiento ante confianza LOW, que está fijado en el código |
| `domain_min_risk` | security/auth/payments/compliance → HIGH; accounting/data-migrations/infrastructure → MEDIUM | Riesgo mínimo cuando el clasificador marca ese dominio |
| `proposals.max` | `3` | Máximo de propuestas |
| `proposals.trigger_min_route` | `MEDIUM` | Hay propuestas cuando la ruta es al menos esta… |
| `proposals.trigger_confidence_below` | `HIGH` | …o la confianza es menor que esta… |
| `proposals.trigger_on_multiple_approaches` | `true` | …o el clasificador ve más de un enfoque válido |

`--proposals` las fuerza y `--no-proposals` las salta.

## `config/default-models.json`

Roles → `{runtime, model, effort}`. Se usan alias (`sonnet`, `opus`), nunca IDs fijos. Son hipótesis iniciales (plan §6.1), no resultados de un benchmark.

| Rol | Modelo | Effort | Dónde se aplica |
|---|---|---|---|
| classifier | sonnet | low | `agentship:complexity-classifier` |
| discovery | sonnet | low | `Explore` |
| proposer | opus | medium | `agentship:proposer` |
| domain_research | opus | medium | Especialistas de dominio antes de proponer y planificar |
| requirements | sonnet | medium | La skill (LARGE, `requirements.md`) |
| planner / architect | opus | high | `agentship:planner` |
| implementer | sonnet | medium | `agentship:implementer`, una wave a la vez |
| internal_reviewer | sonnet | high | `agentship:reviewer` |
| domain_review | sonnet | high | Especialistas de dominio en la revisión |
| test_triage | sonnet | low | Reservado |

El Agent tool solo admite el modelo como override. El effort se aplica desde el frontmatter de los agentes de AgentShip; en los especialistas externos rige el effort que declaren.

## `config/domain-packs.json`

Por cada dominio define:

- `agents.research` y `agents.review`: los nombres de agentes que se buscan, en orden de preferencia. Admiten el comodín `*`. Los nombres coinciden con los de la colección [VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents), pero sirve cualquier agente con ese nombre en el proyecto, el usuario u otro plugin.
- `checklist`: las reglas que se inyectan en el planner y en el reviewer, haya o no especialista instalado.

`max_specialists_per_phase` (2 por defecto) limita cuántos especialistas se llaman en cada fase, para contener el uso de tokens.

### Agregar especialistas

- **Del proyecto:** pon un agente en `<proyecto>/.claude/agents/`, por ejemplo `acme-accounting-reviewer.md`. Tiene prioridad sobre los demás.
- **Colección VoltAgent:** instala solo las categorías que necesites. Por ejemplo, `voltagent-domains` (fintech, payments, risk), `voltagent-qa-sec` (security) o `voltagent-data-ai` (bases de datos):

  ```bash
  claude plugin marketplace add VoltAgent/awesome-claude-code-subagents
  claude plugin install voltagent-domains
  ```

  Cada categoría instalada suma las descripciones de sus agentes al contexto de todas las sesiones. Conviene instalar pocas.

`node src/cli.ts agents <run_dir>` muestra qué especialista se eligió por dominio y fase, y cuántos agentes se encontraron (`agents_scanned`).

## Variables de entorno

| Variable | Uso |
|---|---|
| `CLAUDE_CONFIG_DIR` | Directorio de usuario de Claude Code. AgentShip lo usa para descubrir los agentes del usuario y los plugins instalados (`plugins/installed_plugins.json`). Default: `~/.claude`. |
| `CLAUDE_PLUGIN_ROOT` | Lo define Claude Code; la skill lo usa para invocar `src/cli.ts`. |
