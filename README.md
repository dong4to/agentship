# AgentShip

**Get it done. Ship it right.**

AgentShip es un plugin de Claude Code que recibe una tarea de desarrollo (ticket, bug, feature o idea), la clasifica por complejidad, riesgo y dominio, propone hasta 3 enfoques cuando conviene y la envía al workflow adecuado:

| Ruta | Cuándo | Qué ejecuta |
|---|---|---|
| **SMALL** | Cambio localizado, requisitos claros, riesgo bajo | Claude directo: implementar → tests → resumen para PR |
| **MEDIUM** | Feature de un módulo, necesita plan breve | discovery → plan (Opus) → waves (Sonnet) → tests → revisión |
| **LARGE / HIGH-RISK** | Varios módulos, decisiones nuevas, o cualquier riesgo alto | discovery → requisitos → arquitectura y plan → **aprobación humana** → waves + tests → revisión → UAT |

Un LLM clasifica la tarea; la ruta final la decide **código determinista y testeado** (`src/routing/policy.ts`). El riesgo HIGH siempre termina en LARGE, una clasificación inválida nunca cae en SMALL, y bajar de ruta una tarea HIGH requiere confirmación explícita.

- **Propuestas:** cuando hay más de un camino razonable, el agente ofrece de 1 a 3 enfoques con su alcance, trade-offs y clasificación. Eliges uno y la ruta se calcula sobre él. Elegir un enfoque más acotado reduce el alcance, nunca el riesgo.
- **Especialistas por dominio:** si la tarea toca contabilidad, pagos, auth, seguridad, etc., AgentShip llama al agente especialista instalado (los tuyos, o colecciones como [VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)) en research y en revisión, con el modelo que corresponde a cada fase, y aplica el checklist del dominio aunque no haya ningún especialista instalado.

Estado: **v0.2 (Hito 2 + H2.7–H2.9)**. Motor de fases propio, sin GSD. Todavía sin Codex, sin gates persistentes y sin creación de PR. Ver [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) y el [reporte del Hito 2](docs/milestones/h2-report.md).

## Requisitos

- Claude Code ≥ 2.1.292 (se probó con 2.1.312)
- Node.js ≥ 22.18 en el `PATH` (ejecuta TypeScript sin paso de build)
- Opcional: agentes especialistas por dominio (ver [configuración](docs/configuration.md#agregar-especialistas)).

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
```

| Flag | Efecto |
|---|---|
| `--route small\|medium\|large` | Sube la ruta. Bajarla solo se aplica si el riesgo no es HIGH. |
| `--risk high` | Marca la tarea como HIGH (fuerza LARGE). El riesgo no se puede bajar. |
| `--confirm-downgrade` | Confirma bajar de ruta una tarea HIGH. Incluso así, el mínimo es MEDIUM. |
| `--proposals` / `--no-proposals` | Fuerza o salta la fase de propuestas. |
| `--resume <run_id> --proposal <n>` | Continúa una ejecución que se detuvo en las propuestas (útil en modo headless). |

Cada ejecución guarda su evidencia en `<proyecto>/.agentship/runs/<id>/`: la petición, la clasificación, las propuestas y la elegida, los especialistas usados, el plan, los logs de tests, la revisión, el gate y un resumen apto para PR. Ese directorio se ignora a sí mismo, así que el `.gitignore` del proyecto no se toca.

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

## Documentación

- [Arquitectura](docs/architecture.md)
- [Workflows](docs/workflows.md)
- [Configuración](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
