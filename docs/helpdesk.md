# Kilora · Sistema de Soporte Omnicanal y Helpdesk

Atención automatizada con **Kilo IA**, WhatsApp, panel del cliente y **Kilora Admin Console**.

## Arquitectura

```
 App Kilora (widget Kilo IA)  ─┐                      ┌─ Claude (Kilo IA: triaje + resumen)
 WhatsApp cliente / lead  ─────┼─► /api/helpdesk/* ───┼─ PostgreSQL (tickets, hilo, outbox, KB)
 Landing (wa.me + ref:LANDING) ┘   HelpdeskService    ├─ WhatsApp Cloud API (respuestas, alertas al equipo)
 Consola de agentes ◄── SSE ──────────────────────────┘  API de cuentas Kilora (estado de flota)
```

| Capa | Archivo |
|---|---|
| Esquema PostgreSQL | `db/migrations/001_helpdesk.sql`, semilla KB `db/seeds/001_kb.sql` |
| Dominio y estados | `server/helpdesk/types.ts`, `status.ts`, `ticketCode.ts` |
| Reglas Human-in-the-Loop | `server/helpdesk/escalation.ts` |
| Kilo IA (Claude + respaldo heurístico) | `server/helpdesk/kiloAI.ts` |
| Orquestación (entrada, handoff, entrega) | `server/helpdesk/service.ts` |
| WhatsApp (webhook, firma, envío, plantillas) | `server/helpdesk/whatsapp.ts`, `whatsappLink.ts` |
| Notificaciones (outbox, WhatsApp equipo, consola) | `server/helpdesk/notifications.ts` |
| Persistencia | `server/helpdesk/pgRepository.ts`, `memoryRepository.ts` |
| HTTP / Vercel | `server/helpdesk/http.ts`, `api/helpdesk/[...route].ts` |
| UI cliente | `src/pages/SupportCases.tsx`, `src/helpdesk/KiloWidget.tsx` |
| UI consola | `src/pages/admin/HelpdeskConsole.tsx` |
| Botón landing | `src/helpdesk/WhatsAppSupportButton.tsx` |

## Modelo de datos

- `support_tickets`: `code` `KIL-YYYY-XXXX` (función atómica `next_ticket_code()`), `requester_type` `USER | LEAD`
  con CHECK: un `USER` exige `user_id` + `tenant_id`; un `LEAD` exige `lead_phone` (y opcional `lead_name`).
  Guarda estado, prioridad, `handled_by` (AI/HUMAN), canal de origen y **canal activo**, confianza IA,
  motivos de escalamiento y el **resumen ejecutivo** (`ai_summary` jsonb).
  Índice único parcial: un solo caso abierto por teléfono (los mensajes nuevos se suman al hilo).
- `ticket_messages`: hilo único web + WhatsApp + IA + agentes; `visibility` `INTERNAL` para notas;
  `external_id` (wamid) único → idempotencia de webhooks; estado de entrega (enviado/entregado/leído/fallido).
- `ticket_attachments`: `bytea` (≤16 MB), referencia a medio de WhatsApp o almacenamiento externo.
- Apoyo: `support_user_directory` (teléfono → `user_id`/`tenant_id`), `support_ticket_events` (auditoría),
  `support_notifications` (outbox + alertas de consola), `support_kb_articles` (búsqueda full-text en español).
- RLS para lectura directa desde la app con `app.user_id` / `app.tenant_id`.

## Estados

| Interno | Cliente ve | Consola |
|---|---|---|
| `OPEN` | Abierto | Kilo IA atendiendo |
| `WAITING_CUSTOMER` | Esperando tu respuesta | Esperando cliente |
| `ESCALATED_TO_HUMAN` | En Revisión | Escalado · sin tomar |
| `IN_REVIEW` | En Revisión | En revisión |
| `RESOLVED_BY_AI` / `RESOLVED` / `CLOSED` | Resuelto | Resuelto por IA / Resuelto / Cerrado |

Las transiciones válidas están en `status.ts`; un caso resuelto se reabre si el cliente vuelve a escribir.

## Flujo

1. **Entrada**. Widget in-app (`POST /me/tickets`) → `USER` con `user_id`/`tenant_id` del JWT.
   WhatsApp → se busca el teléfono en `support_user_directory`: si existe es `USER`, si no `LEAD`
   (nombre del perfil de WhatsApp). La marca `ref:LANDING` del enlace de la landing etiqueta el origen.
   El caso se crea en el primer contacto con su `KIL-YYYY-XXXX`; si el cliente ya tiene un caso abierto
   (web o WhatsApp) se continúa el mismo hilo.
2. **Nivel 1 – Kilo IA**. Busca en la base de conocimientos y en el estado de la cuenta, responde y pregunta
   «¿Esto resolvió tu consulta?» (botones interactivos en WhatsApp, botones en la web). Con «Sí» → `RESOLVED_BY_AI`.
3. **Nivel 2 – Handoff**. `decideEscalation()` deriva cuando: el cliente pide una persona, confianza < 0,65,
   frustración (léxico + sentimiento del modelo), la consulta requiere intervención (facturación, fallas,
   cambios de cuenta, cotizaciones), el cliente dice que no se resolvió, o tras 3 respuestas de IA. Entonces:
   1. estado `ESCALATED_TO_HUMAN`, `handled_by = HUMAN`, prioridad recalculada;
   2. Kilo IA genera el **resumen ejecutivo** (nota interna + `ai_summary`);
   3. WhatsApp inmediato al equipo (ID, tipo de usuario, prioridad, motivo, resumen y link directo)
      y alerta en tiempo real en la consola (SSE). El outbox reintenta lo que falle.
4. **Agente**. Responde desde la consola: el mensaje queda en el panel del cliente y, si su canal activo es
   WhatsApp (o es lead), sale por WhatsApp. Fuera de la ventana de 24 h se envía la plantilla aprobada.
   Las respuestas posteriores del cliente vuelven a la bandeja del agente (`IN_REVIEW`) con alerta.

## API

Ver la cabecera de `server/helpdesk/http.ts`. Autenticación: JWT HS256 (`HELPDESK_JWT_SECRET`) emitido por la
app de Kilora con `role` `customer` (con `tenant_id`) o `agent`/`admin`. El webhook de WhatsApp valida
`X-Hub-Signature-256` con `WHATSAPP_APP_SECRET`.

## Puesta en marcha

1. `psql "$DATABASE_URL" -f db/migrations/001_helpdesk.sql && psql "$DATABASE_URL" -f db/seeds/001_kb.sql`
2. Poblar `support_user_directory` (o reemplazarla por una vista sobre la tabla de usuarios de Kilora).
3. En Meta: webhook `https://<dominio>/api/helpdesk/webhooks/whatsapp`, campo `messages`; crear las plantillas
   `kilora_escalation_alert` (5 variables: código, solicitante, prioridad, resumen, link) y
   `kilora_case_reply` (2 variables: código, respuesta).
4. Variables de entorno: ver `.env.example`.
5. Cron de reintentos del outbox: `GET /api/helpdesk/cron/notifications` con `Authorization: Bearer $CRON_SECRET`
   (Vercel Cron en `vercel.json` según el plan).

### Desarrollo local

`npm run dev` sirve todo con datos de demostración en memoria, identidad demo (sin JWT) y un WhatsApp simulado:

- Panel del cliente: `/soporte` y el botón flotante «Ayuda · Kilo IA».
- Consola: `/admin/soporte`.
- Simular un WhatsApp entrante:
  `curl -X POST localhost:5173/api/helpdesk/dev/whatsapp/simulate -H 'content-type: application/json' -d '{"from":"+56955554444","name":"Ana","text":"Hola, quiero una demo (ref:LANDING)"}'`
- Ver lo enviado por WhatsApp: `GET /api/helpdesk/dev/whatsapp/outbox`.
