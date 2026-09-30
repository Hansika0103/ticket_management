const STORAGE_KEYS = {
  users: "bookease_date_users_v1",
  events: "bookease_date_events_v1",
  bookings: "bookease_date_bookings_v1",
  session: "bookease_date_current_user_v1"
};

const BOOKING_CUTOFF_MINUTES = 30;
const CANCELLATION_CUTOFF_HOURS = 2;
const MAX_TICKETS_PER_BOOKING = 10;

let users = [];
let events = [];
let bookings = [];
let currentUser = null;
let selectedCategory = "All";
let selectedSeats = [];

const $ = (id) => document.getElementById(id);

function formatMoney(amount) {
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

function formatDateTime(dateTime) {
  return new Date(dateTime).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getShowDates(event) {
  return event.category === "Movies"
    ? event.showDates
    : [event.dateTime];
}

function getAvailableSeats(event, showDateTime) {
  const booked = event.seatMap?.[showDateTime] || [];
  return event.totalSeats - booked.length;
}

function getBookedSeats(event, showDateTime) {
  return event.seatMap?.[showDateTime] || [];
}

function createId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function readStorage(key, defaultValue) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isValidEmail(email) {
  const emailPattern =
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  return emailPattern.test(email);
}

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast${isError ? " error" : ""}`;

  setTimeout(() => {
    toast.className = "toast hidden";
  }, 3000);
}

function createEmptySeatMap(event) {
  const map = {};
  getShowDates(event).forEach((show) => {
    map[show] = [];
  });
  return map;
}

/* Add the new seat structure to old saved event data. */
function normalizeEvents(eventList) {
  return eventList.map((event) => {
    const normalized = { ...event };

    normalized.totalSeats = Number(
      event.totalSeats || event.availableSeats || 40
    );

    normalized.seatMap = event.seatMap || createEmptySeatMap(normalized);

    getShowDates(normalized).forEach((show) => {
      if (!Array.isArray(normalized.seatMap[show])) {
        normalized.seatMap[show] = [];
      }
    });

    return normalized;
  });
}

function rebuildSeatMapsFromBookings() {
  // Start with the seatMap from the fresh events.json file.
  // Then restore seats belonging to confirmed bookings.
  bookings
    .filter((booking) => booking.status === "Confirmed")
    .forEach((booking) => {
      const event = events.find(
        (item) => item.id === booking.eventId
      );

      if (!event || !booking.selectedDateTime) return;

      if (!Array.isArray(event.seatMap[booking.selectedDateTime])) {
        event.seatMap[booking.selectedDateTime] = [];
      }

      const currentSeats = event.seatMap[booking.selectedDateTime];
      const bookingSeats = Array.isArray(booking.seats)
        ? booking.seats
        : [];

      bookingSeats.forEach((seat) => {
        if (!currentSeats.includes(seat)) {
          currentSeats.push(seat);
        }
      });

      event.seatMap[booking.selectedDateTime].sort(
        (a, b) => a - b
      );
    });
}

async function initialize() {
  const [usersResponse, eventsResponse] = await Promise.all([
    fetch("users.json"),
    fetch("events.json")
  ]);

  if (!usersResponse.ok || !eventsResponse.ok) {
    throw new Error("Could not load users.json or events.json");
  }

  const jsonUsers = await usersResponse.json();
  const jsonEvents = await eventsResponse.json();

  // Users can remain in localStorage because new registrations are
  // created by the application. Event details, however, always come
  // from events.json so your JSON edits appear after refresh.
  users = readStorage(STORAGE_KEYS.users, jsonUsers);
  bookings = readStorage(STORAGE_KEYS.bookings, []);

  // IMPORTANT: always read the latest event information from events.json.
  events = normalizeEvents(jsonEvents);

  // Restore only booking-related seat information from booking history.
  // This keeps event name, price, venue, dates, images, etc. controlled
  // by events.json while keeping already-booked seats persistent.
  rebuildSeatMapsFromBookings();

  currentUser = JSON.parse(
    sessionStorage.getItem(STORAGE_KEYS.session) || "null"
  );

  if (currentUser) {
    showApp();
  }
}

function switchAuthView(viewId) {
  document.querySelectorAll(".auth-tab").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.authView === viewId
    );
  });

  $("loginForm").classList.toggle("hidden", viewId !== "loginForm");
  $("registerForm").classList.toggle("hidden", viewId !== "registerForm");
}

function login(event) {
  event.preventDefault();

  const userId = $("loginUserId").value.trim().toUpperCase();
  const password = $("loginPassword").value;

  const user = users.find(
    (item) => item.id === userId && item.password === password
  );

  if (!user) {
    showToast("Invalid User ID or password.", true);
    return;
  }

  currentUser = {
    id: user.id,
    name: user.name,
    email: user.email
  };

  sessionStorage.setItem(
    STORAGE_KEYS.session,
    JSON.stringify(currentUser)
  );

  $("loginForm").reset();
  showApp();
  showToast(`Welcome, ${currentUser.name}!`);
}

function register(event) {
  event.preventDefault();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const userId = $("registerUserId").value.trim().toUpperCase();
  const password = $("registerPassword").value;
  const confirmPassword = $("confirmPassword").value;
  const userIdPattern = /^[A-Z0-9_]{3,20}$/;

  if (!/^[A-Za-z ]{2,50}$/.test(name)) {
    showToast("Name should contain only letters and spaces.", true);
    return;
  }

  if (!isValidEmail(email)) {
    showToast("Please enter a valid email address.", true);
    return;
  }

  if (!userIdPattern.test(userId)) {
    showToast(
      "User ID must contain 3–20 letters, numbers, or underscores.",
      true
    );
    return;
  }

  if (users.some((user) => user.id === userId)) {
    showToast("This User ID already exists.", true);
    return;
  }

  if (users.some((user) => user.email.toLowerCase() === email)) {
    showToast("This email already has an account.", true);
    return;
  }

  if (password.length < 6) {
    showToast("Password must contain at least 6 characters.", true);
    return;
  }

  if (password !== confirmPassword) {
    showToast("Passwords do not match.", true);
    return;
  }

  const newUser = { id: userId, name, email, password };

  users.push(newUser);
  writeStorage(STORAGE_KEYS.users, users);

  currentUser = {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email
  };

  sessionStorage.setItem(
    STORAGE_KEYS.session,
    JSON.stringify(currentUser)
  );

  $("registerForm").reset();
  showApp();
  showToast("Account created successfully.");
}

function showApp() {
  $("authPage").classList.add("hidden");
  $("appPage").classList.remove("hidden");

  $("userGreeting").innerHTML =
    `Logged in as <b>${currentUser.name}</b> | User ID: <b>${currentUser.id}</b>`;

  renderFilters();
  renderEvents();
  updateBadge();
}

function logout() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
  currentUser = null;

  $("appPage").classList.add("hidden");
  $("authPage").classList.remove("hidden");

  switchAuthView("loginForm");
  showPage("events");
}

function updateBadge() {
  const activeBookings = bookings.filter(
    (booking) =>
      booking.userId === currentUser.id &&
      booking.status === "Confirmed"
  );

  $("bookingBadge").textContent = activeBookings.length;
}

function renderFilters() {
  const categories = ["All", "Shows", "Movies", "Games"];

  $("filterButtons").innerHTML = categories
    .map((category) => {
      const active =
        category === selectedCategory ? "active" : "";

      return `
        <button
          class="filter ${active}"
          onclick="selectCategory('${category}')"
        >
          ${category}
        </button>
      `;
    })
    .join("");
}

window.selectCategory = function selectCategory(category) {
  selectedCategory = category;
  renderFilters();
  renderEvents();
};

function getEventDisplayDate(event) {
  return getShowDates(event)[0];
}

function renderEvents() {
  const searchText =
    $("searchInput").value.trim().toLowerCase();

  const filteredEvents = events.filter((event) => {
    const content =
      `${event.name} ${event.category} ${event.venue}`.toLowerCase();

    const categoryMatches =
      selectedCategory === "All" ||
      event.category === selectedCategory;

    return categoryMatches && content.includes(searchText);
  });

  if (!filteredEvents.length) {
    $("eventGrid").innerHTML =
      `<div class="empty">No event matches your search.</div>`;
    return;
  }

  $("eventGrid").innerHTML = filteredEvents
    .map((event) => {
      const firstShow = getEventDisplayDate(event);
      const available = getAvailableSeats(event, firstShow);
      const dateLabel =
        event.category === "Movies"
          ? "First Show"
          : "Date & Time";

      return `
        <article class="event-card">
          <img
            class="event-image"
            src="${event.image}"
            alt="${event.name} event image"
          >

          <div class="card-content">
            <span class="tag">${event.category}</span>

            <h3>${event.name}</h3>

            <div class="meta">
              📍 ${event.venueType}: ${event.venue}<br>
              🗓 ${dateLabel}: ${formatDateTime(firstShow)}<br>
              💺 ${available} of ${event.totalSeats} seats available
            </div>

            <div class="card-footer">
              <span class="price">
                ${formatMoney(event.price)}
              </span>

              <button
                class="primary-btn"
                onclick="openBooking('${event.id}')"
              >
                View & Book
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
};

window.openBooking = function openBooking(eventId) {
  const event = events.find((item) => item.id === eventId);

  if (!event) {
    showToast("Event not found.", true);
    return;
  }

  selectedSeats = [];

  const showDates = getShowDates(event);

  if (!showDates.length) {
    showToast("No show date is available for this event.", true);
    return;
  }

  const dateOptions = showDates
    .map(
      (dateTime) =>
        `<option value="${dateTime}">
          ${formatDateTime(dateTime)}
        </option>`
    )
    .join("");

  const selectionLabel =
    event.category === "Movies"
      ? "Choose Movie Show Date & Time"
      : "Event Date & Time";

  $("modalContent").innerHTML = `
    <img
      class="modal-image"
      src="${event.image}"
      alt="${event.name} event image"
    >

    <span class="tag">${event.category}</span>

    <h2>${event.name}</h2>

    <p class="description">${event.description}</p>

    <div class="event-info">
      <div>
        ${event.venueType}
        <b>${event.venue}</b>
      </div>

      <div>
        Ticket Price
        <b>${formatMoney(event.price)}</b>
      </div>

      <div>
        Total Seats
        <b>${event.totalSeats}</b>
      </div>

      <div>
        Seat Status
        <b id="seatStatusText">Select a show</b>
      </div>
    </div>

    <form id="bookingForm" class="booking-form">

      <label for="selectedDateTime">
        ${selectionLabel}
      </label>

      <select id="selectedDateTime" required>
        ${dateOptions}
      </select>

      <div class="seat-section">

        <div class="seat-screen">
          SCREEN
        </div>

        <div class="seat-legend">
          <span>
            <i class="legend-seat available"></i>
            Available
          </span>

          <span>
            <i class="legend-seat selected"></i>
            Selected
          </span>

          <span>
            <i class="legend-seat booked"></i>
            Booked
          </span>
        </div>

        <div id="seatContainer" class="seat-grid"></div>

        <div class="seat-summary">
          <div>
            Available
            <strong id="availableSeatCount">0</strong>
          </div>

          <div>
            Booked
            <strong id="bookedSeatCount">0</strong>
          </div>

          <div>
            Selected
            <strong id="selectedSeatCount">0</strong>
          </div>
        </div>

        <p class="selected-seat-text">
          Selected Seats:
          <strong id="selectedSeatDisplay">None</strong>
        </p>

      </div>

      <div class="total-box">
        <span>Total Amount</span>
        <strong id="totalAmount">
          ${formatMoney(0)}
        </strong>
      </div>

      <button
        class="primary-btn"
        type="submit"
      >
        Confirm Booking
      </button>

    </form>
  `;

  $("bookingModal").classList.remove("hidden");

  $("selectedDateTime").addEventListener(
    "change",
    () => renderSeatMap(event)
  );

  $("bookingForm").addEventListener(
    "submit",
    (formEvent) => createBooking(formEvent, eventId)
  );

  renderSeatMap(event);
};

function renderSeatMap(event) {
  selectedSeats = [];

  const showDateTime = $("selectedDateTime").value;
  const bookedSeats = getBookedSeats(event, showDateTime);

  const seatContainer = $("seatContainer");

  seatContainer.innerHTML = "";

  for (let seatNumber = 1; seatNumber <= event.totalSeats; seatNumber++) {
    const seat = document.createElement("button");

    const isBooked = bookedSeats.includes(seatNumber);

    seat.type = "button";
    seat.className = "seat";
    seat.textContent = seatNumber;

    if (isBooked) {
      seat.classList.add("booked");
      seat.disabled = true;
      seat.title = "This seat is already booked";
    } else {
      seat.classList.add("available");

      seat.addEventListener("click", () => {
        toggleSeat(seatNumber, seat);
      });
    }

    seatContainer.appendChild(seat);
  }

  updateSeatSummary(event, showDateTime);
}

function toggleSeat(seatNumber, seatElement) {
  if (selectedSeats.includes(seatNumber)) {
    selectedSeats = selectedSeats.filter(
      (seat) => seat !== seatNumber
    );

    seatElement.classList.remove("selected");
    seatElement.classList.add("available");
  } else {
    if (selectedSeats.length >= MAX_TICKETS_PER_BOOKING) {
      showToast(
        `You can select a maximum of ${MAX_TICKETS_PER_BOOKING} seats.`,
        true
      );
      return;
    }

    selectedSeats.push(seatNumber);

    seatElement.classList.remove("available");
    seatElement.classList.add("selected");
  }

  updateSeatSummary(
    events.find(
      (event) =>
        event.id === $("bookingForm")?.dataset?.eventId
    ) || currentModalEvent
  );
}

let currentModalEvent = null;

function updateSeatSummary(event, showDateTime) {
  if (!event) return;

  currentModalEvent = event;

  const bookedSeats = getBookedSeats(event, showDateTime);
  const availableCount =
    event.totalSeats - bookedSeats.length;

  $("availableSeatCount").textContent = availableCount;
  $("bookedSeatCount").textContent = bookedSeats.length;
  $("selectedSeatCount").textContent = selectedSeats.length;

  $("selectedSeatDisplay").textContent =
    selectedSeats.length
      ? selectedSeats.join(", ")
      : "None";

  $("seatStatusText").textContent =
    `${availableCount} available / ${bookedSeats.length} booked`;

  $("totalAmount").textContent = formatMoney(
    selectedSeats.length * event.price
  );
}

function validateBooking(event, showDateTime) {
  if (!currentUser) {
    return "Please log in before booking.";
  }

  if (!event) {
    return "Event not found.";
  }

  if (!showDateTime) {
    return "Please select a show date and time.";
  }

  if (!selectedSeats.length) {
    return "Please select at least one seat.";
  }

  if (selectedSeats.length > MAX_TICKETS_PER_BOOKING) {
    return `You can book a maximum of ${MAX_TICKETS_PER_BOOKING} seats.`;
  }

  const bookedSeats = getBookedSeats(event, showDateTime);

  const duplicateSeats = selectedSeats.filter(
    (seat) => bookedSeats.includes(seat)
  );

  if (duplicateSeats.length) {
    return "One or more selected seats are already booked.";
  }

  if (
    selectedSeats.some(
      (seat) =>
        !Number.isInteger(seat) ||
        seat < 1 ||
        seat > event.totalSeats
    )
  ) {
    return "Invalid seat selection.";
  }

  const eventTime = new Date(showDateTime).getTime();

  if (Number.isNaN(eventTime)) {
    return "Selected date and time is invalid.";
  }

  const now = Date.now();
  const bookingCutoff =
    BOOKING_CUTOFF_MINUTES * 60 * 1000;

  if (eventTime <= now) {
    return "Booking is closed because this show has already started.";
  }

  if (eventTime - now < bookingCutoff) {
    return `Bookings close ${BOOKING_CUTOFF_MINUTES} minutes before the show.`;
  }

  return "";
}

function createBooking(formEvent, eventId) {
  formEvent.preventDefault();

  const event = events.find(
    (item) => item.id === eventId
  );

  const showDateTime = $("selectedDateTime").value;

  const error = validateBooking(
    event,
    showDateTime
  );

  if (error) {
    showToast(error, true);
    return;
  }

  const bookedSeats =
    getBookedSeats(event, showDateTime);

  const duplicateSeats = selectedSeats.filter(
    (seat) => bookedSeats.includes(seat)
  );

  if (duplicateSeats.length) {
    showToast(
      "Some seats were just booked. Please choose again.",
      true
    );
    renderSeatMap(event);
    return;
  }

  event.seatMap[showDateTime] = [
    ...bookedSeats,
    ...selectedSeats
  ].sort((a, b) => a - b);

  event.availableSeats = getAvailableSeats(
    event,
    showDateTime
  );

  const booking = {
    id: createId("B"),
    userId: currentUser.id,
    userName: currentUser.name,
    eventId: event.id,
    eventName: event.name,
    category: event.category,
    venueType: event.venueType,
    venue: event.venue,
    selectedDateTime: showDateTime,
    seats: [...selectedSeats],
    numberOfTickets: selectedSeats.length,
    totalAmount:
      selectedSeats.length * event.price,
    bookingDate: new Date().toISOString(),
    status: "Confirmed"
  };

  bookings.unshift(booking);

  writeStorage(
    STORAGE_KEYS.events,
    events
  );

  writeStorage(
    STORAGE_KEYS.bookings,
    bookings
  );

  $("bookingModal").classList.add("hidden");

  updateBadge();
  renderEvents();

  showToast(
    "Booking confirmed successfully."
  );

  showTicket(booking.id);

  selectedSeats = [];
}

function renderBookings() {
  const userBookings = bookings.filter(
    (booking) =>
      booking.userId === currentUser.id
  );

  if (!userBookings.length) {
    $("bookingList").innerHTML = `
      <div class="empty">
        <h3>No bookings yet</h3>
        <p>Your booked tickets will appear here.</p>
      </div>
    `;
    return;
  }

  $("bookingList").innerHTML = userBookings
    .map((booking) => {
      const cancelButton =
        booking.status === "Confirmed"
          ? `
            <br>
            <button
              class="cancel-btn"
              onclick="cancelBooking('${booking.id}')"
            >
              Cancel Booking
            </button>
          `
          : "";

      const seats =
        booking.seats?.join(", ") || "Not recorded";

      return `
        <article class="booking-card">

          <div>
            <h3>${booking.eventName}</h3>

            <p>
              Booking ID: ${booking.id}
              • User ID: ${booking.userId}
            </p>

            <p>
              📍 ${booking.venueType}: ${booking.venue}
            </p>

            <p>
              💺 Seat(s): ${seats}
            </p>

            <p>
              ${booking.numberOfTickets} ticket(s)
              • Show: ${formatDateTime(booking.selectedDateTime)}
            </p>
          </div>

          <div class="booking-side">

            <p class="price">
              ${formatMoney(booking.totalAmount)}
            </p>

            <span
              class="status ${booking.status.toLowerCase()}"
            >
              ${booking.status}
            </span>

            ${cancelButton}

            <br>

            <button
              class="outline-btn"
              style="margin-top:10px"
              onclick="showTicket('${booking.id}')"
            >
              View Ticket
            </button>

          </div>

        </article>
      `;
    })
    .join("");
}

window.cancelBooking = function cancelBooking(bookingId) {
  const booking = bookings.find(
    (item) =>
      item.id === bookingId &&
      item.userId === currentUser.id
  );

  if (!booking || booking.status === "Cancelled") {
    return;
  }

  const event = events.find(
    (item) => item.id === booking.eventId
  );

  if (!event) {
    showToast("Event data could not be found.", true);
    return;
  }

  const eventTime =
    new Date(booking.selectedDateTime).getTime();

  if (Number.isNaN(eventTime)) {
    showToast(
      "Cancellation is unavailable because the show date/time is invalid.",
      true
    );
    return;
  }

  const now = Date.now();
  const cancellationCutoff =
    CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000;

  if (eventTime <= now) {
    showToast(
      "Cancellation is not allowed after the show starts.",
      true
    );
    return;
  }

  if (eventTime - now < cancellationCutoff) {
    showToast(
      `Cancellation closes ${CANCELLATION_CUTOFF_HOURS} hours before the show.`,
      true
    );
    return;
  }

  if (!confirm(`Cancel booking for ${booking.eventName}?`)) {
    return;
  }

  const bookedSeats =
    getBookedSeats(
      event,
      booking.selectedDateTime
    );

  event.seatMap[booking.selectedDateTime] =
    bookedSeats.filter(
      (seat) => !booking.seats.includes(seat)
    );

  event.availableSeats =
    getAvailableSeats(
      event,
      booking.selectedDateTime
    );

  booking.status = "Cancelled";
  booking.cancelledDate =
    new Date().toISOString();

  writeStorage(
    STORAGE_KEYS.events,
    events
  );

  writeStorage(
    STORAGE_KEYS.bookings,
    bookings
  );

  updateBadge();
  renderEvents();
  renderBookings();

  showToast(
    "Booking cancelled and seats are available again."
  );
};

window.showTicket = function showTicket(bookingId) {
  const booking = bookings.find(
    (item) =>
      item.id === bookingId &&
      item.userId === currentUser.id
  );

  if (!booking) return;

  const seats =
    booking.seats?.join(", ") || "Not recorded";

  $("ticketContent").innerHTML = `
    <div class="ticket">

      <p class="eyebrow blue">
        E-TICKET
      </p>

      <h2>${booking.eventName}</h2>

      <span
        class="status ${booking.status.toLowerCase()}"
      >
        ${booking.status}
      </span>

      <div class="ticket-grid">

        <div>
          Booking ID
          <b>${booking.id}</b>
        </div>

        <div>
          User ID
          <b>${booking.userId}</b>
        </div>

        <div>
          Category
          <b>${booking.category}</b>
        </div>

        <div>
          ${booking.venueType}
          <b>${booking.venue}</b>
        </div>

        <div>
          Show Date & Time
          <b>${formatDateTime(booking.selectedDateTime)}</b>
        </div>

        <div>
          Seat(s)
          <b>${seats}</b>
        </div>

        <div>
          Tickets
          <b>${booking.numberOfTickets}</b>
        </div>

        <div>
          Amount
          <b>${formatMoney(booking.totalAmount)}</b>
        </div>

      </div>

    </div>
  `;

  $("ticketModal").classList.remove("hidden");
};

function showPage(page) {
  $("eventsPage").classList.toggle(
    "hidden",
    page !== "events"
  );

  $("bookingsPage").classList.toggle(
    "hidden",
    page !== "bookings"
  );

  document.querySelectorAll(".nav-btn").forEach(
    (button) => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    }
  );

  if (page === "bookings") {
    renderBookings();
  }
}

function addEventListeners() {
  document.querySelectorAll(".auth-tab").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => switchAuthView(
          button.dataset.authView
        )
      );
    }
  );

  $("loginForm").addEventListener(
    "submit",
    login
  );

  $("registerForm").addEventListener(
    "submit",
    register
  );

  $("logoutBtn").addEventListener(
    "click",
    logout
  );

  $("searchInput").addEventListener(
    "input",
    renderEvents
  );

  $("browseBtn").addEventListener(
    "click",
    () => showPage("events")
  );

  document.querySelectorAll(".nav-btn").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => showPage(button.dataset.page)
      );
    }
  );

  document.querySelectorAll("[data-close]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          $(button.dataset.close)
            .classList.add("hidden");

          selectedSeats = [];
        }
      );
    }
  );

  document.querySelectorAll(".overlay").forEach(
    (overlay) => {
      overlay.addEventListener(
        "click",
        (event) => {
          if (event.target === overlay) {
            overlay.classList.add("hidden");
            selectedSeats = [];
          }
        }
      );
    }
  );
}

addEventListeners();

initialize().catch((error) => {
  console.error(error);
  showToast(
    "Could not load JSON files. Run the project with Live Server.",
    true
  );
});
