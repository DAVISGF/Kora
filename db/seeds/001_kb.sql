-- Base de conocimientos inicial de Kilo IA (mismo contenido que server/helpdesk/seed.ts).
INSERT INTO support_kb_articles (slug, title, body, audience) VALUES
('exportar-reporte-recorridos', 'Cómo exportar el reporte de recorridos',
 'Ve a Reportes > Recorridos, elige el rango de fechas y los vehículos, y pulsa Exportar. Puedes descargarlo en Excel o PDF. Los reportes de más de 90 días se envían por correo cuando están listos. Para programar un envío automático usa el botón Programar.', 'customer'),
('gps-sin-senal', 'Un vehículo aparece sin señal GPS',
 'Si un vehículo aparece como Sin señal, revisa primero que tenga contacto encendido y cobertura móvil. El dispositivo reporta cada 60 segundos en movimiento y cada 30 minutos detenido. Si lleva más de 24 horas sin reportar con el motor en uso, puede ser una falla de instalación o del equipo y requiere revisión técnica.', 'customer'),
('agregar-usuarios', 'Agregar usuarios y permisos a la cuenta',
 'Los administradores pueden invitar usuarios en Configuración > Usuarios > Invitar. Cada usuario recibe un correo para crear su contraseña. Los roles disponibles son Administrador, Supervisor y Conductor. El rol Supervisor ve sólo las flotas asignadas.', 'customer'),
('restablecer-contrasena', 'Restablecer la contraseña',
 'En la pantalla de ingreso pulsa ¿Olvidaste tu contraseña? e ingresa tu correo. Recibirás un enlace válido por 30 minutos. Si no llega, revisa la carpeta de spam. Kilora nunca te pedirá tu contraseña por WhatsApp ni por correo.', 'all'),
('que-es-kilora', 'Qué es Kilora y para quién es',
 'Kilora es una plataforma de gestión de flotas: ubicación en tiempo real, rutas, consumo de combustible, mantenciones y conducta de conducción. La usan empresas de transporte, distribución y servicios con desde 5 vehículos. Los planes se cotizan según el tamaño de la flota; el equipo comercial agenda una demo sin costo.', 'all')
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, audience = EXCLUDED.audience, updated_at = now();
