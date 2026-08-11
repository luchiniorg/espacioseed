import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, schema } from './db';
import { eq, gte, lte, and } from 'drizzle-orm';

export type Env = {
  Bindings: {
    DB: D1Database;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;
  };
};

const app = new Hono<Env>();

// Enable CORS for frontend requests
app.use('/api/*', cors());

// Healthcheck endpoint
app.get('/api/health', async (c) => {
  try {
    const db = getDb(c.env.DB);
    // Simple query to verify D1 connectivity
    const serviceList = await db.select().from(schema.services).limit(1);
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      servicesCount: serviceList.length,
    });
  } catch (err: any) {
    return c.json({
      status: 'error',
      message: 'Database connection failed',
      error: err?.message || String(err),
    }, 500);
  }
});

// GET /api/services - Obtener catálogo de servicios
app.get('/api/services', async (c) => {
  const db = getDb(c.env.DB);
  let list = await db.select().from(schema.services).where(eq(schema.services.active, true));

  // Si no hay servicios, sembramos uno por defecto para facilitar pruebas
  if (list.length === 0) {
    await db.insert(schema.services).values([
      {
        name: 'Consulta Inicial / Diagnóstico',
        description: 'Sesión individual de valoración inicial y planificación.',
        durationMinutes: 45,
        price: 5000,
        active: true,
      },
      {
        name: 'Sesión de Seguimiento',
        description: 'Sesión periódica de trabajo y acompañamiento.',
        durationMinutes: 60,
        price: 7000,
        active: true,
      },
    ]);
    list = await db.select().from(schema.services).where(eq(schema.services.active, true));
  }

  return c.json({ services: list });
});

// POST /api/services - Crear nuevo servicio
app.post('/api/services', async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();

  if (!body.name || !body.durationMinutes) {
    return c.json({ error: 'Faltan campos requeridos: name, durationMinutes' }, 400);
  }

  const [newService] = await db.insert(schema.services).values({
    name: body.name,
    description: body.description || '',
    durationMinutes: Number(body.durationMinutes),
    price: Number(body.price || 0),
    active: true,
  }).returning();

  return c.json({ service: newService }, 201);
});

// GET /api/appointments - Listar turnos existentes
app.get('/api/appointments', async (c) => {
  const db = getDb(c.env.DB);
  const result = await db
    .select({
      appointment: schema.appointments,
      client: schema.clients,
      service: schema.services,
    })
    .from(schema.appointments)
    .innerJoin(schema.clients, eq(schema.appointments.clientId, schema.clients.id))
    .innerJoin(schema.services, eq(schema.appointments.serviceId, schema.services.id));

  return c.json({ appointments: result });
});

// POST /api/appointments - Reservar un turno
app.post('/api/appointments', async (c) => {
  const db = getDb(c.env.DB);
  const body = await c.req.json();

  const { clientName, clientEmail, clientPhone, serviceId, startTime, notes } = body;

  if (!clientName || !clientEmail || !serviceId || !startTime) {
    return c.json({ error: 'Faltan datos obligatorios para la reserva.' }, 400);
  }

  // 1. Obtener o crear cliente
  let [existingClient] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.email, clientEmail));

  if (!existingClient) {
    [existingClient] = await db
      .insert(schema.clients)
      .values({
        name: clientName,
        email: clientEmail,
        phone: clientPhone || null,
      })
      .returning();
  }

  // 2. Obtener servicio para duración
  const [service] = await db
    .select()
    .from(schema.services)
    .where(eq(schema.services.id, serviceId));

  if (!service) {
    return c.json({ error: 'El servicio seleccionado no existe.' }, 404);
  }

  // Calculate end time based on duration
  const start = new Date(startTime);
  const end = new Date(start.getTime() + service.durationMinutes * 60 * 1000);

  // 3. Crear el turno en la DB
  const [appointment] = await db
    .insert(schema.appointments)
    .values({
      clientId: existingClient.id,
      serviceId: service.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      status: 'scheduled',
      notes: notes || '',
    })
    .returning();

  // TODO: Integración con Google Calendar API (creación de evento e inserción de googleEventId)

  return c.json({
    message: 'Turno agendado exitosamente',
    appointment,
    client: existingClient,
    service,
  }, 201);
});

// GET /api/auth/google/url - Obtener URL de autorización de Google Calendar
app.get('/api/auth/google/url', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = c.env.GOOGLE_REDIRECT_URI || 'http://localhost:8787/api/auth/google/callback';

  if (!clientId) {
    return c.json({
      error: 'Google OAuth no está configurado aún. Agrega GOOGLE_CLIENT_ID en tus variables de entorno.',
    }, 400);
  }

  const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar.events');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&access_type=offline&prompt=consent`;

  return c.json({ url: authUrl });
});

export default app;
