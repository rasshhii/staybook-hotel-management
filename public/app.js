/**
 * Staybook — Poolside Modernism Boutique Hotel Operations Dashboard
 * Vanilla Browser JavaScript (No page reloads, RESTful fetch AJAX)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  const state = {
    rooms: [],
    bookings: [],
    roomTypes: new Set(),
    activeSearch: null, // { type, checkIn, checkOut }
    pendingAction: null // for confirm dialog
  };

  // ==========================================
  // CURRENCY & FORMATTING HELPERS
  // ==========================================
  const formatMoney = (value) =>
    `₹${Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;

  const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const formatDateDisplay = (dateString) => {
    if (!dateString) return '';
    try {
      const [year, month, day] = dateString.split('-');
      const date = new Date(year, parseInt(month, 10) - 1, day);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  };

  const getTodayISOString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getTomorrowISOString = (fromISO) => {
    const base = fromISO ? new Date(fromISO + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + 1);
    const year = base.getFullYear();
    const month = String(base.getMonth() + 1).padStart(2, '0');
    const day = String(base.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // ==========================================
  // DOM ELEMENT REFERENCES
  // ==========================================
  const liveDeskDateEl = document.getElementById('liveDeskDate');
  const searchForm = document.getElementById('searchForm');
  const searchRoomType = document.getElementById('searchRoomType');
  const searchCheckIn = document.getElementById('searchCheckIn');
  const searchCheckOut = document.getElementById('searchCheckOut');
  const btnResetSearch = document.getElementById('btnResetSearch');
  const availabilityStateNotice = document.getElementById('availabilityStateNotice');
  const availabilityResultsGrid = document.getElementById('availabilityResultsGrid');

  const btnOpenAddRoom = document.getElementById('btnOpenAddRoom');
  const roomsTableBody = document.getElementById('roomsTableBody');
  const emptyRoomsNotice = document.getElementById('emptyRoomsNotice');

  const bookingForm = document.getElementById('bookingForm');
  const bookingGuestName = document.getElementById('bookingGuestName');
  const bookingRoomSelect = document.getElementById('bookingRoomSelect');
  const bookingCheckIn = document.getElementById('bookingCheckIn');
  const bookingCheckOut = document.getElementById('bookingCheckOut');
  const bookingInlineAlert = document.getElementById('bookingInlineAlert');

  const sectionLedger = document.getElementById('sectionLedger');
  const ledgerTableBody = document.getElementById('ledgerTableBody');
  const emptyLedgerNotice = document.getElementById('emptyLedgerNotice');
  const activeStaysCount = document.getElementById('activeStaysCount');

  const roomDialog = document.getElementById('roomDialog');
  const dialogTitle = document.getElementById('dialogTitle');
  const roomForm = document.getElementById('roomForm');
  const roomFormId = document.getElementById('roomFormId');
  const roomFormNumber = document.getElementById('roomFormNumber');
  const roomFormType = document.getElementById('roomFormType');
  const roomFormPrice = document.getElementById('roomFormPrice');
  const roomFormStatus = document.getElementById('roomFormStatus');
  const roomDialogAlert = document.getElementById('roomDialogAlert');
  const btnCloseRoomDialog = document.getElementById('btnCloseRoomDialog');
  const btnCancelRoom = document.getElementById('btnCancelRoom');

  const confirmDialog = document.getElementById('confirmDialog');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const btnCloseConfirmDialog = document.getElementById('btnCloseConfirmDialog');
  const btnConfirmCancel = document.getElementById('btnConfirmCancel');
  const btnConfirmProceed = document.getElementById('btnConfirmProceed');

  const toastContainer = document.getElementById('toastContainer');

  // ==========================================
  // TOAST NOTIFICATIONS (Restrained Animation)
  // ==========================================
  function showToast(message, type = 'normal') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : (type === 'yellow' ? 'toast-yellow' : '')}`;
    toast.setAttribute('role', 'status');
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 200);
    }, 3600);
  }

  // ==========================================
  // DYNAMIC HEADER DATE
  // ==========================================
  function initHeaderDate() {
    const now = new Date();
    const month = now.toLocaleDateString('en-US', { month: 'short' });
    const day = now.getDate();
    if (liveDeskDateEl) {
      liveDeskDateEl.textContent = `Live desk · ${month} ${day}`;
    }
  }

  // Set min dates on date inputs
  const todayISO = getTodayISOString();
  const tomorrowISO = getTomorrowISOString(todayISO);
  if (searchCheckIn) searchCheckIn.min = todayISO;
  if (searchCheckOut) searchCheckOut.min = tomorrowISO;
  if (bookingCheckIn) bookingCheckIn.min = todayISO;
  if (bookingCheckOut) bookingCheckOut.min = tomorrowISO;

  // Auto-advance checkout min when checkin changes
  searchCheckIn.addEventListener('change', () => {
    if (searchCheckIn.value) {
      const nextDay = getTomorrowISOString(searchCheckIn.value);
      searchCheckOut.min = nextDay;
      if (!searchCheckOut.value || searchCheckOut.value <= searchCheckIn.value) {
        searchCheckOut.value = nextDay;
      }
    }
  });

  bookingCheckIn.addEventListener('change', () => {
    if (bookingCheckIn.value) {
      const nextDay = getTomorrowISOString(bookingCheckIn.value);
      bookingCheckOut.min = nextDay;
      if (!bookingCheckOut.value || bookingCheckOut.value <= bookingCheckIn.value) {
        bookingCheckOut.value = nextDay;
      }
      updateBookingRoomOptions();
    }
  });

  bookingCheckOut.addEventListener('change', () => {
    if (bookingCheckIn.value && bookingCheckOut.value) {
      updateBookingRoomOptions();
    }
  });

  // ==========================================
  // DATA FETCHING & API SERVICES
  // ==========================================
  async function fetchRooms() {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) throw new Error('Failed to fetch rooms');
      const data = await res.json();
      state.rooms = data;

      // Extract unique room types for search dropdown & datalist
      state.roomTypes.clear();
      data.forEach(r => state.roomTypes.add(r.type));
      populateRoomTypeDropdown();

      renderRoomsTable();
      updateBookingRoomOptions();
      renderHousekeeping();
      const maintenanceRoom = document.getElementById('maintenanceRoom');
      if (maintenanceRoom) {
        maintenanceRoom.innerHTML = '<option value="">Room</option>' + state.rooms.map(room => `<option value="${room.id}">Room ${escapeHTML(room.roomNo)}</option>`).join('');
      }
    } catch (err) {
      console.error(err);
      showToast('Could not load room board. Check network connection.', 'error');
    }
  }

  async function fetchBookings() {
    try {
      const res = await fetch('/api/bookings');
      if (!res.ok) throw new Error('Failed to fetch bookings');
      const data = await res.json();
      state.bookings = data;
      populateCheckinBookings();
      renderBookingLedger();
      // Also re-render rooms in case status changed
      renderRoomsTable();
    } catch (err) {
      console.error(err);
      showToast('Could not load booking ledger.', 'error');
    }
  }

  // Populate room types in search filter
  function populateRoomTypeDropdown() {
    const currentVal = searchRoomType.value;
    searchRoomType.innerHTML = '<option value="">All room types</option>';
    Array.from(state.roomTypes).sort().forEach(type => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = type;
      if (type === currentVal) opt.selected = true;
      searchRoomType.appendChild(opt);
    });
  }

  // ==========================================
  // RENDER: SECTION 02 ROOM DIRECTORY
  // ==========================================
  function renderRoomsTable() {
    if (!roomsTableBody) return;
    roomsTableBody.innerHTML = '';

    if (!state.rooms || state.rooms.length === 0) {
      if (emptyRoomsNotice) emptyRoomsNotice.style.display = 'block';
      return;
    }
    if (emptyRoomsNotice) emptyRoomsNotice.style.display = 'none';

    state.rooms.forEach(room => {
      const tr = document.createElement('tr');

      // Status pill styling
      let statusClass = 'status-available';
      let dotHTML = '<span class="status-dot" aria-hidden="true"></span>';
      const statusText = room.currentStatus || 'Available';

      if (statusText === 'Occupied today') {
        statusClass = 'status-occupied';
        dotHTML = '';
      } else if (statusText === 'Maintenance') {
        statusClass = 'status-maintenance';
        dotHTML = '';
      } else if (statusText === 'Inactive') {
        statusClass = 'status-inactive';
        dotHTML = '';
      }

      tr.innerHTML = `
        <td class="td-room-no">${escapeHTML(room.roomNo)}</td>
        <td class="col-type">${escapeHTML(room.type)}</td>
        <td class="col-price"><span class="tnum">${formatMoney(room.price)}</span><span class="td-price-unit">/ night</span></td>
        <td class="col-status">
          <span class="status-pill ${statusClass}">
            ${dotHTML}
            <span>${escapeHTML(statusText)}</span>
          </span>
        </td>
        <td class="col-actions">
          <button type="button" class="row-action-btn btn-edit" data-id="${room.id}">Edit</button>
          <button type="button" class="row-action-btn btn-delete" data-id="${room.id}" data-room="${escapeHTML(room.roomNo)}">Delete</button>
        </td>
      `;

      // Event listeners for actions
      const btnEdit = tr.querySelector('.btn-edit');
      btnEdit.addEventListener('click', () => openEditRoomDialog(room));

      const btnDelete = tr.querySelector('.btn-delete');
      btnDelete.addEventListener('click', () => confirmDeleteRoom(room));

      roomsTableBody.appendChild(tr);
    });
  }

  // ==========================================
  // RENDER: SECTION 03 BOOKING LEDGER
  // ==========================================
  function renderBookingLedger() {
    if (!ledgerTableBody) return;
    ledgerTableBody.innerHTML = '';

    const count = state.bookings.length;
    if (activeStaysCount) {
      activeStaysCount.textContent = count === 1 ? '1 active stay' : `${count} active stays`;
    }

    if (count === 0) {
      if (emptyLedgerNotice) emptyLedgerNotice.style.display = 'block';
      return;
    }
    if (emptyLedgerNotice) emptyLedgerNotice.style.display = 'none';

    state.bookings.forEach(b => {
      const tr = document.createElement('tr');
      const roomDesc = b.room ? `${b.room.roomNo} ${b.room.type}` : 'Room';

      tr.innerHTML = `
        <td class="td-guest"><strong>${escapeHTML(b.guestName)}</strong></td>
        <td class="col-room">${escapeHTML(roomDesc)}</td>
        <td class="col-checkin">${escapeHTML(formatDateDisplay(b.checkIn))}</td>
        <td class="col-checkout">${escapeHTML(formatDateDisplay(b.checkOut))}</td>
        <td class="col-cancel">
          <button type="button" class="row-action-btn btn-cancel" data-id="${b.id}" data-guest="${escapeHTML(b.guestName)}" data-room="${escapeHTML(b.room?.roomNo || '')}">
            Cancel
          </button>
        </td>
      `;

      const btnCancel = tr.querySelector('.btn-cancel');
      btnCancel.addEventListener('click', () => {
        confirmCancelBooking(b);
      });

      ledgerTableBody.appendChild(tr);
    });
  }

  // ==========================================
  // SECTION 01: AVAILABILITY SEARCH
  // ==========================================
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const type = searchRoomType.value.trim();
    const checkIn = searchCheckIn.value;
    const checkOut = searchCheckOut.value;

    if (!checkIn || !checkOut) {
      availabilityStateNotice.textContent = 'Please choose both check-in and check-out dates to search availability.';
      availabilityStateNotice.className = 'search-state-message empty';
      availabilityResultsGrid.style.display = 'none';
      return;
    }

    if (checkOut <= checkIn) {
      availabilityStateNotice.textContent = 'Check-out date must be after check-in date.';
      availabilityStateNotice.className = 'search-state-message empty';
      availabilityResultsGrid.style.display = 'none';
      return;
    }

    state.activeSearch = { type, checkIn, checkOut };
    btnResetSearch.style.display = 'inline-flex';

    await executeAvailabilitySearch(type, checkIn, checkOut);
  });

  btnResetSearch.addEventListener('click', () => {
    state.activeSearch = null;
    searchForm.reset();
    btnResetSearch.style.display = 'none';
    availabilityResultsGrid.style.display = 'none';
    availabilityResultsGrid.innerHTML = '';
    availabilityStateNotice.textContent = 'Choose dates to see which rooms can make the stay.';
    availabilityStateNotice.className = 'search-state-message';
    updateBookingRoomOptions();
  });

  async function executeAvailabilitySearch(type, checkIn, checkOut) {
    try {
      const params = new URLSearchParams({ checkIn, checkOut });
      if (type) params.append('type', type);

      const res = await fetch(`/api/availability?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to search rooms');
      }

      const availableRooms = await res.json();
      renderAvailabilityResults(availableRooms, checkIn, checkOut);
      updateBookingRoomOptions(availableRooms);
    } catch (err) {
      console.error(err);
      availabilityResultsGrid.style.display = 'none';
      availabilityStateNotice.textContent = err.message || 'Error checking availability.';
      availabilityStateNotice.className = 'search-state-message empty';
    }
  }

  function renderAvailabilityResults(rooms, checkIn, checkOut) {
    if (!rooms || rooms.length === 0) {
      availabilityResultsGrid.style.display = 'none';
      availabilityResultsGrid.innerHTML = '';
      availabilityStateNotice.textContent = 'No rooms match those dates. Try another window or clear the room type.';
      availabilityStateNotice.className = 'search-state-message empty';
      return;
    }

    const count = rooms.length;
    availabilityStateNotice.textContent = count === 1
      ? '1 room open for those dates.'
      : `${count} rooms open for those dates.`;
    availabilityStateNotice.className = 'search-state-message success';

    availabilityResultsGrid.innerHTML = '';
    availabilityResultsGrid.style.display = 'grid';

    rooms.forEach(room => {
      const card = document.createElement('div');
      card.className = 'room-avail-card';
      card.innerHTML = `
        <div class="avail-card-header">
          <div>
            <div class="avail-room-no">${escapeHTML(room.roomNo)}</div>
            <div class="avail-room-type">${escapeHTML(room.type)}</div>
          </div>
          <div class="avail-price-row">
            <span class="avail-price-val tnum">${formatMoney(room.price)}</span>
            <span class="avail-price-unit">/ night</span>
          </div>
        </div>
        <button type="button" class="btn-choose-room" data-id="${room.id}" data-no="${escapeHTML(room.roomNo)}" data-type="${escapeHTML(room.type)}" data-price="${room.price}">
          Choose
        </button>
      `;

      const btnChoose = card.querySelector('.btn-choose-room');
      btnChoose.addEventListener('click', () => {
        selectRoomForBooking(room.id, checkIn, checkOut);
      });

      availabilityResultsGrid.appendChild(card);
    });
  }

  // Pre-fill booking card when user chooses a room card
  function selectRoomForBooking(roomId, checkIn, checkOut) {
    bookingCheckIn.value = checkIn;
    bookingCheckOut.value = checkOut;
    bookingCheckOut.min = getTomorrowISOString(checkIn);

    updateBookingRoomOptions();
    bookingRoomSelect.value = roomId;

    hideBookingAlert();

    // Focus guest name in the booking card
    bookingGuestName.focus();
    bookingGuestName.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(`Room selected. Enter guest name to confirm stay.`, 'yellow');
  }

  // ==========================================
  // BOOKING PANEL LOGIC
  // ==========================================
  function updateBookingRoomOptions(overrideAvailableRooms = null) {
    if (!bookingRoomSelect) return;
    const currentVal = bookingRoomSelect.value;
    bookingRoomSelect.innerHTML = '';

    // If an explicit list of available rooms is provided (e.g. from search), use it
    const candidateRooms = overrideAvailableRooms || state.rooms.filter(r => r.status === 'available');

    if (candidateRooms.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No available rooms found';
      bookingRoomSelect.appendChild(opt);
      return;
    }

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = overrideAvailableRooms ? 'Choose an available room' : 'Search availability first';
    bookingRoomSelect.appendChild(defaultOpt);

    candidateRooms.forEach(room => {
      const opt = document.createElement('option');
      opt.value = room.id;
      // Room option format: Room 101 · Garden King · ₹185
      opt.textContent = `Room ${room.roomNo} · ${room.type} · ${formatMoney(room.price)}`;
      if (String(room.id) === String(currentVal)) {
        opt.selected = true;
      }
      bookingRoomSelect.appendChild(opt);
    });
  }

  function showBookingAlert(msg, type = 'error') {
    bookingInlineAlert.textContent = msg;
    bookingInlineAlert.className = `booking-inline-alert ${type}`;
    bookingInlineAlert.style.display = 'block';
  }

  function hideBookingAlert() {
    bookingInlineAlert.style.display = 'none';
    bookingInlineAlert.textContent = '';
  }

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBookingAlert();

    const guestName = bookingGuestName.value.trim();
    const roomId = bookingRoomSelect.value;
    const checkIn = bookingCheckIn.value;
    const checkOut = bookingCheckOut.value;

    if (!guestName) {
      showBookingAlert('Please enter guest name.');
      bookingGuestName.focus();
      return;
    }

    if (!roomId) {
      showBookingAlert('Please select a room.');
      bookingRoomSelect.focus();
      return;
    }

    if (!checkIn || !checkOut) {
      showBookingAlert('Please select check-in and check-out dates.');
      return;
    }

    if (checkOut <= checkIn) {
      showBookingAlert('Check-out date must be after check-in date.');
      return;
    }

    const today = getTodayISOString();
    if (checkIn < today) {
      showBookingAlert('Check-in date cannot be in the past.');
      return;
    }

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName,
          roomId: parseInt(roomId, 10),
          checkIn,
          checkOut
        })
      });

      const data = await res.json();

      if (!res.ok) {
        showBookingAlert(data.error || 'Failed to confirm booking.');
        return;
      }

      // Success
      bookingForm.reset();
      showBookingAlert('Stay confirmed. The board is up to date.', 'success');
      showToast('New stay confirmed.');

      // Refresh data
      await fetchBookings();
      await fetchRooms();

      // Refresh availability search if active
      if (state.activeSearch) {
        await executeAvailabilitySearch(state.activeSearch.type, state.activeSearch.checkIn, state.activeSearch.checkOut);
      }
    } catch (err) {
      console.error(err);
      showBookingAlert('An unexpected error occurred while confirming booking.');
    }
  });

  // ==========================================
  // ROOM MODAL (ADD / EDIT)
  // ==========================================
  btnOpenAddRoom.addEventListener('click', () => {
    openAddRoomDialog();
  });

  function openAddRoomDialog() {
    dialogTitle.textContent = 'Add a room';
    roomForm.reset();
    roomFormId.value = '';
    roomFormStatus.value = 'available';
    hideRoomDialogAlert();
    roomDialog.showModal();
    roomFormNumber.focus();
  }

  function openEditRoomDialog(room) {
    dialogTitle.textContent = 'Edit room';
    roomForm.reset();
    roomFormId.value = room.id;
    roomFormNumber.value = room.roomNo;
    roomFormType.value = room.type;
    roomFormPrice.value = room.price;
    roomFormStatus.value = room.status;
    hideRoomDialogAlert();
    roomDialog.showModal();
    roomFormNumber.focus();
  }

  function closeRoomDialog() {
    roomDialog.close();
  }

  btnCloseRoomDialog.addEventListener('click', closeRoomDialog);
  btnCancelRoom.addEventListener('click', closeRoomDialog);

  function showRoomDialogAlert(msg) {
    roomDialogAlert.textContent = msg;
    roomDialogAlert.className = 'dialog-alert error';
    roomDialogAlert.style.display = 'block';
  }

  function hideRoomDialogAlert() {
    roomDialogAlert.style.display = 'none';
    roomDialogAlert.textContent = '';
  }

  roomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideRoomDialogAlert();

    const id = roomFormId.value;
    const roomNo = roomFormNumber.value.trim();
    const type = roomFormType.value.trim();
    const price = parseFloat(roomFormPrice.value);
    const status = roomFormStatus.value;

    if (!roomNo) {
      showRoomDialogAlert('Room number is required.');
      roomFormNumber.focus();
      return;
    }

    if (!type) {
      showRoomDialogAlert('Room type is required.');
      roomFormType.focus();
      return;
    }

    if (isNaN(price) || price < 0) {
      showRoomDialogAlert('Price must be a non-negative number.');
      roomFormPrice.focus();
      return;
    }

    const payload = { roomNo, type, price, status };
    const isEdit = Boolean(id);
    const url = isEdit ? `/api/rooms/${id}` : '/api/rooms';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        showRoomDialogAlert(data.error || 'Failed to save room.');
        return;
      }

      closeRoomDialog();
      showToast(isEdit ? `Room ${data.roomNo} updated.` : `Room ${data.roomNo} added to board.`);

      await fetchRooms();
      if (state.activeSearch) {
        await executeAvailabilitySearch(state.activeSearch.type, state.activeSearch.checkIn, state.activeSearch.checkOut);
      }
    } catch (err) {
      console.error(err);
      showRoomDialogAlert('An unexpected error occurred.');
    }
  });

  // ==========================================
  // CONFIRM DIALOG (DELETE ROOM / CANCEL BOOKING)
  // ==========================================
  function confirmDeleteRoom(room) {
    confirmTitle.textContent = 'Remove Room';
    confirmMessage.textContent = `Are you sure you want to remove Room ${room.roomNo} (${room.type}) from the room board? This cannot be undone.`;
    btnConfirmProceed.textContent = 'Delete room';

    state.pendingAction = async () => {
      try {
        const res = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' });
        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || 'Failed to delete room.', 'error');
          return;
        }

        showToast(`Room ${room.roomNo} removed.`);
        await fetchRooms();
        if (state.activeSearch) {
          await executeAvailabilitySearch(state.activeSearch.type, state.activeSearch.checkIn, state.activeSearch.checkOut);
        }
      } catch (err) {
        console.error(err);
        showToast('Network error while deleting room.', 'error');
      }
    };

    confirmDialog.showModal();
  }

  function confirmCancelBooking(booking) {
    confirmTitle.textContent = 'Cancel Reservation';
    // Exact wording requested: Cancel Maya Chen’s stay in room 101?
    const roomNo = booking.room ? booking.room.roomNo : '';
    confirmMessage.textContent = `Cancel ${booking.guestName}’s stay in room ${roomNo}?`;
    btnConfirmProceed.textContent = 'Cancel stay';

    state.pendingAction = async () => {
      try {
        const res = await fetch(`/api/bookings/${booking.id}`, { method: 'DELETE' });
        const data = await res.json();

        if (!res.ok) {
          // Missing booking error requirement:
          // Booking not found. It may already be cancelled.
          showToast(data.error || 'Booking not found. It may already be cancelled.', 'error');
          await fetchBookings();
          return;
        }

        // Success toast requirement:
        // Booking cancelled.
        showToast('Booking cancelled.');
        await fetchBookings();
        await fetchRooms();
        if (state.activeSearch) {
          await executeAvailabilitySearch(state.activeSearch.type, state.activeSearch.checkIn, state.activeSearch.checkOut);
        }
      } catch (err) {
        console.error(err);
        showToast('Network error while cancelling booking.', 'error');
      }
    };

    confirmDialog.showModal();
  }

  btnConfirmProceed.addEventListener('click', async () => {
    confirmDialog.close();
    if (typeof state.pendingAction === 'function') {
      const action = state.pendingAction;
      state.pendingAction = null;
      await action();
    }
  });

  btnCloseConfirmDialog.addEventListener('click', () => {
    confirmDialog.close();
    state.pendingAction = null;
  });

  btnConfirmCancel.addEventListener('click', () => {
    confirmDialog.close();
    state.pendingAction = null;
  });

  // ==========================================
  // SECTION 04: CALM OPERATIONS WORKSPACE
  // ==========================================
  const operationsState = {
    housekeeping: [],
    maintenance: [],
    guests: [],
    addons: []
  };
  const operationFetch = async (url, options) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Operation failed.');
    return data;
  };

  function renderHousekeeping() {
    const list = document.getElementById('housekeepingList');
    if (!list) return;
    const statuses = ['clean', 'cleaning', 'inspected', 'ready'];
    list.innerHTML = state.rooms.map(room => {
      const record = operationsState.housekeeping.find(item => item.room_id === room.id);
      const current = record ? record.status : 'clean';
      return `<div class="operations-list-item">
        <div><strong>Room ${escapeHTML(room.roomNo)}</strong><small>${escapeHTML(room.type)} · ${escapeHTML(current)}</small></div>
        <div class="state-buttons">${statuses.map(status => `<button type="button" class="state-button ${current === status ? 'active' : ''}" data-room-id="${room.id}" data-state="${status}">${status}</button>`).join('')}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.state-button').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          const roomId = Number(button.dataset.roomId);
          const existing = operationsState.housekeeping.find(item => item.room_id === roomId);
          const method = existing ? 'PUT' : 'POST';
          const url = existing ? `/api/housekeeping/${existing.id}` : '/api/housekeeping';
          await operationFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId, status: button.dataset.state })
          });
          await loadOperations();
          showToast(`Room ${state.rooms.find(room => room.id === roomId)?.roomNo || ''} marked ${button.dataset.state}.`);
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });
  }

  function renderMaintenance() {
    const list = document.getElementById('maintenanceList');
    if (!list) return;
    list.innerHTML = operationsState.maintenance.length
      ? operationsState.maintenance.slice(0, 5).map(ticket => `<div class="operations-list-item">
          <div><strong>${escapeHTML(ticket.title)}</strong><small>${ticket.room_id ? `Room ${ticket.room_id}` : 'Property'} · ${escapeHTML(ticket.priority)}</small></div>
          <small>${escapeHTML(ticket.status)}</small>
        </div>`).join('')
      : '<p class="panel-empty">No open repairs. A quiet board is a good board.</p>';
  }

  function renderAddons() {
    const list = document.getElementById('addonList');
    if (!list) return;
    list.innerHTML = operationsState.addons.filter(addon => addon.active).map(addon =>
      `<span class="tag-item">${escapeHTML(addon.name)} · ${formatMoney(addon.price)}</span>`
    ).join('') || '<span class="panel-empty">No add-ons configured.</span>';
  }

  async function loadOperations() {
    try {
      const [summary, housekeeping, maintenance, guests, addons] = await Promise.all([
        operationFetch('/api/analytics/summary'),
        operationFetch('/api/housekeeping'),
        operationFetch('/api/maintenance'),
        operationFetch('/api/guests'),
        operationFetch('/api/addons')
      ]);
      operationsState.housekeeping = housekeeping;
      operationsState.maintenance = maintenance.filter(ticket => !['resolved', 'closed'].includes(ticket.status));
      operationsState.guests = guests;
      operationsState.addons = addons;
      document.getElementById('metricRooms').textContent = summary.rooms;
      document.getElementById('metricBookings').textContent = summary.bookings;
      document.getElementById('metricMaintenance').textContent = summary.openMaintenance;
      renderHousekeeping();
      renderMaintenance();
      renderAddons();
      const roomSelect = document.getElementById('maintenanceRoom');
      roomSelect.innerHTML = '<option value="">Room</option>' + state.rooms.map(room => `<option value="${room.id}">Room ${escapeHTML(room.roomNo)}</option>`).join('');
    } catch (error) {
      console.error(error);
      showToast('Operations workspace could not be loaded.', 'error');
    }
  }

  document.getElementById('guestProfileForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('guestProfileStatus');
    try {
      const guest = await operationFetch('/api/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: document.getElementById('guestNameProfile').value.trim(),
          email: document.getElementById('guestEmailProfile').value.trim(),
          phone: document.getElementById('guestPhoneProfile').value.trim()
        })
      });
      const preference = document.getElementById('guestPreferenceProfile').value.trim();
      if (preference) {
        await operationFetch('/api/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestId: guest.id, preferenceKey: 'stay-preference', preferenceValue: preference })
        });
      }
      status.textContent = 'Guest profile saved locally.';
      event.target.reset();
      await loadOperations();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.getElementById('maintenanceForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await operationFetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: document.getElementById('maintenanceRoom').value || undefined,
          title: document.getElementById('maintenanceTitle').value.trim(),
          priority: document.getElementById('maintenancePriority').value
        })
      });
      event.target.reset();
      showToast('Repair added to the maintenance desk.');
      await loadOperations();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  document.getElementById('btnCreateCheckin').addEventListener('click', async () => {
    const bookingId = document.getElementById('checkinBooking').value;
    const status = document.getElementById('checkinStatus');
    if (!bookingId) {
      status.textContent = 'Choose a booking first.';
      return;
    }
    try {
      await operationFetch('/api/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, status: 'invited' })
      });
      status.textContent = 'Digital check-in created locally.';
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.getElementById('btnAddAddon').addEventListener('click', async () => {
    const name = document.getElementById('addonName').value.trim();
    const price = Number(document.getElementById('addonPrice').value);
    if (!name || !Number.isFinite(price) || price < 0) return showToast('Enter an add-on name and valid price.', 'error');
    try {
      await operationFetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price, active: true })
      });
      document.getElementById('addonName').value = '';
      document.getElementById('addonPrice').value = '';
      await loadOperations();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  function populateCheckinBookings() {
    const select = document.getElementById('checkinBooking');
    select.innerHTML = '<option value="">Choose booking</option>' + state.bookings.map(booking =>
      `<option value="${booking.id}">${escapeHTML(booking.guestName)} · Room ${escapeHTML(booking.room?.roomNo || '')}</option>`
    ).join('');
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================
  initHeaderDate();
  fetchRooms();
  fetchBookings();
  loadOperations();
});
