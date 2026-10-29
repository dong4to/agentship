# Workflows (v0.1)

## Política de routing

Las reglas se aplican en este orden. La implementación está en `src/routing/policy.ts` y los tests en `tests/unit/routing.test.ts`.

1. Si la petición o la clasificación son inválidas o faltan → `error`, sin ruta.
2. `risk` = `HIGH` si se pasó `--risk high`; en otro caso, el que dio el clasificador.
3. `route` = la mayor entre `complexity`, `recommended_workflow` y `risk_floor[risk]` (HIGH → LARGE).
4. Si la confianza es LOW → `discovery`. Si sigue en LOW después del discovery → `clarify`. Un override no se salta este paso.
5. Override `--route`:
   - si sube la ruta, se aplica;
   - si la baja y el riesgo no es HIGH, se aplica;
   - si la baja con riesgo HIGH y sin `--confirm-downgrade` → `confirm_downgrade`;
   - si la baja con riesgo HIGH y con confirmación, se aplica con un mínimo de MEDIUM.
6. En cualquier otro caso → `proceed`.

## SMALL — Claude directo

Lee solo los módulos afectados, hace el cambio mínimo y añade un test. Después corre el comando de tests **que el proyecto declara** (`scripts.test`, `Makefile`, `CLAUDE.md`/`README`); si no hay ninguno, pregunta. Si fallan los tests, reintenta como máximo 2 veces y luego reporta el fallo. Termina con `tests.log` y `summary.md`. No hace commit ni abre PR.

## MEDIUM — GSD Quick

Invoca `<gsd.commands.quick> --research --validate <tarea + contexto>`. GSD investiga, planifica con Opus, ejecuta con Sonnet en commits atómicos y verifica. Al terminar, AgentShip corre los tests del proyecto y escribe `summary.md`.

Dentro de un workflow de GSD, AgentShip no interfiere con su procedimiento: las llamadas a `gsd-tools`, las actualizaciones de `.planning/` y los **commits atómicos locales** son parte de GSD y se ejecutan tal cual. AgentShip nunca hace push. En SMALL no hay commits.

Prerrequisitos (GSD Core 1.19.0): GSD instalado y `.planning/ROADMAP.md` presente. `/gsd-quick` se niega a correr sin ese archivo. Si falta alguno, AgentShip se detiene y explica qué hacer; nunca baja a SMALL por su cuenta.

## LARGE / HIGH-RISK — ciclo de fases de GSD

1. `/gsd-phase "<nombre>"` añade una fase al roadmap.
2. `/gsd-discuss-phase N` registra requisitos y decisiones.
3. `/gsd-plan-phase N` hace investigación, plan y verificación del plan.
4. **Gate humano:** resumen del plan en `gate.md` con `status: waiting-approval`. AgentShip se detiene y espera una aprobación explícita.
5. Con la aprobación: `/gsd-execute-phase N` y luego `/gsd-verify-work N`.
6. Tests del proyecto y `summary.md`. Si el riesgo es HIGH, el resumen indica que todavía falta una revisión independiente (Hito 3).

## Lo que v0.1 todavía no hace

- Revisión independiente con Codex y adjudicación (Hito 3).
- Gates persistentes validados por código, reanudación de ejecuciones y límites de reintento configurables (Hito 4). El gate de LARGE existe, pero lo hace cumplir la skill, no el código.
- Telemetría y comparación de perfiles de modelo (Hito 5).
- Configuración por repositorio, instalación desde un marketplace y release (Hito 6).
