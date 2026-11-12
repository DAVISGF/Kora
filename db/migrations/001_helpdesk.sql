-- =====================================================================
-- Kilora · Sistema de Soporte Omnicanal y Helpdesk
-- Migración 001: esquema base (PostgreSQL 14+)
--
-- Tablas principales:
--   support_tickets       caso de soporte (cliente registrado o lead)
--   ticket_messages       hilo sincronizado web + WhatsApp + Kilo IA + agentes
--   ticket_attachments    adjuntos (bytea, WhatsApp media o almacenamiento externo)
-- Tablas de apoyo:
--   support_ticket_counters   correlativo anual para KIL-YYYY-XXXX
--   support_user_directory    teléfono -> user_id/tenant_id (vincula WhatsApp a cuentas)
--   support_ticket_events     auditoría de cambios de estado, prioridad, asignación
--   support_notifications     outbox de notificaciones (WhatsApp equipo + alertas de consola)
--   support_kb_articles       base de conocimientos que consulta Kilo IA
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
CREATE TYPE ticket_status AS ENUM (
  'OPEN',                -- creado, Kilo IA atendiendo                  -> «Abierto»
  'WAITING_CUSTOMER',    -- se espera respuesta/confirmación del cliente -> «Esperando tu respuesta»
  'RESOLVED_BY_AI',      -- el cliente confirmó que Kilo IA lo resolvió  -> «Resuelto»
  'ESCALATED_TO_HUMAN',  -- handoff: en cola para un agente humano       -> «En Revisión»
  'IN_REVIEW',           -- un agente lo tomó                            -> «En Revisión»
  'RESOLVED',            -- resuelto por un agente                       -> «Resuelto»
  'CLOSED'               -- cerrado/archivado                            -> «Resuelto»
);

CREATE TYPE ticket_priority  AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE support_channel  AS ENUM ('WEB', 'WHATSAPP', 'EMAIL', 'CONSOLE');
CREATE TYPE requester_kind   AS ENUM ('USER', 'LEAD');
CREATE TYPE ticket_handler   AS ENUM ('AI', 'HUMAN');
CREATE TYPE message_author   AS ENUM ('CUSTOMER', 'AI', 'AGENT', 'SYSTEM');
CREATE TYPE message_visibility AS ENUM ('PUBLIC', 'INTERNAL');
CREATE TYPE delivery_status  AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'NOT_APPLICABLE');

-- ---------------------------------------------------------------------
-- Correlativo legible KIL-YYYY-XXXX (atómico, sin huecos por concurrencia)
-- ---------------------------------------------------------------------
CREATE TABLE support_ticket_counters (
  year        integer PRIMARY KEY,
  last_value  integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_ticket_code(p_at timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year  integer := EXTRACT(YEAR FROM p_at AT TIME ZONE 'America/Santiago')::integer;
  v_value integer;
BEGIN
  INSERT INTO support_ticket_counters (year, last_value) VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_value = support_ticket_counters.last_value + 1
  RETURNING last_value INTO v_value;
  -- 4 dígitos mínimo; crece a 5+ si se superan 9999 casos en el año.
  RETURN format('KIL-%s-%s', v_year, lpad(v_value::text, 4, '0'));
END $$;

-- ---------------------------------------------------------------------
-- Directorio teléfono -> cuenta. Kilora lo mantiene (o se reemplaza por
-- una vista sobre su tabla de usuarios) para que un WhatsApp entrante de un
-- cliente registrado quede vinculado a su user_id y tenant_id.
-- ---------------------------------------------------------------------
CREATE TABLE support_user_directory (
  phone_e164  text PRIMARY KEY CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  user_id     uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  full_name   text,
  email       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_user_directory_user_idx ON support_user_directory (user_id);

-- ---------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------
CREATE TABLE support_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE DEFAULT next_ticket_code()
                     CHECK (code ~ '^KIL-[0-9]{4}-[0-9]{4,}$'),

  -- Solicitante: cliente registrado (USER) o prospecto (LEAD)
  requester_type     requester_kind NOT NULL,
  user_id            uuid,
  tenant_id          uuid,
  lead_phone         text CHECK (lead_phone IS NULL OR lead_phone ~ '^\+[1-9][0-9]{6,14}$'),
  lead_name          text,
  contact_phone      text,           -- teléfono WhatsApp conocido (USER o LEAD)
  contact_email      text,

  subject            text NOT NULL DEFAULT 'Consulta de soporte',
  category           text,           -- billing | technical | account | commercial | how_to | other
  status             ticket_status   NOT NULL DEFAULT 'OPEN',
  priority           ticket_priority NOT NULL DEFAULT 'NORMAL',
  handled_by         ticket_handler  NOT NULL DEFAULT 'AI',
  origin_channel     support_channel NOT NULL,
  active_channel     support_channel NOT NULL,   -- último canal por el que escribió el cliente
  origin_source      text,                       -- in_app_widget | whatsapp | landing | console
  assignee_id        uuid,
  assignee_name      text,

  -- Triaje Kilo IA
  ai_confidence      numeric(4,3) CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 1),
  ai_attempts        integer NOT NULL DEFAULT 0,
  escalation_reasons text[] NOT NULL DEFAULT '{}',
  ai_summary         jsonb,                      -- resumen ejecutivo para el agente

  last_customer_message_at timestamptz,          -- ventana de 24 h de WhatsApp
  last_message_at    timestamptz NOT NULL DEFAULT now(),
  escalated_at       timestamptz,
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Integridad de la diferenciación cliente/lead
  CONSTRAINT support_tickets_requester_ck CHECK (
    (requester_type = 'USER' AND user_id IS NOT NULL AND tenant_id IS NOT NULL AND lead_phone IS NULL)
    OR
    (requester_type = 'LEAD' AND user_id IS NULL AND lead_phone IS NOT NULL)
  )
);

CREATE INDEX support_tickets_inbox_idx     ON support_tickets (status, priority, last_message_at DESC);
CREATE INDEX support_tickets_user_idx      ON support_tickets (user_id, last_message_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX support_tickets_tenant_idx    ON support_tickets (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX support_tickets_lead_idx      ON support_tickets (lead_phone, last_message_at DESC) WHERE lead_phone IS NOT NULL;
CREATE INDEX support_tickets_phone_idx     ON support_tickets (contact_phone, last_message_at DESC) WHERE contact_phone IS NOT NULL;
CREATE INDEX support_tickets_channel_idx   ON support_tickets (origin_channel);
CREATE INDEX support_tickets_assignee_idx  ON support_tickets (assignee_id) WHERE assignee_id IS NOT NULL;

-- Un solo caso abierto por solicitante y canal de contacto: los mensajes nuevos
-- se agregan al hilo vigente en vez de abrir duplicados.
CREATE UNIQUE INDEX support_tickets_one_open_per_phone ON support_tickets (contact_phone)
  WHERE contact_phone IS NOT NULL AND status NOT IN ('RESOLVED_BY_AI', 'RESOLVED', 'CLOSED');

-- ---------------------------------------------------------------------
-- Mensajes del hilo
-- ---------------------------------------------------------------------
CREATE TABLE ticket_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type         message_author NOT NULL,
  author_id           uuid,              -- user_id o agent_id
  author_name         text,
  channel             support_channel NOT NULL,
  visibility          message_visibility NOT NULL DEFAULT 'PUBLIC', -- INTERNAL = nota de agente
  body                text NOT NULL DEFAULT '',
  metadata            jsonb NOT NULL DEFAULT '{}', -- confianza IA, intención, botones, etc.
  external_id         text,              -- wamid de WhatsApp (idempotencia de webhooks)
  delivery_status     delivery_status NOT NULL DEFAULT 'NOT_APPLICABLE',
  delivery_error      text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_thread_idx ON ticket_messages (ticket_id, created_at);
CREATE UNIQUE INDEX ticket_messages_external_uidx ON ticket_messages (external_id) WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Adjuntos
-- ---------------------------------------------------------------------
CREATE TABLE ticket_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id        uuid REFERENCES ticket_messages(id) ON DELETE SET NULL,
  file_name         text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        integer NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 16 * 1024 * 1024),
  storage_provider  text NOT NULL CHECK (storage_provider IN ('db', 'whatsapp', 's3', 'blob')),
  storage_key       text,              -- media_id de WhatsApp o clave del bucket
  content           bytea,             -- sólo cuando storage_provider = 'db'
  uploaded_by       message_author NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((storage_provider = 'db') = (content IS NOT NULL))
);
CREATE INDEX ticket_attachments_ticket_idx ON ticket_attachments (ticket_id);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
CREATE TABLE support_ticket_events (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  type        text NOT NULL,     -- created | status_changed | escalated | assigned | priority_changed
  from_value  text,
  to_value    text,
  actor_type  message_author NOT NULL,
  actor_id    uuid,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_events_ticket_idx ON support_ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------------
-- Outbox de notificaciones (entrega + reintentos + alertas de consola)
-- ---------------------------------------------------------------------
CREATE TABLE support_notifications (
  id           bigserial PRIMARY KEY,
  ticket_id    uuid REFERENCES support_tickets(id) ON DELETE CASCADE,
  kind         text NOT NULL,     -- escalation | customer_reply | new_lead
  channel      text NOT NULL CHECK (channel IN ('whatsapp_team', 'console')),
  recipient    text,              -- teléfono E.164 o NULL para consola
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  read_at      timestamptz,       -- alertas de consola marcadas como vistas
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX support_notifications_pending_idx ON support_notifications (status, created_at) WHERE status <> 'SENT';
CREATE INDEX support_notifications_console_idx ON support_notifications (id) WHERE channel = 'console';

-- ---------------------------------------------------------------------
-- Base de conocimientos para Kilo IA (búsqueda de texto completo en español)
-- ---------------------------------------------------------------------
CREATE TABLE support_kb_articles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  body        text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  audience    text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'customer', 'lead')),
  published   boolean NOT NULL DEFAULT true,
  search      tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
                setweight(to_tsvector('spanish', coalesce(body, '')), 'B')
              ) STORED,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_kb_articles_search_idx ON support_kb_articles USING gin (search);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION support_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER support_tickets_touch BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security (si la app consulta con el rol del usuario final).
-- El backend del helpdesk usa un rol de servicio con BYPASSRLS.
-- La app debe fijar: SET LOCAL app.user_id = '<uuid>'; SET LOCAL app.tenant_id = '<uuid>';
-- ---------------------------------------------------------------------
ALTER TABLE support_tickets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_tickets_owner ON support_tickets FOR SELECT USING (
  user_id = nullif(current_setting('app.user_id', true), '')::uuid
  AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
);
CREATE POLICY ticket_messages_owner ON ticket_messages FOR SELECT USING (
  visibility = 'PUBLIC' AND EXISTS (
    SELECT 1 FROM support_tickets t WHERE t.id = ticket_id
      AND t.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
);
CREATE POLICY ticket_attachments_owner ON ticket_attachments FOR SELECT USING (
  EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_id
      AND t.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
);

COMMIT;
