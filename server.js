
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

// Database setup
// Vercel uses temporary writable storage.
// Local development uses the project's data folder.

const isVercel = Boolean(process.env.VERCEL);
const dataDir = path.join(__dirname, 'data');

const dbPath = isVercel
  ? path.join('/tmp', 'staybook.db')
  : (process.env.DB_PATH || path.join(dataDir, 'staybook.db'));

// Create only the directory containing the selected database path
const dbDirectory = path.dirname(dbPath);
fs.mkdirSync(dbDirectory, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_no TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    price REAL NOT NULL CHECK (price >= 0),
    status TEXT NOT NULL DEFAULT 'available',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_room_dates
  ON bookings(room_id, check_in, check_out, status);

  CREATE TABLE IF NOT EXISTS guest_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guest_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, preference_key),
    FOREIGN KEY (guest_id) REFERENCES guest_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS housekeeping_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'clean',
    assigned_to TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open',
    assigned_to TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS digital_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    guest_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    identity_reference TEXT,
    signature TEXT,
    submitted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES guest_profiles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER,
    booking_id INTEGER,
    channel TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guest_id) REFERENCES guest_profiles(id) ON DELETE SET NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    metric_date TEXT NOT NULL,
    dimensions TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (metric_name, metric_date)
  );

  CREATE TABLE IF NOT EXISTS privacy_audit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS booking_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    metadata_key TEXT NOT NULL,
    metadata_value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (booking_id, metadata_key),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
  );
`);

// Seed initial rooms if empty
const countRooms = db.prepare('SELECT COUNT(*) as count FROM rooms').get();

if (countRooms.count === 0) {
  const insertRoom = db.prepare(`
    INSERT INTO rooms (room_no, type, price, status)
    VALUES (?, ?, ?, ?)
  `);

  const initialRooms = [
    { roomNo: '101', type: 'Garden King', price: 185, status: 'available' },
    { roomNo: '107', type: 'Accessible Queen', price: 165, status: 'available' },
    { roomNo: '204', type: 'Poolside Twin', price: 220, status: 'available' },
    { roomNo: '305', type: 'Terrace Suite', price: 340, status: 'available' },
    { roomNo: '402', type: 'Ocean King', price: 295, status: 'available' },
    { roomNo: '501', type: 'Penthouse', price: 520, status: 'available' }
  ];

  const seedTransaction = db.transaction((rooms) => {
    for (const r of rooms) {
      insertRoom.run(r.roomNo, r.type, r.price, r.status);
    }
  });

  seedTransaction(initialRooms);
}

// Middleware
app.use(express.json());

// Handle malformed JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Malformed JSON payload.',
      code: 'INVALID_JSON'
    });
  }
  next();
});

// Helper for local today in YYYY-MM-DD
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Date validation helper
function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;

  const [year, month, day] = dateStr.split('-').map(Number);

  return d.getUTCFullYear() === year
    && d.getUTCMonth() + 1 === month
    && d.getUTCDate() === day;
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'staybook'
  });
});

// GET /api/rooms
app.get('/api/rooms', (req, res) => {
  try {
    const today = getTodayString();

    const rawRooms = db.prepare(`
      SELECT id, room_no, type, price, status
      FROM rooms
      ORDER BY CAST(room_no AS INTEGER) ASC, room_no ASC
    `).all();

    // Query active bookings for today and next check-in
    const occupiedRows = db.prepare(`
      SELECT DISTINCT room_id
      FROM bookings
      WHERE status = 'confirmed'
        AND check_in <= ?
        AND check_out > ?
    `).all(today, today);

    const occupiedRoomIds = new Set(occupiedRows.map(r => r.room_id));

    const nextCheckInRows = db.prepare(`
      SELECT room_id, MIN(check_in) as nextCheckIn
      FROM bookings
      WHERE status = 'confirmed'
        AND check_in >= ?
      GROUP BY room_id
    `).all(today);

    const nextCheckInMap = new Map(
      nextCheckInRows.map(r => [r.room_id, r.nextCheckIn])
    );

    const formattedRooms = rawRooms.map(room => {
      let currentStatus = 'Available';
      const baseStatus = (room.status || '').toLowerCase();

      if (baseStatus === 'maintenance') {
        currentStatus = 'Maintenance';
      } else if (baseStatus === 'inactive') {
        currentStatus = 'Inactive';
      } else if (occupiedRoomIds.has(room.id)) {
        currentStatus = 'Occupied today';
      } else {
        currentStatus = 'Available';
      }

      return {
        id: room.id,
        roomNo: room.room_no,
        type: room.type,
        price: Number(room.price),
        status: baseStatus,
        currentStatus,
        nextCheckIn: nextCheckInMap.get(room.id) || null
      };
    });

    res.json(formattedRooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({
      error: 'Failed to retrieve rooms.',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/rooms
app.post('/api/rooms', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      error: 'Request body must be a JSON object.',
      code: 'INVALID_REQUEST'
    });
  }

  const { roomNo, type, price, status } = req.body;

  if (!roomNo || typeof roomNo !== 'string' || roomNo.trim() === '') {
    return res.status(400).json({
      error: 'Room number is required.',
      code: 'INVALID_ROOM_NUMBER'
    });
  }

  if (!type || typeof type !== 'string' || type.trim() === '') {
    return res.status(400).json({
      error: 'Room type is required.',
      code: 'INVALID_ROOM_TYPE'
    });
  }

  const numPrice = Number(price);

  if (isNaN(numPrice) || numPrice < 0) {
    return res.status(400).json({
      error: 'Price must be a non-negative number.',
      code: 'INVALID_PRICE'
    });
  }

  const normalizedStatus = (status || 'available').toString().toLowerCase().trim();
  const validStatuses = ['available', 'maintenance', 'inactive'];

  if (!validStatuses.includes(normalizedStatus)) {
    return res.status(400).json({
      error: 'Status must be available, maintenance, or inactive.',
      code: 'INVALID_STATUS'
    });
  }

  try {
    const existing = db.prepare(
      'SELECT id FROM rooms WHERE room_no = ?'
    ).get(roomNo.trim());

    if (existing) {
      return res.status(409).json({
        error: `Room number ${roomNo.trim()} already exists.`,
        code: 'DUPLICATE_ROOM_NUMBER'
      });
    }

    const insert = db.prepare(`
      INSERT INTO rooms (room_no, type, price, status)
      VALUES (?, ?, ?, ?)
    `);

    const result = insert.run(
      roomNo.trim(),
      type.trim(),
      numPrice,
      normalizedStatus
    );

    const created = db.prepare(
      'SELECT id, room_no, type, price, status FROM rooms WHERE id = ?'
    ).get(result.lastInsertRowid);

    res.status(201).json({
      id: created.id,
      roomNo: created.room_no,
      type: created.type,
      price: Number(created.price),
      status: created.status,
      currentStatus: created.status === 'available'
        ? 'Available'
        : (created.status === 'maintenance' ? 'Maintenance' : 'Inactive'),
      nextCheckIn: null
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({
      error: 'Failed to create room.',
      code: 'SERVER_ERROR'
    });
  }
});

// PUT /api/rooms/:id
app.put('/api/rooms/:id', (req, res) => {
  const roomId = parseInt(req.params.id, 10);

  if (isNaN(roomId)) {
    return res.status(400).json({
      error: 'Invalid room ID.',
      code: 'INVALID_ID'
    });
  }

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      error: 'Request body must be a JSON object.',
      code: 'INVALID_REQUEST'
    });
  }

  const { roomNo, type, price, status } = req.body;

  const existingRoom = db.prepare(
    'SELECT * FROM rooms WHERE id = ?'
  ).get(roomId);

  if (!existingRoom) {
    return res.status(404).json({
      error: 'Room not found.',
      code: 'ROOM_NOT_FOUND'
    });
  }

  const updatedRoomNo = roomNo !== undefined
    ? String(roomNo).trim()
    : existingRoom.room_no;

  const updatedType = type !== undefined
    ? String(type).trim()
    : existingRoom.type;

  const updatedPrice = price !== undefined
    ? Number(price)
    : existingRoom.price;

  const updatedStatus = status !== undefined
    ? String(status).toLowerCase().trim()
    : existingRoom.status;

  if (!updatedRoomNo) {
    return res.status(400).json({
      error: 'Room number cannot be empty.',
      code: 'INVALID_ROOM_NUMBER'
    });
  }

  if (!updatedType) {
    return res.status(400).json({
      error: 'Room type cannot be empty.',
      code: 'INVALID_ROOM_TYPE'
    });
  }

  if (isNaN(updatedPrice) || updatedPrice < 0) {
    return res.status(400).json({
      error: 'Price must be a non-negative number.',
      code: 'INVALID_PRICE'
    });
  }

  const validStatuses = ['available', 'maintenance', 'inactive'];

  if (!validStatuses.includes(updatedStatus)) {
    return res.status(400).json({
      error: 'Status must be available, maintenance, or inactive.',
      code: 'INVALID_STATUS'
    });
  }

  // Check unique room number against other rooms
  const dupCheck = db.prepare(
    'SELECT id FROM rooms WHERE room_no = ? AND id != ?'
  ).get(updatedRoomNo, roomId);

  if (dupCheck) {
    return res.status(409).json({
      error: `Room number ${updatedRoomNo} is already used by another room.`,
      code: 'DUPLICATE_ROOM_NUMBER'
    });
  }

  try {
    db.prepare(`
      UPDATE rooms
      SET room_no = ?, type = ?, price = ?, status = ?
      WHERE id = ?
    `).run(updatedRoomNo, updatedType, updatedPrice, updatedStatus, roomId);

    const updated = db.prepare(
      'SELECT id, room_no, type, price, status FROM rooms WHERE id = ?'
    ).get(roomId);

    res.json({
      id: updated.id,
      roomNo: updated.room_no,
      type: updated.type,
      price: Number(updated.price),
      status: updated.status
    });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({
      error: 'Failed to update room.',
      code: 'SERVER_ERROR'
    });
  }
});

// DELETE /api/rooms/:id
app.delete('/api/rooms/:id', (req, res) => {
  const roomId = parseInt(req.params.id, 10);

  if (isNaN(roomId)) {
    return res.status(400).json({
      error: 'Invalid room ID.',
      code: 'INVALID_ID'
    });
  }

  const room = db.prepare(
    'SELECT * FROM rooms WHERE id = ?'
  ).get(roomId);

  if (!room) {
    return res.status(404).json({
      error: 'Room not found.',
      code: 'ROOM_NOT_FOUND'
    });
  }

  // Check if room has active or upcoming confirmed bookings
  const today = getTodayString();

  const activeBooking = db.prepare(`
    SELECT id FROM bookings
    WHERE room_id = ?
      AND status = 'confirmed'
      AND check_out >= ?
    LIMIT 1
  `).get(roomId, today);

  if (activeBooking) {
    return res.status(409).json({
      error: 'Cannot delete room with active or upcoming confirmed bookings.',
      code: 'ROOM_HAS_ACTIVE_BOOKINGS'
    });
  }

  try {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);

    res.json({
      ok: true,
      message: `Room ${room.room_no} successfully removed.`
    });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({
      error: 'Failed to delete room.',
      code: 'SERVER_ERROR'
    });
  }
});

// GET /api/availability
// Query: ?type=Garden%20King&checkIn=2026-12-01&checkOut=2026-12-03
app.get('/api/availability', (req, res) => {
  const { type, checkIn, checkOut } = req.query;

  if (!checkIn || !checkOut) {
    return res.status(400).json({
      error: 'Both checkIn and checkOut dates are required.',
      code: 'MISSING_DATES'
    });
  }

  if (!isValidDateString(checkIn) || !isValidDateString(checkOut)) {
    return res.status(400).json({
      error: 'Dates must use valid YYYY-MM-DD format.',
      code: 'INVALID_DATE_FORMAT'
    });
  }

  if (checkOut <= checkIn) {
    return res.status(400).json({
      error: 'Check-out date must be after check-in date.',
      code: 'INVALID_DATE_RANGE'
    });
  }

  const today = getTodayString();

  if (checkIn < today) {
    return res.status(400).json({
      error: 'Check-in date cannot be in the past.',
      code: 'PAST_DATE'
    });
  }

  try {
    // Rooms must:
    // 1. Have status 'available'
    // 2. Match selected room type if provided
    // 3. Not have an overlapping confirmed booking
    let sql = `
      SELECT r.id, r.room_no, r.type, r.price, r.status
      FROM rooms r
      WHERE r.status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.room_id = r.id
            AND b.status = 'confirmed'
            AND b.check_in < ?
            AND b.check_out > ?
        )
    `;

    const params = [checkOut, checkIn];

    if (type && type.trim() !== '' && type.trim() !== 'All room types') {
      sql += ' AND r.type = ?';
      params.push(type.trim());
    }

    sql += ' ORDER BY CAST(r.room_no AS INTEGER) ASC, r.room_no ASC';

    const availableRooms = db.prepare(sql).all(...params);

    const formatted = availableRooms.map(r => ({
      id: r.id,
      roomNo: r.room_no,
      type: r.type,
      price: Number(r.price)
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({
      error: 'Failed to search availability.',
      code: 'SERVER_ERROR'
    });
  }
});

// GET /api/bookings
app.get('/api/bookings', (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT
        b.id,
        b.guest_name,
        b.check_in,
        b.check_out,
        b.status,
        b.created_at,
        r.id as room_id,
        r.room_no,
        r.type as room_type,
        r.price
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.status = 'confirmed'
      ORDER BY b.check_in ASC, b.id ASC
    `).all();

    const formatted = bookings.map(b => ({
      id: b.id,
      guestName: b.guest_name,
      checkIn: b.check_in,
      checkOut: b.check_out,
      status: b.status,
      createdAt: b.created_at,
      room: {
        id: b.room_id,
        roomNo: b.room_no,
        type: b.room_type,
        price: Number(b.price)
      }
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({
      error: 'Failed to retrieve bookings.',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/bookings
app.post('/api/bookings', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      error: 'Request body must be a JSON object.',
      code: 'INVALID_REQUEST'
    });
  }

  const { roomId, guestName, checkIn, checkOut } = req.body;

  if (!guestName || typeof guestName !== 'string' || guestName.trim() === '') {
    return res.status(400).json({
      error: 'Guest name is required.',
      code: 'INVALID_GUEST_NAME'
    });
  }

  const parsedRoomId = parseInt(roomId, 10);

  if (isNaN(parsedRoomId)) {
    return res.status(400).json({
      error: 'A valid room must be selected.',
      code: 'INVALID_ROOM_ID'
    });
  }

  if (!checkIn || !checkOut) {
    return res.status(400).json({
      error: 'Both check-in and check-out dates are required.',
      code: 'MISSING_DATES'
    });
  }

  if (!isValidDateString(checkIn) || !isValidDateString(checkOut)) {
    return res.status(400).json({
      error: 'Dates must use valid YYYY-MM-DD format.',
      code: 'INVALID_DATE_FORMAT'
    });
  }

  if (checkOut <= checkIn) {
    return res.status(400).json({
      error: 'Check-out date must be after check-in date.',
      code: 'INVALID_DATE_RANGE'
    });
  }

  const today = getTodayString();

  if (checkIn < today) {
    return res.status(400).json({
      error: 'Check-in date cannot be in the past.',
      code: 'PAST_DATE'
    });
  }

  // Room verification & Transaction-safe booking creation
  try {
    const bookTransaction = db.transaction(() => {
      // 1. Verify room exists and status is available
      const room = db.prepare(
        'SELECT id, room_no, type, price, status FROM rooms WHERE id = ?'
      ).get(parsedRoomId);

      if (!room) {
        const err = new Error('Room not found.');
        err.statusCode = 404;
        err.code = 'ROOM_NOT_FOUND';
        throw err;
      }

      if (room.status.toLowerCase() !== 'available') {
        const err = new Error(
          `Room ${room.room_no} is currently marked as ${room.status} and cannot be booked.`
        );
        err.statusCode = 400;
        err.code = 'ROOM_UNAVAILABLE';
        throw err;
      }

      // 2. Overlap check with half-open interval
      const conflict = db.prepare(`
        SELECT id FROM bookings
        WHERE room_id = ?
          AND status = 'confirmed'
          AND check_in < ?
          AND check_out > ?
        LIMIT 1
      `).get(parsedRoomId, checkOut, checkIn);

      if (conflict) {
        const err = new Error(
          'Those dates overlap an existing reservation. Try another room or date range.'
        );
        err.statusCode = 409;
        err.code = 'BOOKING_CONFLICT';
        throw err;
      }

      // 3. Insert reservation
      const insert = db.prepare(`
        INSERT INTO bookings (room_id, guest_name, check_in, check_out, status)
        VALUES (?, ?, ?, ?, 'confirmed')
      `);

      const result = insert.run(
        parsedRoomId,
        guestName.trim(),
        checkIn,
        checkOut
      );

      return {
        id: result.lastInsertRowid,
        guestName: guestName.trim(),
        checkIn,
        checkOut,
        status: 'confirmed',
        room: {
          id: room.id,
          roomNo: room.room_no,
          type: room.type,
          price: Number(room.price)
        }
      };
    });

    const newBooking = bookTransaction();
    res.status(201).json(newBooking);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code
      });
    }

    console.error('Error creating booking:', error);

    res.status(500).json({
      error: 'Failed to create booking.',
      code: 'SERVER_ERROR'
    });
  }
});

// DELETE /api/bookings/:id
app.delete('/api/bookings/:id', (req, res) => {
  const bookingId = parseInt(req.params.id, 10);

  if (isNaN(bookingId)) {
    return res.status(400).json({
      error: 'Invalid booking ID.',
      code: 'INVALID_ID'
    });
  }

  try {
    const booking = db.prepare(`
      SELECT b.id, b.guest_name, r.room_no
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.id = ? AND b.status = 'confirmed'
    `).get(bookingId);

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found. It may already be cancelled.',
        code: 'BOOKING_NOT_FOUND'
      });
    }

    db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);

    res.json({
      ok: true,
      message: 'Booking cancelled.',
      guestName: booking.guest_name,
      roomNo: booking.room_no
    });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      error: 'Failed to cancel booking.',
      code: 'SERVER_ERROR'
    });
  }
});

// ==========================================
// OPERATIONS EXTENSION API
// ==========================================

// These resources deliberately use the local SQLite database only.
// The whitelist below keeps request fields and SQL identifiers explicit.

const extensionResources = {
  guests: {
    table: 'guest_profiles',
    fields: ['guest_name', 'email', 'phone', 'address', 'notes'],
    required: ['guest_name'],
    aliases: ['guest-profiles'],
    hasUpdatedAt: true
  },
  preferences: {
    table: 'guest_preferences',
    fields: ['guest_id', 'preference_key', 'preference_value'],
    required: ['guest_id', 'preference_key', 'preference_value'],
    aliases: ['guest-preferences']
  },
  housekeeping: {
    table: 'housekeeping_status',
    fields: ['room_id', 'status', 'assigned_to', 'notes'],
    required: ['room_id', 'status'],
    aliases: ['housekeeping/rooms'],
    hasUpdatedAt: true
  },
  maintenance: {
    table: 'maintenance_tickets',
    fields: [
      'room_id',
      'title',
      'description',
      'priority',
      'status',
      'assigned_to',
      'resolved_at'
    ],
    required: ['title'],
    aliases: ['maintenance-tickets']
  },
  addons: {
    table: 'addons',
    fields: ['name', 'description', 'price', 'active'],
    required: ['name'],
    aliases: ['add-ons']
  },
  checkins: {
    table: 'digital_checkins',
    fields: [
      'booking_id',
      'guest_id',
      'status',
      'identity_reference',
      'signature',
      'submitted_at'
    ],
    required: ['booking_id'],
    aliases: ['digital-checkins']
  },
  notifications: {
    table: 'notifications',
    fields: [
      'guest_id',
      'booking_id',
      'channel',
      'subject',
      'message',
      'status',
      'sent_at'
    ],
    required: ['channel', 'message']
  },
  metrics: {
    table: 'analytics_metrics',
    fields: ['metric_name', 'metric_value', 'metric_date', 'dimensions'],
    required: ['metric_name', 'metric_value', 'metric_date'],
    aliases: ['analytics/metrics']
  },
  audit: {
    table: 'privacy_audit_records',
    fields: ['actor', 'action', 'entity_type', 'entity_id', 'details'],
    required: ['actor', 'action', 'entity_type'],
    aliases: ['privacy/audit']
  },
  metadata: {
    table: 'booking_metadata',
    fields: ['booking_id', 'metadata_key', 'metadata_value'],
    required: ['booking_id', 'metadata_key', 'metadata_value'],
    aliases: ['booking-metadata'],
    hasUpdatedAt: true
  }
};

function extensionError(res, status, code, error) {
  return res.status(status).json({ error, code });
}

function extensionValue(value, field) {
  if (['guest_id', 'room_id', 'booking_id', 'id'].includes(field)) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  if (['price', 'metric_value'].includes(field)) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  if (field === 'active') {
    return value === true || value === 1 || value === '1' ? 1 : 0;
  }

  if (typeof value !== 'string' && field !== 'details' && field !== 'dimensions') {
    return null;
  }

  return value;
}

function extensionRow(row) {
  if (!row) return row;

  for (const field of ['dimensions', 'details']) {
    if (row[field]) {
      try {
        row[field] = JSON.parse(row[field]);
      } catch (error) {
        // Preserve legacy text
      }
    }
  }

  return row;
}

function extensionPayload(req, resource, isUpdate) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return {
      error: 'Request body must be a JSON object.',
      code: 'INVALID_REQUEST'
    };
  }

  const values = {};

  for (const field of resource.fields) {
    const camelField = field.replace(
      /_([a-z])/g,
      (match, letter) => letter.toUpperCase()
    );

    const supplied = req.body[field] !== undefined
      ? req.body[field]
      : req.body[camelField];

    if (supplied !== undefined) {
      const value = extensionValue(supplied, field);

      if (
        value === null ||
        (typeof value === 'string' &&
          !value.trim() &&
          resource.required.includes(field))
      ) {
        return {
          error: `${field} is invalid.`,
          code: 'INVALID_FIELD'
        };
      }

      values[field] = (
        typeof value === 'string' &&
        field !== 'details' &&
        field !== 'dimensions'
      ) ? value.trim() : value;
    }
  }

  if (!isUpdate) {
    for (const field of resource.required) {
      if (
        values[field] === undefined ||
        values[field] === null ||
        values[field] === ''
      ) {
        return {
          error: `${field} is required.`,
          code: 'MISSING_FIELD'
        };
      }
    }
  } else if (Object.keys(values).length === 0) {
    return {
      error: 'At least one supported field is required.',
      code: 'INVALID_REQUEST'
    };
  }

  for (const field of ['details', 'dimensions']) {
    if (
      values[field] !== undefined &&
      typeof values[field] !== 'string'
    ) {
      values[field] = JSON.stringify(values[field]);
    }
  }

  return { values };
}

function registerExtensionResource(name, resource, routeName) {
  const route = `/api/${routeName}`;

  app.get(route, (req, res) => {
    try {
      const rows = db.prepare(
        `SELECT * FROM ${resource.table} ORDER BY id DESC`
      ).all();

      res.json(rows.map(extensionRow));
    } catch (error) {
      console.error(`Error reading ${name}:`, error);
      extensionError(
        res,
        500,
        'SERVER_ERROR',
        `Failed to retrieve ${name}.`
      );
    }
  });

  app.get(`${route}/:id`, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return extensionError(res, 400, 'INVALID_ID', 'Invalid record ID.');
    }

    try {
      const row = db.prepare(
        `SELECT * FROM ${resource.table} WHERE id = ?`
      ).get(id);

      if (!row) {
        return extensionError(
          res,
          404,
          'NOT_FOUND',
          `${name} record not found.`
        );
      }

      res.json(extensionRow(row));
    } catch (error) {
      console.error(`Error reading ${name}:`, error);
      extensionError(
        res,
        500,
        'SERVER_ERROR',
        `Failed to retrieve ${name}.`
      );
    }
  });

  app.post(route, (req, res) => {
    const payload = extensionPayload(req, resource, false);

    if (payload.error) {
      return extensionError(res, 400, payload.code, payload.error);
    }

    try {
      const fields = Object.keys(payload.values);

      const result = db.prepare(
        `INSERT INTO ${resource.table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
      ).run(...fields.map(field => payload.values[field]));

      const created = db.prepare(
        `SELECT * FROM ${resource.table} WHERE id = ?`
      ).get(result.lastInsertRowid);

      res.status(201).json(extensionRow(created));
    } catch (error) {
      if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
        return extensionError(
          res,
          409,
          'CONFLICT',
          'The record conflicts with an existing record or reference.'
        );
      }

      console.error(`Error creating ${name}:`, error);

      extensionError(
        res,
        500,
        'SERVER_ERROR',
        `Failed to create ${name}.`
      );
    }
  });

  app.put(`${route}/:id`, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return extensionError(res, 400, 'INVALID_ID', 'Invalid record ID.');
    }

    const payload = extensionPayload(req, resource, true);

    if (payload.error) {
      return extensionError(res, 400, payload.code, payload.error);
    }

    try {
      const fields = Object.keys(payload.values);

      const result = db.prepare(
        `UPDATE ${resource.table} SET ${fields.map(field => `${field} = ?`).join(', ')}${resource.hasUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : ''} WHERE id = ?`
      ).run(...fields.map(field => payload.values[field]), id);

      if (!result.changes) {
        return extensionError(
          res,
          404,
          'NOT_FOUND',
          `${name} record not found.`
        );
      }

      res.json(
        extensionRow(
          db.prepare(`SELECT * FROM ${resource.table} WHERE id = ?`).get(id)
        )
      );
    } catch (error) {
      if (error.code && error.code.startsWith('SQLITE_CONSTRAINT')) {
        return extensionError(
          res,
          409,
          'CONFLICT',
          'The update conflicts with an existing record.'
        );
      }

      console.error(`Error updating ${name}:`, error);

      extensionError(
        res,
        500,
        'SERVER_ERROR',
        `Failed to update ${name}.`
      );
    }
  });

  app.delete(`${route}/:id`, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return extensionError(res, 400, 'INVALID_ID', 'Invalid record ID.');
    }

    try {
      const result = db.prepare(
        `DELETE FROM ${resource.table} WHERE id = ?`
      ).run(id);

      if (!result.changes) {
        return extensionError(
          res,
          404,
          'NOT_FOUND',
          `${name} record not found.`
        );
      }

      res.json({ ok: true, id });
    } catch (error) {
      console.error(`Error deleting ${name}:`, error);

      extensionError(
        res,
        500,
        'SERVER_ERROR',
        `Failed to delete ${name}.`
      );
    }
  });
}

for (const [name, resource] of Object.entries(extensionResources)) {
  registerExtensionResource(name, resource, name);

  (resource.aliases || []).forEach(alias => {
    registerExtensionResource(name, resource, alias);
  });
}

app.get('/api/analytics/summary', (req, res) => {
  try {
    const summary = {
      rooms: db.prepare(
        'SELECT COUNT(*) AS total FROM rooms'
      ).get().total,

      bookings: db.prepare(
        "SELECT COUNT(*) AS total FROM bookings WHERE status = 'confirmed'"
      ).get().total,

      openMaintenance: db.prepare(
        "SELECT COUNT(*) AS total FROM maintenance_tickets WHERE status NOT IN ('resolved', 'closed')"
      ).get().total,

      housekeeping: db.prepare(
        'SELECT status, COUNT(*) AS total FROM housekeeping_status GROUP BY status'
      ).all()
    };

    res.json(summary);
  } catch (error) {
    console.error('Error reading analytics summary:', error);

    extensionError(
      res,
      500,
      'SERVER_ERROR',
      'Failed to retrieve analytics summary.'
    );
  }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(
      `Staybook operations server running at http://${HOST}:${PORT}`
    );

    console.log(
      `Access the dashboard in your browser: http://localhost:${PORT}`
    );
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n[Staybook] Error: Port ${PORT} is already in use.`
      );

      console.error(
        'You can either free port ${PORT} or specify a different port:'
      );

      console.error(
        '  PowerShell: $env:PORT=3001; npm start'
      );

      console.error(
        '  CMD:        set PORT=3001 && npm start\n'
      );
    } else {
      console.error('[Staybook] Server error:', err);
    }

    process.exit(1);
  });
}

module.exports = app;
