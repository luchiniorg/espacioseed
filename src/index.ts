import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, schema } from './db';
import { eq, gte, lte, and } from 'drizzle-orm';

export type Env = {
  Bindings: {
    DB: D1Database;
    ASSETS: Fetcher;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;
  };
};

const app = new Hono<Env>();

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
      filtered = allClients.filter(client => 
        (client.name && client.name.toLowerCase().includes(search)) ||
        (client.email && client.email.toLowerCase().includes(search)) ||
        (client.phone && client.phone.toLowerCase().includes(search)) ||
        (client.dni && client.dni.toLowerCase().includes(search))
      );
    }

    return c.json({
      total: filtered.length,
      clients: filtered,
    });
  } catch (err: any) {
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
    } else {
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
  } catch (err: any) {
    return c.json({ error: 'Webhook processing error', details: err?.message }, 500);
  }
});

// ==========================================
// PRODUCTOS & INVENTARIO BACKOFFICE ENDPOINTS
// ==========================================

const INITIAL_PRODUCTS = [
  { slug: 'p-gold-line', category: 'bienestar', categoryLabel: 'CBD & Bienestar', name: 'Aceite Golden Line (Ratio 1:1 Full Spectrum)', description: 'Aceite de CBD Full Spectrum Simple. Equilibrio y bienestar integral.', price: 35000, stock: 10, isVisible: true },
  { slug: 'p-platinum-line', category: 'bienestar', categoryLabel: 'CBD & Bienestar', name: 'Aceite Platinum Line (Aislado 100% CBD)', description: 'Fórmula aislada de CBD puro de alta concentración.', price: 38000, stock: 10, isVisible: true },
  { slug: 'p-pet-line', category: 'bienestar', categoryLabel: 'CBD & Mascotas', name: 'Aceite Pet Line (CBD para Mascotas)', description: 'Formulación especial de CBD para el bienestar y calma de mascotas.', price: 28000, stock: 10, isVisible: true },

  { slug: 'p-best-coco', category: 'suplementos', categoryLabel: 'Nutrición Proteica', name: 'Barra Proteica B3ST! Coco (bnb brands)', description: 'Barra proteica nutricional 20g proteína sabor Coco.', price: 4500, stock: 10, isVisible: true, imageUrl: '/images/barra-bestcoco.png' },
  { slug: 'p-best-caramel', category: 'suplementos', categoryLabel: 'Nutrición Proteica', name: 'Barra Proteica B3ST! Salted Caramel (bnb brands)', description: 'Barra proteica nutricional 20g proteína sabor Salted Caramel.', price: 4500, stock: 10, isVisible: true, imageUrl: '/images/barra-bestcaramel.png' },
  { slug: 'p-omega3-max', category: 'suplementos', categoryLabel: 'Suplementación', name: 'Pack x 2 Omega 3 Max (1000 EPA / 500 DHA)', description: 'Certificación IFOS. Alta pureza y concentración de ácidos grasos esenciales.', price: 42000, stock: 10, isVisible: true },
  { slug: 'p-yerba-gran-comision', category: 'suplementos', categoryLabel: 'Bienestar', name: 'Yerba La Gran Comisión x 500gr', description: 'Yerba mate natural de calidad superior y estacionamiento natural.', price: 3800, stock: 10, isVisible: true },

  { slug: 'p-rose-toner', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Rosé Toner', description: 'Tónico facial equilibrante e hidratante con extractos botánicos.', price: 22000, stock: 10, isVisible: true },
  { slug: 'p-c-bright-oil', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'C Bright Oil', description: 'Aceite facial iluminador y antioxidante con Vitamina C.', price: 34000, stock: 10, isVisible: true },
  { slug: 'p-c-peptidos', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'C Péptidos', description: 'Tratamiento regenerador con péptidos y complejo revitalizante.', price: 36000, stock: 10, isVisible: true },
  { slug: 'p-radiant-eyes', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Radiant Eyes', description: 'Contorno de ojos iluminador para ojeras y signos de fatiga.', price: 29000, stock: 10, isVisible: true },
  { slug: 'p-aqua-blu', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Aqua Blu', description: 'Concentrado hidratante intensivo con complejo de ácido hialurónico.', price: 31000, stock: 10, isVisible: true },
  { slug: 'p-tremella-barriere', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Tremella Barrière', description: 'Fortalecedor de la barrera cutánea con extracto de hongo Tremella.', price: 38000, stock: 10, isVisible: true },
  { slug: 'p-youthful-eyes', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Youthful Eyes', description: 'Sérum tensor para líneas de expresión y contorno de ojos.', price: 32000, stock: 10, isVisible: true },
  { slug: 'p-c-ferulic-booster', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'C Ferulic Booster', description: 'Potente booster antioxidante con Vitamina C y Ácido Ferúlico.', price: 39000, stock: 10, isVisible: true },
  { slug: 'p-youth-booster', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Youth Booster', description: 'Concentrado antiedad intensivo para firmeza y densidad.', price: 41000, stock: 10, isVisible: true },
  { slug: 'p-huile-balayage', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Huile de Balayage', description: 'Aceite nutritivo y reparador para rostro y escote.', price: 33000, stock: 10, isVisible: true },
  { slug: 'p-emeral-cbd', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Émeral C.B.D.', description: 'Elixir facial calmante enriquecido con CBD natural y fito-nutrientes.', price: 45000, stock: 10, isVisible: true },
  { slug: 'p-sun-drops', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Sun Drops', description: 'Gotas protectoras solares faciales ligeras de amplio espectro.', price: 30000, stock: 10, isVisible: true },
  { slug: 'p-lips-hydrater', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Lips Hydrater', description: 'Bálsamo ultra-nutritivo y reparador de labios.', price: 15000, stock: 10, isVisible: true },
  { slug: 'p-exfoliate-renew', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Exfoliate and Renew', description: 'Tratamiento renovador celular y exfoliante suave.', price: 27000, stock: 10, isVisible: true },
  { slug: 'p-mains-hydrate', category: 'dermocosmetica', categoryLabel: 'The Glow Factor', name: 'Mains Hydrate', description: 'Crema de manos de hidratación profunda e intensiva.', price: 16000, stock: 10, isVisible: true }
];

// POST /api/admin/seed-products - Sembrar catálogo inicial de productos
app.post('/api/admin/seed-products', async (c) => {
  try {
    const db = getDb(c.env.DB);
    const existing = await db.select().from(schema.products);

    if (existing.length > 0) {
      return c.json({ message: 'La tabla de productos ya contiene datos', count: existing.length, products: existing });
    }

    for (const prod of INITIAL_PRODUCTS) {
      await db.insert(schema.products).values(prod);
    }

    const inserted = await db.select().from(schema.products);

    return c.json({ message: 'Productos iniciales sembrados con éxito en D1', count: inserted.length, products: inserted }, 201);
  } catch (err: any) {
    return c.json({ error: 'Error al sembrar productos', details: err?.message }, 500);
  }
});

// GET /api/products - Catálogo público de productos visibles
app.get('/api/products', async (c) => {
  try {
    const db = getDb(c.env.DB);
    let list = await db.select().from(schema.products).where(eq(schema.products.isVisible, true));

    // Si la tabla está vacía, sembramos automáticamente
    if (list.length === 0) {
      const existingAll = await db.select().from(schema.products);
      if (existingAll.length === 0) {
        await db.insert(schema.products).values(INITIAL_PRODUCTS);
        list = await db.select().from(schema.products).where(eq(schema.products.isVisible, true));
      }
    }

    const productsFormatted = list.map(p => ({
      ...p,
      outOfStock: p.stock <= 0
    }));

    return c.json({ products: productsFormatted });
  } catch (err: any) {
    return c.json({ error: 'Error al consultar productos', details: err?.message }, 500);
  }
});

// GET /api/admin/products - Listado completo para el Backoffice / Admin
app.get('/api/admin/products', async (c) => {
  try {
    const db = getDb(c.env.DB);
    const search = c.req.query('q')?.trim()?.toLowerCase() || '';
    let list = await db.select().from(schema.products);

    if (list.length === 0) {
      await db.insert(schema.products).values(INITIAL_PRODUCTS);
      list = await db.select().from(schema.products);
    }

    let filtered = list;
    if (search) {
      filtered = list.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.category.toLowerCase().includes(search) ||
        p.categoryLabel.toLowerCase().includes(search) ||
        (p.description && p.description.toLowerCase().includes(search))
      );
    }

    return c.json({ total: filtered.length, products: filtered });
  } catch (err: any) {
    return c.json({ error: 'Error al consultar productos de administración', details: err?.message }, 500);
  }
});

// PATCH /api/admin/products/:id - Modificar stock, visibilidad, precio o datos
app.patch('/api/admin/products/:id', async (c) => {
  try {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [existing] = await db.select().from(schema.products).where(eq(schema.products.id, id));
    if (!existing) {
      return c.json({ error: 'Producto no encontrado' }, 404);
    }

    const updates: Partial<typeof schema.products.$inferInsert> = {
      updatedAt: new Date().toISOString()
    };

    if (body.stock !== undefined) updates.stock = Math.max(0, Number(body.stock));
    if (body.stockDelta !== undefined) updates.stock = Math.max(0, (existing.stock || 0) + Number(body.stockDelta));
    if (body.isVisible !== undefined) updates.isVisible = Boolean(body.isVisible);
    if (body.price !== undefined) updates.price = Number(body.price);
    if (body.name !== undefined) updates.name = String(body.name);
    if (body.description !== undefined) updates.description = String(body.description);
    if (body.category !== undefined) updates.category = String(body.category);
    if (body.categoryLabel !== undefined) updates.categoryLabel = String(body.categoryLabel);

    const [updated] = await db.update(schema.products)
      .set(updates)
      .where(eq(schema.products.id, id))
      .returning();

    return c.json({ message: 'Producto actualizado con éxito', product: updated });
  } catch (err: any) {
    return c.json({ error: 'Error al actualizar producto', details: err?.message }, 500);
  }
});

// POST /api/admin/products - Crear un nuevo producto
app.post('/api/admin/products', async (c) => {
  try {
    const db = getDb(c.env.DB);
    const body = await c.req.json();

    if (!body.name || body.price === undefined) {
      return c.json({ error: 'Nombre y Precio son campos obligatorios.' }, 400);
    }

    const slug = body.slug || body.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const [newProduct] = await db.insert(schema.products).values({
      slug: slug || `p-${Date.now()}`,
      name: body.name,
      category: body.category || 'suplementos',
      categoryLabel: body.categoryLabel || 'Productos',
      description: body.description || '',
      price: Number(body.price || 0),
      stock: Number(body.stock ?? 10),
      isVisible: body.isVisible !== undefined ? Boolean(body.isVisible) : true,
      imageUrl: body.imageUrl || null,
      link: body.link || null,
    }).returning();

    return c.json({ message: 'Producto creado exitosamente', product: newProduct }, 201);
  } catch (err: any) {
    return c.json({ error: 'Error al crear producto', details: err?.message }, 500);
  }
});

export default app;
