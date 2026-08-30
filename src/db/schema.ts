import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Clientes / Usuarios que solicitan turnos
export const clients = sqliteTable('clients', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  dni: text('dni'),
  age: integer('age'),
  gender: text('gender'),
  birthdate: text('birthdate'),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// Servicios / Tipos de Turnos disponibles
export const services = sqliteTable('services', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  price: integer('price').default(0), // En centavos / unidades enteras
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// Turnos / Reservas
export const appointments = sqliteTable('appointments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientId: text('client_id').references(() => clients.id).notNull(),
  serviceId: text('service_id').references(() => services.id).notNull(),
  startTime: text('start_time').notNull(), // ISOString (e.g., 2026-08-15T10:00:00Z)
  endTime: text('end_time').notNull(),   // ISOString
  status: text('status', { enum: ['scheduled', 'confirmed', 'cancelled', 'completed'] })
    .notNull()
    .default('scheduled'),
  notes: text('notes'),
  googleEventId: text('google_event_id'), // ID del evento en Google Calendar tras sync
  calcomBookingId: text('calcom_booking_id'), // ID de reserva en Cal.com tras sync
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

// Reglas de Disponibilidad / Agenda
export const availabilityRules = sqliteTable('availability_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dayOfWeek: integer('day_of_week').notNull(), // 0 (Domingo) a 6 (Sábado)
  startTime: text('start_time').notNull(),    // Formato "09:00"
  endTime: text('end_time').notNull(),      // Formato "18:00"
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// Credenciales / Tokens para Google Calendar API (OAuth2)
export const googleCalendarTokens = sqliteTable('google_calendar_tokens', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountEmail: text('account_email').notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: integer('expires_at').notNull(), // Timestamp ms
  updatedAt: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});
