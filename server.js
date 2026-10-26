const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Database setup
const dbPath = path.join(dataDir, 'staybook.db');
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
  return !isNaN(d.getTime());
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
    const nextCheckInMap = new Map(nextCheckInRows.map(r => [r.room_id, r.nextCheckIn]));

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
    res.status(500).json({ error: 'Failed to retrieve rooms.', code: 'SERVER_ERROR' });
  }
});

// POST /api/rooms
app.post('/api/rooms', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.', code: 'INVALID_REQUEST' });
  }

  const { roomNo, type, price, status } = req.body;

  if (!roomNo || typeof roomNo !== 'string' || roomNo.trim() === '') {
    return res.status(400).json({ error: 'Room number is required.', code: 'INVALID_ROOM_NUMBER' });
  }

  if (!type || typeof type !== 'string' || type.trim() === '') {
    return res.status(400).json({ error: 'Room type is required.', code: 'INVALID_ROOM_TYPE' });
  }

  const numPrice = Number(price);
  if (isNaN(numPrice) || numPrice < 0) {
    return res.status(400).json({ error: 'Price must be a non-negative number.', code: 'INVALID_PRICE' });
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
    const existing = db.prepare('SELECT id FROM rooms WHERE room_no = ?').get(roomNo.trim());
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
    const result = insert.run(roomNo.trim(), type.trim(), numPrice, normalizedStatus);

    const created = db.prepare('SELECT id, room_no, type, price, status FROM rooms WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      id: created.id,
      roomNo: created.room_no,
      type: created.type,
      price: Number(created.price),
      status: created.status,
      currentStatus: created.status === 'available' ? 'Available' : (created.status === 'maintenance' ? 'Maintenance' : 'Inactive'),
      nextCheckIn: null
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room.', code: 'SERVER_ERROR' });
  }
});

// PUT /api/rooms/:id
app.put('/api/rooms/:id', (req, res) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID.', code: 'INVALID_ID' });
  }

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.', code: 'INVALID_REQUEST' });
  }

  const { roomNo, type, price, status } = req.body;

  const existingRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!existingRoom) {
    return res.status(404).json({ error: 'Room not found.', code: 'ROOM_NOT_FOUND' });
  }

  const updatedRoomNo = roomNo !== undefined ? String(roomNo).trim() : existingRoom.room_no;
  const updatedType = type !== undefined ? String(type).trim() : existingRoom.type;
  const updatedPrice = price !== undefined ? Number(price) : existingRoom.price;
  const updatedStatus = status !== undefined ? String(status).toLowerCase().trim() : existingRoom.status;

  if (!updatedRoomNo) {
    return res.status(400).json({ error: 'Room number cannot be empty.', code: 'INVALID_ROOM_NUMBER' });
  }
  if (!updatedType) {
    return res.status(400).json({ error: 'Room type cannot be empty.', code: 'INVALID_ROOM_TYPE' });
  }
  if (isNaN(updatedPrice) || updatedPrice < 0) {
    return res.status(400).json({ error: 'Price must be a non-negative number.', code: 'INVALID_PRICE' });
  }
  const validStatuses = ['available', 'maintenance', 'inactive'];
  if (!validStatuses.includes(updatedStatus)) {
    return res.status(400).json({ error: 'Status must be available, maintenance, or inactive.', code: 'INVALID_STATUS' });
  }

  // Check unique room number against other rooms
  const dupCheck = db.prepare('SELECT id FROM rooms WHERE room_no = ? AND id != ?').get(updatedRoomNo, roomId);
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

    const updated = db.prepare('SELECT id, room_no, type, price, status FROM rooms WHERE id = ?').get(roomId);
    res.json({
      id: updated.id,
      roomNo: updated.room_no,
      type: updated.type,
      price: Number(updated.price),
      status: updated.status
    });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ error: 'Failed to update room.', code: 'SERVER_ERROR' });
  }
});

// DELETE /api/rooms/:id
app.delete('/api/rooms/:id', (req, res) => {
  const roomId = parseInt(req.params.id, 10);
  if (isNaN(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID.', code: 'INVALID_ID' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.', code: 'ROOM_NOT_FOUND' });
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
    res.json({ ok: true, message: `Room ${room.room_no} successfully removed.` });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room.', code: 'SERVER_ERROR' });
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
    // 3. Not have an overlapping confirmed booking:
    //    Overlap logic: existing.check_in < requested.check_out AND existing.check_out > requested.check_in
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
    res.status(500).json({ error: 'Failed to search availability.', code: 'SERVER_ERROR' });
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
    res.status(500).json({ error: 'Failed to retrieve bookings.', code: 'SERVER_ERROR' });
  }
});

// POST /api/bookings
app.post('/api/bookings', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.', code: 'INVALID_REQUEST' });
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
      const room = db.prepare('SELECT id, room_no, type, price, status FROM rooms WHERE id = ?').get(parsedRoomId);
      if (!room) {
        const err = new Error('Room not found.');
        err.statusCode = 404;
        err.code = 'ROOM_NOT_FOUND';
        throw err;
      }

      if (room.status.toLowerCase() !== 'available') {
        const err = new Error(`Room ${room.room_no} is currently marked as ${room.status} and cannot be booked.`);
        err.statusCode = 400;
        err.code = 'ROOM_UNAVAILABLE';
        throw err;
      }

      // 2. Overlap check with half-open interval:
      // existing.check_in < requested.check_out AND existing.check_out > requested.check_in
      const conflict = db.prepare(`
        SELECT id FROM bookings
        WHERE room_id = ?
          AND status = 'confirmed'
          AND check_in < ?
          AND check_out > ?
        LIMIT 1
      `).get(parsedRoomId, checkOut, checkIn);

      if (conflict) {
        const err = new Error('Those dates overlap an existing reservation. Try another room or date range.');
        err.statusCode = 409;
        err.code = 'BOOKING_CONFLICT';
        throw err;
      }

      // 3. Insert reservation
      const insert = db.prepare(`
        INSERT INTO bookings (room_id, guest_name, check_in, check_out, status)
        VALUES (?, ?, ?, ?, 'confirmed')
      `);
      const result = insert.run(parsedRoomId, guestName.trim(), checkIn, checkOut);

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
    return res.status(400).json({ error: 'Invalid booking ID.', code: 'INVALID_ID' });
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
    res.status(500).json({ error: 'Failed to cancel booking.', code: 'SERVER_ERROR' });
  }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to index.html for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const server = app.listen(PORT, HOST, () => {
  console.log(`Staybook operations server running at http://${HOST}:${PORT}`);
  console.log(`Access the dashboard in your browser: http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Staybook] Error: Port ${PORT} is already in use.`);
    console.error(`You can either free port ${PORT} or specify a different port:`);
    console.error(`  PowerShell: $env:PORT=3001; npm start`);
    console.error(`  CMD:        set PORT=3001 && npm start\n`);
  } else {
    console.error('[Staybook] Server error:', err);
  }
  process.exit(1);
});
