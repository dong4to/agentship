# Workflows (v0.2)

## Política de routing

Las reglas se aplican en este orden. La implementación está en `src/routing/policy.ts` y los tests en `tests/unit/routing.test.ts`.

1. Si la petición o la clasificación son inválidas o faltan → `error`, sin ruta.
2. `risk` = el mayor entre el del clasificador, el `domain_min_risk` de cada dominio detectado y `HIGH` si se pasó `--risk high`.
3. `route` = la mayor entre `complexity`, `recommended_workflow` y `risk_floor[risk]` (HIGH → LARGE).
4. Si la confianza es LOW → `discovery`. Si sigue en LOW después del discovery → `clarify`. Ni un override ni `--proposals` se saltan este paso.
5. Override `--route`:
   - si sube la ruta, se aplica;
   - si la baja y el riesgo no es HIGH, se aplica;
   - si la baja con riesgo HIGH y sin `--confirm-downgrade` → `confirm_downgrade`;
   - si la baja con riesgo HIGH y con confirmación, se aplica con un mínimo de MEDIUM.
6. Si corresponde la fase de propuestas → `propose`. Corresponde con `--proposals`, o si no se pasó `--no-proposals` y se cumple alguna de estas condiciones: ruta ≥ MEDIUM, confianza < HIGH, o `multiple_approaches`.
7. En cualquier otro caso → `proceed`.

## Fase de propuestas

1. Los especialistas de research de cada dominio (`cli.ts agents`) analizan la tarea desde su área.
2. `agentship:proposer` (Opus) ofrece de 1 a 3 enfoques que se diferencian de verdad (por ejemplo: un parche local, una corrección de la causa raíz o un rediseño del módulo). Cada uno trae alcance, trade-offs y su propia clasificación, y exactamente uno viene marcado como recomendado.
3. `cli.ts proposals` valida el resultado. El desarrollador elige y `cli.ts select <n>` vuelve a aplicar la política sobre la propuesta elegida:
   - la ruta puede bajar si la propuesta es más acotada;
   - el riesgo nunca baja del que encontró el análisis;
   - los dominios se combinan;
   - no se vuelven a pedir propuestas.
4. En una sesión nueva o en modo headless: `/agentship:dev --resume <run_id> --proposal <n>`.

## SMALL — Claude directo

Lee solo los módulos afectados, hace el cambio mínimo respetando el checklist del dominio y añade un test. Después corre el comando de tests **que el proyecto declara** (`scripts.test`, `Makefile`, `CLAUDE.md`/`README`); si no hay ninguno, pregunta. Si fallan los tests, reintenta como máximo 2 veces y luego reporta el fallo. Termina con `tests.log` y `summary.md`.

## MEDIUM — motor nativo

1. **Discovery** (`Explore`, Sonnet low) → `discovery.md`.
2. **Plan** (`agentship:planner`, Opus) → `plan.txt` → `cli.ts plan-check` (como máximo 2 waves) → `plan.json`. No hay gate humano.
3. **Implementación** (`agentship:implementer`, Sonnet): una wave a la vez, con los tests después de cada una (`tests-wave-N.log`) y hasta 2 reintentos por wave.
4. **Revisión** (`agentship:reviewer` + especialistas de review del dominio) contra los criterios de aceptación y el checklist → `review.md`. Si hay `CHANGES_REQUIRED`, se hace una ronda de corrección y una re-revisión.
5. Tests completos (`tests.log`) y `summary.md`.

## LARGE / HIGH-RISK — motor nativo

1. Discovery.
2. Research de los especialistas de dominio.
3. Requisitos → `requirements.md`. Las preguntas abiertas que cambian el diseño se le hacen al desarrollador.
4. Arquitectura y plan (`agentship:planner`, Opus high), validados con `plan-check`, sin límite de waves.
5. **Gate humano:** `gate.md` con `status: waiting-approval`. AgentShip se detiene hasta recibir aprobación explícita.
6. Waves con tests de integración después de cada una.
7. Revisión interna y de especialistas. Si quedan hallazgos HIGH después de la ronda de corrección, la ejecución se bloquea.
8. UAT: cada criterio de aceptación con su evidencia → `uat.md`.
9. Tests completos y `summary.md`. Si el riesgo es HIGH, el resumen indica que todavía falta una revisión independiente (Hito 3).

Ninguna ruta hace commit, push ni abre PR.

## Lo que v0.2 todavía no hace

- Revisión independiente con Codex y adjudicación (Hito 3).
- Gates persistentes validados por código, reanudación tras el gate humano y límites de reintento configurables (Hito 4).
- Telemetría y comparación de perfiles de modelo (Hito 5).
- Configuración por repositorio, instalación desde un marketplace y release (Hito 6).
