# Workflows

## Política de routing

Las reglas se aplican en este orden. La implementación está en `src/routing/policy.ts` y los tests en `tests/unit/routing.test.ts`.

1. Si la petición, la configuración o la clasificación son inválidas o faltan → `error`, sin ruta.
2. `risk` = el mayor entre el del clasificador, el `domain_min_risk` de cada dominio detectado y `HIGH` si se pasó `--risk high`.
3. `route` = la mayor entre `complexity`, `recommended_workflow` y `risk_floor[risk]` (HIGH → LARGE).
4. Si la confianza es LOW → `discovery`. Si sigue en LOW después del discovery → `clarify`. Ni un override ni `--proposals` se saltan este paso.
5. Override `--route`:
   - si sube la ruta, se aplica;
   - si la baja y el riesgo no es HIGH, se aplica;
   - si la baja con riesgo HIGH y sin `--confirm-downgrade` → `confirm_downgrade`;
   - si la baja con riesgo HIGH y con confirmación, se aplica con un mínimo de MEDIUM.
6. Si corresponde la fase de propuestas → `propose`. Corresponde con `--proposals`, o si no se pasó `--no-proposals` y se cumple alguna de estas condiciones: ruta ≥ MEDIUM, confianza < HIGH, o `multiple_approaches`.
7. En cualquier otro caso → `proceed`, y `state.json` queda fijado con las fases de la ruta.

## Fase de propuestas

1. Los especialistas de research de cada dominio analizan la tarea.
2. `agentship:proposer` ofrece de 1 a 3 enfoques. Cada uno trae alcance, trade-offs y su propia clasificación, y exactamente uno viene recomendado.
3. El desarrollador elige y `select` vuelve a aplicar la política:
   - la ruta puede bajar;
   - el riesgo nunca baja del que encontró el análisis.
4. Se puede continuar más tarde con `--resume <run_id> --proposal <n>`.

## Fases por ruta y sus gates

Toda fase se ejecuta como `phase start` → trabajo → `phase done`. El `done` solo se registra si su gate se cumple, y las fases deben correr en orden.

| Fase | SMALL | MEDIUM | LARGE | Gate para cerrarla |
|---|---|---|---|---|
| discovery | | ✓ | ✓ | existe `discovery.md` (se puede saltar con un motivo) |
| research | | | ✓ | existe `specialists-research.md` (se puede saltar si no hay dominios) |
| requirements | | | ✓ | existe `requirements.md` |
| plan | | ✓ | ✓ | `plan-check` validó `plan.json` (MEDIUM: como máximo 2 waves) |
| human_gate | | | ✓ | el desarrollador aprobó el plan (`approve human_gate` o `--resume … --approve`) |
| implement | ✓ | ✓ | ✓ | **para empezar:** `tree-check` sin errores y, en LARGE, el gate humano aprobado |
| test | ✓ | ✓ | ✓ | el último `run test` pasó; lint y typecheck pasan si están declarados y aprobados |
| review | | ✓ | ✓ | en la última ronda no queda ningún hallazgo HIGH ni criterio `NOT_MET` sin excepción |
| independent_review | | ✓ | ✓ | Codex `ok` y hallazgos adjudicados sin bloqueantes, o un fallback aprobado. Solo se puede saltar si no es obligatorio. |
| uat | | | ✓ | existe `uat.md` |
| summary | ✓ | ✓ | ✓ | existe `summary.md` y se vuelven a comprobar tests, review y revisión independiente |

Cuando un gate no se cumple, la ejecución queda en estado `blocked`. Nunca se reporta como éxito.

## Reintentos

`retry <run_dir> <clave>` lleva la cuenta y aplica el límite. Cuando se alcanza, la skill se detiene y reporta.

| Clave | Límite (configurable) | Uso |
|---|---|---|
| `tests:<label>` | `retries.tests_per_wave` = 2 | Arreglar tests que fallan. Con `--role implementer` devuelve el modelo escalado. |
| `review` | `retries.review_rounds` = 1 | Rondas de corrección después de una revisión bloqueante |
| `llm:<agente>` | `retries.llm_output` = 1 | JSON inválido del clasificador, proposer, planner, etc. |

## Revisión independiente (Codex)

- **Cuándo:** es obligatoria si el riesgo es ≥ `required_at_risk` (HIGH por defecto). Se ofrece en `offered_on_routes` (LARGE por defecto).
- **Cómo:** `codex exec --sandbox read-only` revisa `diff.patch` contra el plan y los requisitos. Evalúa correctitud, seguridad, concurrencia, regresiones, contratos, tests y requisitos. Devuelve JSON validado por schema.
- **Adjudicación:** Claude verifica cada hallazgo y lo marca como `CONFIRMED`, `FALSE_POSITIVE`, `NEEDS_INVESTIGATION` o `UNVERIFIABLE`. Bloquean los HIGH confirmados y sin resolver, y los HIGH que quedan en `NEEDS_INVESTIGATION`.
- **Errores:** un timeout, un error, una salida inválida o que Codex modifique archivos **nunca** cuentan como aprobado. Si la revisión es obligatoria, el desarrollador decide entre un fallback de Claude en contexto limpio (`fallback_reviewer`) o renunciar a ella, y la decisión queda registrada.

## Recuperación

- `start` guarda la línea base de git: HEAD, rama y archivos que ya tenían cambios.
- `tree-check` bloquea si HEAD o la rama cambiaron, o si el plan toca archivos que el desarrollador ya había modificado.
- `/agentship:dev --resume <run_id>` retoma en la siguiente fase pendiente y reutiliza los artefactos, sin repetir el discovery.

## Lo que AgentShip no hace

- Commits, push, PR, merge o deploy.
- Ejecutar comandos que el desarrollador no haya aprobado.
- Instalar dependencias o especialistas por su cuenta.
