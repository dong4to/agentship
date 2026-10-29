# Hito 2 — Reporte de entrega (AgentShip v0.1)

Fecha: 2026-10-29 · Rama: `feat/h2-classification-routing` · Repo: [dong4to/agentship](https://github.com/dong4to/agentship) (privado, sin push)

## 1. Entorno verificado

| Elemento | Versión / estado |
|---|---|
| SO | Windows 11 Pro 10.0.26200, con Git Bash |
| Claude Code | 2.1.312 |
| Node / npm | v22.21.1 / 10.9.4 (TypeScript se ejecuta sin build) |
| TypeScript (dev) | 7.0.2 |
| Git | 2.51.0 |
| GSD Core | 1.19.0, instalado **solo de forma local en el fixture E2E** (no en `~/.claude`) |
| Configuración global | Sin cambios. Las corridas E2E usaron `--setting-sources project,local` para excluir los plugins y hooks del usuario. |

## 2. Archivos creados

```text
.claude-plugin/plugin.json          manifiesto (namespace agentship)
skills/dev/SKILL.md                 /agentship:dev (orquestador)
agents/complexity-classifier.md     clasificador de solo lectura (sonnet, low)
config/default-models.json          roles → modelo/effort + traducción sugerida a GSD
config/default-policies.json        pisos de riesgo y downgrade
src/cli.ts                          start | route | detect
src/routing/{classification,policy,request}.ts
src/integrations/gsd/detect.ts
tests/unit/{routing,detect}.test.ts
tests/integration/cli.test.ts
tests/fixtures/classifier/*         7 salidas del clasificador (4 rutas, LOW, inválida, con fence)
tests/e2e/{setup-fixture.sh,run-e2e.sh,planning-seed/*}
examples/sample-project/            fixture: carts, orders, auth, store + 8 tests
docs/{architecture,workflows,configuration,troubleshooting}.md
README.md, IMPLEMENTATION_PLAN.md, package.json, tsconfig.json, .gitignore
```

## 3. Decisiones técnicas

1. **Sin dependencias en runtime.** Node ≥ 22.18 quita los tipos al vuelo (`erasableSyntaxOnly`). Los tests usan `node:test` y la única dependencia de desarrollo es `typescript` (más `@types/node`).
2. **El LLM clasifica y el código decide.** La salida del clasificador se valida (`classification.ts`) y la ruta la fija `policy.ts`, que es una función pura y testeada.
3. **El texto del ticket nunca pasa por el shell.** Se escribe con la herramienta Write en `request.txt` y el CLI lo lee como archivo. Hay un test con `$(...)`, backticks y `;`.
4. **HIGH nunca corre como SMALL**, ni siquiera con `--confirm-downgrade`: el mínimo es MEDIUM. Esto cumple a la vez "un downgrade de HIGH requiere aprobación" y "HIGH nunca toma SMALL".
5. **El namespace de GSD se detecta en tiempo de ejecución.** Con el instalador npm es `/gsd-quick`; como plugin es `/gsd-core:gsd-quick`. La documentación de GSD se contradice en este punto.
6. **Mapeo final a GSD 1.19.0:** MEDIUM → `/gsd-quick --research --validate`. LARGE → `/gsd-phase` → `discuss-phase` → `plan-phase` → **gate humano** → `execute-phase` → `verify-work`.
7. **AgentShip no interfiere con el procedimiento de GSD.** Dentro de un workflow de GSD se respetan sus llamadas a `gsd-tools`, sus cambios en `.planning/` y sus commits atómicos locales. El "sin commits" aplica a SMALL. Nunca hay push.
8. **Los artefactos van en `<proyecto>/.agentship/runs/<id>/`,** con un `.gitignore` propio (`*`); el `.gitignore` del proyecto no se toca.

### Desviaciones respecto a lo propuesto antes de implementar

| Propuesta | Realidad verificada | Ajuste |
|---|---|---|
| D3: si no hay `.planning`, LARGE usa `/gsd-quick --full` | `/gsd-quick` **también exige `.planning/ROADMAP.md`** (`workflows/quick.md`: "Quick mode requires an active project with ROADMAP.md") | MEDIUM y LARGE se detienen con instrucciones (`/gsd-onboard` o `/gsd-new-project`) si falta el roadmap |
| Fixture E2E dentro del repo (`.e2e/`) | Con `--plugin-dir`, Claude Code marca **todo lo que está bajo la raíz del plugin** como "sensitive file" y deniega las escrituras | Fixture en `%TEMP%\as-e2e`; `setup-fixture.sh` rechaza destinos dentro del repo |
| Corridas E2E con `bypassPermissions` | El clasificador de auto mode lo bloqueó | `acceptEdits` + lista explícita de herramientas, con `git push`, `gh` y `npx` prohibidos |
| Tareas E2E MEDIUM y LARGE originales | El clasificador, razonablemente, valoró el CSV como SMALL y la persistencia como MEDIUM | Se cambiaron las tareas y se calibró el clasificador con una regla explícita para LARGE |

## 4. Comandos utilizados

```bash
gh repo create dong4to/agentship --private        # autorizado por el usuario
git clone https://github.com/dong4to/agentship.git
git switch -c feat/h2-classification-routing
npm i -D typescript @types/node@22
npm run check                                     # tsc + node --test + claude plugin validate --strict
npx -y @opengsd/gsd-core@1.19.0 --claude --local  # solo en el fixture E2E
claude -p "/agentship:dev <tarea>" --plugin-dir <repo> --setting-sources project,local \
  --permission-mode acceptEdits --allowedTools ... --output-format json
```

## 5. Tests ejecutados

### Deterministas (sin LLM): `npm run check`

- `tsc`: 0 errores.
- `node --test`: **36/36**. Cubre la validación del JSON, la política (las 4 rutas, error, discovery/clarify, overrides que suben o bajan la ruta, confirmación de downgrade, y un barrido exhaustivo que comprueba que HIGH nunca da SMALL), los flags de la petición, la detección de GSD (ausente, local, global, plugin, ambos, roadmap) y el CLI end-to-end, incluida la inyección de shell.
- `claude plugin validate . --strict`: **pasa**. Quedan avisos de directorio (sin LICENSE y sin icono) que corresponden al Hito 6.

### Requisito previo del Hito 1

Corrida sin interfaz delegando en `agentship:complexity-classifier`. El plugin carga, el agente con namespace se resuelve y **el subagente corrió en `claude-sonnet-5-5` mientras la sesión principal usaba `claude-opus-5-5`** (`modelUsage`). El effort no se refleja en la salida de `-p`, así que no se pudo verificar.

### E2E con Claude real (Paso D)

Cada caso se ejecutó en un clon nuevo del fixture (sample-project + GSD 1.19.0 local + seed de `.planning`).

| Caso | Clasificador | Decisión | Qué pasó | Evidencia | Costo* |
|---|---|---|---|---|---|
| SMALL: clamp de `applyDiscount` | SMALL / LOW / HIGH | `proceed SMALL` | Claude directo, sin GSD ni agentes extra. Fix + 2 tests; **10/10 pasan**. Sin commit. | `tests.log`, `summary.md` | $0.22 |
| MEDIUM: estados de órdenes | MEDIUM / LOW / HIGH | `proceed MEDIUM` | `/gsd-quick --research --validate`: research → plan (Opus) → ejecución (Sonnet) → verificación. **16/16 pasan** (re-ejecutado de forma independiente). | `tests.log`, `summary.md`, `.planning/quick/…/{RESEARCH,PLAN,SUMMARY,VERIFICATION}.md` | $3.11 |
| LARGE: store async y pluggable (clasificador calibrado) | LARGE / MEDIUM / HIGH | `proceed LARGE` | `/gsd-phase` creó la fase 2 y `discuss-phase` se detuvo con 6 decisiones de diseño para el humano. **Sin cambios de código.** | `decision.json`, `phase.txt`, `.planning/phases/` | $0.81 |
| SMALL de esfuerzo pero HIGH-RISK: `owner` pasa `isAdmin` | SMALL / **HIGH** / HIGH | `proceed LARGE` | La política elevó la tarea a LARGE. El clasificador detectó que `canRefund` depende de `isAdmin`, es decir, que el cambio toca reembolsos. `discuss-phase` se detuvo con 4 preguntas. **Sin cambios de código.** | `decision.json`, `phase.txt` | $0.33 |

\* `total_cost_usd` que reporta Claude Code: es el equivalente en precios de API, no el consumo real de la suscripción (plan §12.4).

Hubo además una corrida de la tarea LARGE con el clasificador **antes** de la calibración. La valoró MEDIUM, entró a GSD Quick y se cortó al alcanzar el **límite de uso de 5 horas** de la cuenta. No cuenta como resultado.

## 6. Criterios de aceptación (§9.3)

| Criterio | Estado |
|---|---|
| El plugin carga correctamente | ✅ `validate --strict` y corridas con `--plugin-dir` |
| La skill puede invocarse | ✅ `/agentship:dev` en las 4 corridas E2E |
| El clasificador devuelve resultados válidos | ✅ las 5 clasificaciones reales pasaron la validación |
| Las políticas se prueban sin LLM | ✅ 36 tests deterministas |
| SMALL evita el workflow completo | ✅ sin GSD ni agentes extra (E2E) |
| MEDIUM utiliza la integración Quick | ✅ `/gsd-quick --research --validate` (E2E) |
| LARGE utiliza el flujo completo disponible | ⚠️ Parcial. Se verificó hasta `discuss-phase`. En modo sin interfaz, discuss se detiene a pedir decisiones, así que `plan-phase`, el gate, `execute` y `verify` **no se ejercitaron de punta a punta**. Hace falta una sesión interactiva. |
| HIGH-RISK nunca toma SMALL | ✅ test exhaustivo + E2E (SMALL/HIGH → LARGE) |
| Se documentan versiones y limitaciones | ✅ este reporte y `docs/` |
| Sin PR ni cambios remotos no autorizados | ✅ solo el repo privado que pediste; sin push, sin PR y sin commits |

## 7. Limitaciones conocidas

- **El gate humano de LARGE lo hace cumplir la skill, no el código.** El estado validado por código llega en el Hito 4.
- **El gate de LARGE no se probó de punta a punta** (ver la tabla anterior).
- **Que se aplique el `effort` no es observable** desde `claude -p`. El modelo sí se verificó.
- **Calibración del clasificador:** es un LLM en effort `low`. La regla añadida para LARGE se verificó con una sola tarea; para evaluarlo en serio hace falta un conjunto fijo de tareas (Hito 5).
- **Para MEDIUM y LARGE, GSD exige un proyecto inicializado.** AgentShip no hace el onboarding por su cuenta.
- **Para usarlo en Claude Code Desktop** hace falta cargar el plugin (skills-dir o `CLAUDE_CODE_PLUGIN_DIRS`). Eso modifica la configuración global y no se hizo sin autorización.
- **Costo de MEDIUM:** con el perfil `balanced` de GSD, el planner en Opus fue ~70% del costo ($2.27 de $3.11). Es candidato a medición en el Hito 5.
- **Falta LICENSE**, porque la elección es tuya.

## 8. Próximos pasos

1. Revisar y hacer commit de este trabajo, y push de la rama si lo autorizas.
2. Probar en sesión interactiva la ruta LARGE completa, incluido el gate.
3. Hito 3 (Codex), solo con tu autorización.
