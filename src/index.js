import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, schema } from './db';
import { eq } from 'drizzle-orm';
const app = new Hono();
// Serve turnos page explicitly
app.get('/turnos', async (c) => {
    const url = new URL(c.req.url);
    url.pathname = '/turnos.html';
    return c.env.ASSETS.fetch(new Request(url));
});
// Pantalla dedicada de reserva de turnos
app.get('/reservar', async (c) => {
    const url = new URL(c.req.url);
    url.pathname = '/reservar.html';
    return c.env.ASSETS.fetch(new Request(url));
});
// Panel de Administración de Clientes y Turnos
app.get('/admin', async (c) => {
    const url = new URL(c.req.url);
    url.pathname = '/admin.html';
    return c.env.ASSETS.fetch(new Request(url));
});
// Enable CORS for frontend requests
app.use('/api/*', cors());
// GET /api/clients - Obtener y buscar lista de clientes
app.get('/api/clients', async (c) => {
    try {
        const db = getDb(c.env.DB);
        const search = c.req.query('q')?.trim()?.toLowerCase() || '';
        const allClients = await db.select().from(schema.clients);
        let filtered = allClients;
        if (search) {
            filtered = allClients.filter(client => (client.name && client.name.toLowerCase().includes(search)) ||
                (client.email && client.email.toLowerCase().includes(search)) ||
                (client.phone && client.phone.toLowerCase().includes(search)) ||
                (client.dni && client.dni.toLowerCase().includes(search)));
        }
        return c.json({
            total: filtered.length,
            clients: filtered,
        });
    }
    catch (err) {
        return c.json({ error: 'Error al consultar clientes', message: err?.message }, 500);
    }
});
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
    }
    catch (err) {
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
    // Si no hay servicios, sembramos los servicios oficiales de Espacio Seed
    if (list.length === 0) {
        await db.insert(schema.services).values([
            {
                name: 'Yoga & Movimiento Consciente',
                description: 'Práctica de Hatha/Vinyasa Yoga, alineación anatómica y pranayama.',
                durationMinutes: 60,
                price: 6000,
                active: true,
            },
            {
                name: 'Cosmiatría Holística & Gua Sha',
                description: 'Tratamiento facial restaurador con piedras de cuarzo/jade y cosmética botánica.',
                durationMinutes: 60,
                price: 8500,
                active: true,
            },
            {
                name: 'Osteopatía & Salud Integral',
                description: 'Evaluación y tratamiento manual neuromuscular para el dolor y postura.',
                durationMinutes: 45,
                price: 10000,
                active: true,
            },
            {
                name: 'Ritual Armonización & Meditación',
                description: 'Sesión guiada de respiración consciente, relajación profunda y sonido.',
                durationMinutes: 50,
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
// POST /api/webhooks/cal - Webhook para recibir reservas automáticas desde Cal.com
app.post('/api/webhooks/cal', async (c) => {
    try {
        const db = getDb(c.env.DB);
        const body = await c.req.json();
        const event = body.triggerEvent || body.event || 'BOOKING_CREATED';
        const payload = body.payload || body;
        const bookingId = String(payload.uid || payload.id || '');
        if (!bookingId) {
            return c.json({ status: 'ignored', message: 'No booking ID found' }, 200);
        }
        // 1. Extraer datos del asistente / cliente
        const attendee = payload.attendees?.[0] || {};
        const clientName = (attendee.name || payload.responses?.name?.value || payload.responses?.name || 'Cliente Cal.com').trim();
        const clientEmail = (attendee.email || payload.responses?.email?.value || payload.responses?.email || '').trim().toLowerCase();
        const clientPhone = (attendee.phoneNumber || payload.responses?.location?.value || payload.responses?.phone || '').trim();
        const notes = payload.description || payload.responses?.notes?.value || '';
        if (!clientEmail) {
            return c.json({ status: 'ignored', message: 'No client email provided' }, 200);
        }
        // 2. Buscar o crear cliente en D1
        let [client] = await db.select().from(schema.clients).where(eq(schema.clients.email, clientEmail));
        if (!client) {
            [client] = await db
                .insert(schema.clients)
                .values({
                name: clientName,
                email: clientEmail,
                phone: clientPhone || null,
            })
                .returning();
        }
        // 3. Buscar servicio coincidente o usar el primero activo
        const serviceTitle = payload.type || payload.title || '';
        const allServices = await db.select().from(schema.services).where(eq(schema.services.active, true));
        let service = allServices.find(s => s.name.toLowerCase().includes(serviceTitle.toLowerCase()) || serviceTitle.toLowerCase().includes(s.name.toLowerCase())) || allServices[0];
        if (!service) {
            [service] = await db.insert(schema.services).values({
                name: serviceTitle || 'Consulta Espacio Seed',
                description: 'Servicio agendado vía Cal.com',
                durationMinutes: 60,
                price: 0,
                active: true
            }).returning();
        }
        // 4. Manejar cancelación
        if (event === 'BOOKING_CANCELLED') {
            const [existingAppointment] = await db.select().from(schema.appointments).where(eq(schema.appointments.calcomBookingId, bookingId));
            if (existingAppointment) {
                await db.update(schema.appointments)
                    .set({ status: 'cancelled' })
                    .where(eq(schema.appointments.id, existingAppointment.id));
            }
            return c.json({ status: 'cancelled', bookingId }, 200);
        }
        // 5. Manejar creación o reprogramación
        const startTime = payload.startTime ? new Date(payload.startTime).toISOString() : new Date().toISOString();
        const endTime = payload.endTime ? new Date(payload.endTime).toISOString() : new Date(new Date(startTime).getTime() + (service.durationMinutes * 60 * 1000)).toISOString();
        const [existingAppointment] = await db.select().from(schema.appointments).where(eq(schema.appointments.calcomBookingId, bookingId));
        if (existingAppointment) {
            await db.update(schema.appointments)
                .set({
                startTime,
                endTime,
                status: 'confirmed',
                notes: notes || existingAppointment.notes,
            })
                .where(eq(schema.appointments.id, existingAppointment.id));
            return c.json({ status: 'updated', bookingId }, 200);
        }
        else {
            await db.insert(schema.appointments).values({
                clientId: client.id,
                serviceId: service.id,
                startTime,
                endTime,
                status: 'confirmed',
                notes: notes || '',
                calcomBookingId: bookingId,
            });
            return c.json({ status: 'created', bookingId }, 200);
        }
    }
    catch (err) {
        return c.json({ error: 'Webhook processing error', details: err?.message }, 500);
    }
});
export default app;
