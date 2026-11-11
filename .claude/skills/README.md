# Skills de UX/UI de terceros

Copiadas de repositorios públicos de GitHub para auditar la UX/UI de Kora.

| Skill | Origen (commit) | Licencia |
|---|---|---|
| `ux-audit` | product-llc/claude-skills (0727635) | MIT |
| `ux-designer` | szilu/ux-designer-skill (c869d32) | MIT |
| `ui-ux-pro-max` | nextlevelbuilder/ui-ux-pro-max-skill (6ae86f6), sin `scripts/tests` | MIT |
| `uxui-evaluator`, `interface-auditor`, `flow-checker` | uxuiprinciples/agent-skills (bc3f52d) | Sin archivo de licencia; el README dice "free to use and distribute" |

Notas:
- Las tres de uxuiprinciples llaman a la API de uxuiprinciples.com solo si existe `UXUI_API_KEY`. Sin la clave trabajan sin red.
- En `ui-ux-pro-max/SKILL.md` se cambió la ruta `${CLAUDE_PLUGIN_ROOT}/...` por la ruta local del proyecto.
