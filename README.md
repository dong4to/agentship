# AgentShip

**Get it done. Ship it right.**

AgentShip es un plugin de Claude Code que recibe una tarea de desarrollo (ticket, bug, feature o idea), la clasifica por complejidad, riesgo y dominio, propone hasta 3 enfoques cuando conviene y la envía al workflow adecuado:

| Ruta | Cuándo | Qué ejecuta |
|---|---|---|
| **SMALL** | Cambio localizado, requisitos claros, riesgo bajo | Claude directo: implementar → tests → resumen para PR |
| **MEDIUM** | Feature de un módulo, necesita plan breve | discovery → plan (Opus) → waves (Sonnet) → tests → revisión → revisión independiente si aplica |
| **LARGE / HIGH-RISK** | Varios módulos, decisiones nuevas, o cualquier riesgo alto | discovery → requisitos → arquitectura y plan → **aprobación humana** → waves + tests → revisión → **revisión independiente con Codex** → UAT |

Un LLM clasifica la tarea; la ruta final la decide **código determinista y testeado** (`src/routing/policy.ts`). El riesgo HIGH siempre termina en LARGE, una clasificación inválida nunca cae en SMALL, y bajar de ruta una tarea HIGH requiere confirmación explícita.

- **Propuestas:** cuando hay más de un camino razonable, el agente ofrece de 1 a 3 enfoques con su alcance, trade-offs y clasificación. Eliges uno y la ruta se calcula sobre él. Elegir un enfoque más acotado reduce el alcance, nunca el riesgo.
- **Especialistas por dominio:** si la tarea toca contabilidad, pagos, auth, seguridad, etc., AgentShip llama al agente especialista instalado (los tuyos, o colecciones como [VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)) en research y en revisión, con el modelo que corresponde a cada fase, y aplica el checklist del dominio aunque no haya ningún especialista instalado.
- **Gates en código:** cada fase se abre y se cierra a través del CLI, que exige su evidencia: tests que pasan, revisión sin bloqueantes, Codex adjudicado, aprobación humana. Si falta algo, la ejecución queda `blocked`; nunca se reporta como éxito.
- **Revisión independiente con Codex:** Codex revisa el diff en modo read-only. Claude verifica cada hallazgo antes de aceptarlo (confirmado, falso positivo, etc.). En riesgo HIGH es obligatoria, y si Codex no está disponible eres tú quien decide la alternativa.
- **Seguridad:** solo se ejecutan los comandos del proyecto que hayas aprobado. Las aprobaciones siempre pasan por un prompt de permisos, y el repositorio no puede relajar la política.
- **Reanudable y medible:** el estado se guarda en disco (`--resume`), hay perfiles de modelos (`--profile`) y un reporte por ejecución, y se pueden comparar perfiles.

Estado: **1.0.0-rc.1** (Hitos 2 a 6). Ver el [CHANGELOG](CHANGELOG.md), el [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) y el [reporte de los Hitos 3 a 6](docs/milestones/h3-h6-report.md).

## Requisitos

- Claude Code ≥ 2.1.292 (se probó con 2.1.312)
- Node.js ≥ 22.18 en el `PATH` (ejecuta TypeScript sin paso de build)
- git (para el diff de las revisiones y la detección de cambios externos)
- Opcional: [Codex CLI](https://github.com/openai/codex) con sesión iniciada, para la revisión independiente (probado con 0.145.0)
- Opcional: agentes especialistas por dominio (ver [configuración](docs/configuration.md#especialistas))

Plataformas: ver [compatibilidad](docs/compatibility.md).

## Instalación

Como marketplace de plugins (desde un clon o desde GitHub):

```bash
claude plugin marketplace add dong4to/agentship
claude plugin install agentship@agentship
```

Actualizar y desinstalar:

```bash
claude plugin marketplace update agentship
claude plugin update agentship@agentship
claude plugin uninstall agentship@agentship
```

Para comprobar el entorno: `node <ruta-del-plugin>/src/cli.ts doctor --project <tu-proyecto>`.

## Instalación asistida por un agente

Copia este prompt en una sesión de Claude Code abierta en **cualquier carpeta que no sea la de AgentShip**. El agente comprobará los requisitos, instalará el plugin y lo verificará. Antes de cualquier cambio global te pedirá permiso.

```text
Instala y configura el plugin de Claude Code "AgentShip" (repo: https://github.com/dong4to/agentship).
Sigue estos pasos en orden y no avances si uno falla:

1. Requisitos. Comprueba y muéstrame las versiones de:
   - `claude --version` (necesito >= 2.1.292)
   - `node --version` (necesito >= 22.18)
   - `git --version`
   - `gh auth status`, porque el repo es privado
   Si algo falta o es más antiguo, detente y dime cómo actualizarlo. No lo instales por tu cuenta.

2. Modo de carga. Pregúntame cuál prefiero:
   a) Solo por sesión (sin cambios globales): clonar en una carpeta de herramientas, por ejemplo
      `~/tools/agentship`, y arrancar Claude Code con `claude --plugin-dir <ruta>`.
   b) En todas las sesiones, CLI y app de escritorio: clonar directamente en `~/.claude/skills/agentship`.
      Claude Code carga como plugin cualquier carpeta de `~/.claude/skills/` que tenga
      `.claude-plugin/plugin.json`; aparece como `agentship@skills-dir`.
      Esto modifica mi configuración de usuario, así que confirma conmigo antes de hacerlo.
   No clones AgentShip dentro de un proyecto donde vaya a usarlo: Claude Code protege contra
   escritura los archivos que están bajo la raíz de un plugin.

3. Clona con `gh repo clone dong4to/agentship <ruta-elegida>`. Si la ruta ya existe, no la
   sobrescribas: dime qué hay y pregúntame.

4. Valida con `claude plugin validate <ruta-elegida>`. Debe terminar en "Validation passed".
   No hace falta `npm install`, porque AgentShip no tiene dependencias en runtime.

5. Verifica que carga:
   - Opción a: `claude --plugin-dir <ruta-elegida> plugin list`
   - Opción b: `claude plugin list`
   Debe aparecer "agentship" con estado loaded.
   Después ejecuta `node <ruta-elegida>/src/cli.ts doctor --project <mi-proyecto>` y muéstrame el resultado.

6. Especialistas (opcional). Pregúntame si quiero instalar categorías de la colección VoltAgent
   (https://github.com/VoltAgent/awesome-claude-code-subagents). Recomienda pocas, según mis proyectos:
   `voltagent-domains` (fintech, pagos, riesgo), `voltagent-qa-sec` (seguridad), `voltagent-data-ai` (datos).
   Es un cambio global (plugins de usuario): no lo hagas sin mi confirmación explícita.
   Si acepto: `claude plugin marketplace add VoltAgent/awesome-claude-code-subagents` y
   `claude plugin install <categoría>`.

7. Reporta qué instalaste y dónde, qué quedó pendiente, y cómo empezar:
   `/agentship:dev <tarea>`. Si elegí la opción b y la sesión ya estaba abierta, recuerda `/reload-plugins`.

Reglas:
- No modifiques mis CLAUDE.md, mis `settings.json` ni el `.claude/` de mis proyectos.
- No hagas push ni crees repos.
- No uses permisos amplios (`bypassPermissions`).
```

## Uso

Para cargar el plugin en una sesión, sin instalarlo:

```bash
claude --plugin-dir /ruta/a/agentship
```

Dentro de esa sesión:

```text
/agentship:dev applyDiscount acepta porcentajes > 100; limitarlo a 0-100
/agentship:dev --route large migrar sesiones a tokens firmados
/agentship:dev --risk high cambiar quién puede emitir reembolsos
/agentship:dev --route medium --confirm-downgrade <tarea HIGH que quieres llevar a MEDIUM>
/agentship:dev --profile economy agregar un endpoint de salud
/agentship:dev --resume 2026-11-12T10-00-00-000Z --approve
```

| Flag | Efecto |
|---|---|
| `--route small\|medium\|large` | Sube la ruta. Bajarla solo se aplica si el riesgo no es HIGH. |
| `--risk high` | Marca la tarea como HIGH (fuerza LARGE). El riesgo no se puede bajar. |
| `--confirm-downgrade` | Confirma bajar de ruta una tarea HIGH. Incluso así, el mínimo es MEDIUM. |
| `--proposals` / `--no-proposals` | Fuerza o salta la fase de propuestas. |
| `--profile balanced\|economy\|quality` | Perfil de modelos para esta ejecución (ver [configuración](docs/configuration.md#perfiles-de-modelos)). |
| `--resume <run_id>` | Retoma una ejecución en su siguiente fase pendiente. |
| `--resume <run_id> --proposal <n>` | Elige una propuesta de una ejecución que se detuvo en esa fase. |
| `--resume <run_id> --approve` | Aprueba el gate humano de una ejecución LARGE desde otra sesión. |

Cada ejecución guarda su evidencia en `<proyecto>/.agentship/runs/<id>/`:

- la petición y la clasificación;
- las propuestas y la elegida;
- los especialistas usados;
- el plan;
- `state.json`;
- los logs de comandos;
- las revisiones por ronda;
- la revisión de Codex y su adjudicación;
- el gate;
- `summary.md`, apto para PR;
- `report.md`, con duraciones, agentes, modelos, reintentos e intervenciones humanas.

AgentShip no hace commits, push ni PR. Ese directorio se ignora a sí mismo, así que el `.gitignore` del proyecto no se toca.

## Desarrollo

```bash
npm install
npm test           # unitarias + integración del CLI, sin LLM
npm run typecheck
npm run validate   # claude plugin validate . --strict
```

E2E con Claude real, sobre un fixture desechable que debe estar **fuera** del repo, porque Claude Code protege los archivos bajo la raíz del plugin:

```bash
tests/e2e/setup-fixture.sh /tmp/as-e2e/base
tests/e2e/run-e2e.sh /tmp/as-e2e/base /tmp/as-e2e/out
```

Las tareas E2E corren con `--no-proposals` para que no se detengan esperando una elección.

```bash
tests/e2e/install-test.sh                                         # instalar, actualizar y desinstalar en un CLAUDE_CONFIG_DIR temporal
tests/e2e/run-eval.sh /tmp/as-e2e/base /tmp/as-eval balanced economy   # comparar perfiles con 6 tareas fijas (consume modelos)
```

## Documentación

- [Arquitectura](docs/architecture.md)
- [Workflows](docs/workflows.md)
- [Configuración](docs/configuration.md)
- [Compatibilidad](docs/compatibility.md)
- [Troubleshooting](docs/troubleshooting.md)
- [CHANGELOG](CHANGELOG.md)
