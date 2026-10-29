# AgentShip

**Get it done. Ship it right.**

AgentShip es un plugin de Claude Code que recibe una tarea de desarrollo (ticket, bug, feature o idea), la clasifica por complejidad y riesgo, y la envía al workflow adecuado:

| Ruta | Cuándo | Qué ejecuta |
|---|---|---|
| **SMALL** | Cambio localizado, requisitos claros, riesgo bajo | Claude directo: implementar → tests → resumen para PR |
| **MEDIUM** | Feature de un módulo, necesita plan breve | GSD Quick (`/gsd-quick --research --validate`) |
| **LARGE / HIGH-RISK** | Varios módulos, decisiones nuevas, o cualquier riesgo alto | Ciclo de fases de GSD con **aprobación humana** entre el plan y la ejecución |

Un LLM clasifica la tarea; la ruta final la decide **código determinista y testeado** (`src/routing/policy.ts`). El riesgo HIGH siempre termina en LARGE, una clasificación inválida nunca cae en SMALL, y bajar de ruta una tarea HIGH requiere confirmación explícita.

Estado: **v0.1 (Hito 2)**. Sin Codex, sin gates persistentes y sin creación de PR. Ver [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) y el [reporte del Hito 2](docs/milestones/h2-report.md).

## Requisitos

- Claude Code ≥ 2.1.292 (se probó con 2.1.312)
- Node.js ≥ 22.18 en el `PATH` (ejecuta TypeScript sin paso de build)
- Para MEDIUM y LARGE: [GSD Core](https://github.com/open-gsd/gsd-core) instalado **y** el proyecto inicializado con GSD (`.planning/ROADMAP.md`, que crean `/gsd-onboard` o `/gsd-new-project`). Probado con GSD Core 1.19.0.

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

Cada ejecución guarda su evidencia en `<proyecto>/.agentship/runs/<id>/`: la petición, la clasificación, la decisión, el log de tests, un resumen apto para PR y el gate. Ese directorio se ignora a sí mismo, así que el `.gitignore` del proyecto no se toca.

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

`setup-fixture.sh` descarga `@opengsd/gsd-core` de npm y lo instala de forma local en el fixture.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Workflows](docs/workflows.md)
- [Configuración](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
