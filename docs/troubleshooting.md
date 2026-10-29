# Troubleshooting

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `/agentship:dev` no aparece | El plugin no está cargado | Arranca con `claude --plugin-dir <ruta>` o, si la sesión ya estaba abierta, usa `/reload-plugins`. Comprueba con `claude plugin validate <ruta>`. |
| La skill muestra `AgentShip CLI failed to start` | No hay `node` en el `PATH`, o la versión es < 22.18 | `node --version`. Hace falta ≥ 22.18 para ejecutar TypeScript sin build. |
| MEDIUM o LARGE se detienen con "GSD Core missing" | GSD no está instalado | `npx @opengsd/gsd-core@latest --claude --local` (o `--global`). Para una tarea que no sea HIGH, también puedes re-ejecutarla con `--route small`. |
| MEDIUM o LARGE se detienen con "project not initialized" | Falta `.planning/ROADMAP.md`. `/gsd-quick` lo exige desde GSD 1.19.0. | Ejecuta `/gsd-onboard` (repo existente) o `/gsd-new-project`. |
| Los comandos `/gsd-*` no existen pero GSD está instalado | GSD está instalado como plugin | El namespace es `/gsd-core:gsd-*`. AgentShip lo detecta (`source: plugin`); comprueba la salida de `node src/cli.ts detect`. |
| La ruta sale `error` | El clasificador devolvió JSON inválido o incompleto, o un flag no es válido | Mira `errors` en `decision.json`. AgentShip reintenta una vez y después se detiene; nunca cae en SMALL. |
| `confirm_downgrade` | Pediste bajar de ruta una tarea HIGH | Re-ejecuta con `--confirm-downgrade`. El mínimo es MEDIUM. |
| Write o Edit denegados con "… which is a sensitive file" | Con `--plugin-dir`, Claude Code protege todo lo que está bajo la raíz del plugin. Un proyecto dentro del repo de AgentShip no se puede editar. | Ejecuta AgentShip sobre proyectos que estén fuera del directorio del plugin. Los fixtures E2E van en `%TEMP%`, no dentro del repo. |
| La E2E en Windows falla con "path longer than allowed" | El directorio temporal tiene una ruta demasiado larga para Win32 | Usa un directorio corto fuera del repo, por ejemplo `/tmp/as-e2e` en Git Bash. |
| Avisos LF/CRLF de git en Windows | Git convierte finales de línea con `core.autocrlf` | Son solo informativos; no afectan a AgentShip. |
