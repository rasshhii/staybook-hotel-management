# Staybook - Implementation Plan & Architecture

## 1. Overview
Staybook is a full-stack boutique hotel operations & room booking system adhering to the "Poolside Modernism" design philosophy. It delivers a calm, resort-inspired, editorial front-desk operational dashboard for managing hotel rooms, checking live date availability, reserving rooms without double-booking, and managing stays in real-time without page reloads.

## 2. Core Architecture
- **Backend**: Node.js + Express.js listening on `0.0.0.0:3000` (or `PORT`).
- **Database**: SQLite using `better-sqlite3`, stored at `data/staybook.db`.
- **Frontend**: Clean semantic HTML5, custom Poolside Modernism CSS, and vanilla browser JavaScript (`fetch` AJAX).
- **Date Handling & Conflict Avoidance**: Half-open date interval calculation (`existing.check_in < requested.check_out AND existing.check_out > requested.check_in`) executed inside transactional DB operations to guarantee zero double bookings.

## 3. UI/UX & Brand System: "Poolside Modernism"
- **Color Palette**:
  - Primary Pool Aqua: `#087E8B`
  - Dark Aqua: `#056674`
  - Deep Ink: `#102C35`
  - Deep Ink Background: `#08242D`
  - Soft Aqua: `#D9F1F1`
  - Warm Sun Yellow: `#F4D35E`
  - Paper Background: `#F6F8F6`
  - White: `#FFFFFF`
  - Border: `#DCE6E5`
  - Muted Gray: `#6B7C7F`
  - Coral Error: `#E16B52`
  - Dark input background: `#183943`
  - Dark input border: `#31545B`
- **Typography**: `Manrope` (weights 400-800).
- **Layout**:
  - Desktop: Vertical 76px brand rail with custom SVG mark, asymmetric layout with left main workspace and right sticky dark booking card.
  - Tablet/Mobile: Responsive horizontal top bar, fluid stacked columns, touch-friendly inputs.
- **Background**: 21:9 wide hotel photograph with pale translucent overlay.

## 4. RESTful API Specification
- `GET /api/health`: Service health check.
- `GET /api/rooms`: List all rooms with live computed status (Available, Occupied today, Maintenance, Inactive) and next check-in.
- `POST /api/rooms`: Add room with validations.
- `PUT /api/rooms/:id`: Edit room info.
- `DELETE /api/rooms/:id`: Delete room if no active/confirmed bookings exist.
- `GET /api/availability?type=&checkIn=&checkOut=`: Return non-conflicting rooms of status 'available'.
- `GET /api/bookings`: List all bookings sorted by check-in date.
- `POST /api/bookings`: Create booking with overlap validation.
- `DELETE /api/bookings/:id`: Cancel booking.

## 5. Implementation Phases
- Phase 1: Setup project structure, dependencies (`express`, `better-sqlite3`, `cors`), and configs.
- Phase 2: Database schema setup (`rooms`, `bookings`, indices) and seeding initial 6 rooms.
- Phase 3: Express REST API implementation with comprehensive validation and error handling.
- Phase 4: Frontend HTML structure, accessibility tags, semantic forms, and dialogs.
- Phase 5: CSS styling adhering strictly to "Poolside Modernism", Manrope typography, and responsive breakpoints.
- Phase 6: Frontend Vanilla JavaScript client for dynamic interactions, form handling, toasts, and real-time updates.
- Phase 7: Verification, edge case testing, and refinement.
