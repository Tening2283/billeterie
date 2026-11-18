/* global io */
// Page de test minimale (étape 3) : pas de framework, juste l'API REST + Socket.io.
const API = '/api/v1';
const $ = (id) => document.getElementById(id);
const seats = new Map(); // seatNumber -> { state, heldByMe, expiresAt }
let token = sessionStorage.getItem('devToken');
let trip;

function log(message) {
  const line = `${new Date().toLocaleTimeString()}  ${message}\n`;
  $('log').textContent = (line + $('log').textContent).slice(0, 3000);
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? res.statusText), body.error);
  return body;
}

async function ensureTraveler() {
  if (token) {
    try {
      const me = await api('/auth/me');
      $('who').textContent = me.name;
      return;
    } catch {
      token = null;
    }
  }
  // Un voyageur par onglet (sessionStorage), pour voir « bloquée par un autre ».
  const suffix = Math.random().toString(36).slice(2, 8);
  const auth = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `onglet-${suffix}@dev.test`,
      password: `motdepasse-${suffix}`,
      name: `Onglet ${suffix}`,
    }),
  });
  token = auth.token;
  sessionStorage.setItem('devToken', token);
  $('who').textContent = auth.user.name;
}

async function pickTrip() {
  const fromUrl = new URLSearchParams(location.search).get('trip');
  if (fromUrl) return api(`/trips/${fromUrl}`);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const { trips } = await api(
    `/trips?from=Dakar&to=${encodeURIComponent('Thiès')}&date=${tomorrow}`,
  );
  if (!trips.length) throw new Error('Aucun départ demain : lance le seed.');
  history.replaceState(null, '', `?trip=${trips[0].id}`);
  return api(`/trips/${trips[0].id}`);
}

async function reloadSeats() {
  const body = await api(`/trips/${trip.id}/seats`);
  seats.clear();
  for (const s of body.seats) seats.set(s.seatNumber, s);
  render();
}

function render() {
  const { columns, aisleAfter } = trip.layout;
  const grid = $('grid');
  grid.style.gridTemplateColumns = `repeat(${columns + (aisleAfter ? 1 : 0)}, 1fr)`;
  grid.replaceChildren();
  for (const [number, s] of seats) {
    const button = document.createElement('button');
    const kind = s.state === 'held' ? (s.heldByMe ? 'mine' : 'other') : s.state;
    const left = s.expiresAt
      ? Math.max(0, Math.round((Date.parse(s.expiresAt) - Date.now()) / 1000))
      : 0;
    const label = {
      free: 'libre',
      mine: 'bloquée par moi',
      other: 'bloquée par un autre',
      sold: 'vendue',
    }[kind];
    button.className = `seat ${kind}`;
    button.textContent =
      kind === 'mine'
        ? `${number} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
        : String(number);
    button.setAttribute('aria-label', `Place ${number}, ${label}`);
    button.onclick = () => onSeatClick(number, kind);
    grid.append(button);
    const column = (number - 1) % columns;
    if (aisleAfter && column === aisleAfter - 1) {
      const gap = document.createElement('span');
      gap.className = 'aisle';
      grid.append(gap);
    }
  }
}

async function onSeatClick(number, kind) {
  try {
    if (kind === 'free') {
      const hold = await api(`/trips/${trip.id}/holds`, {
        method: 'POST',
        body: JSON.stringify({ seatNumber: number }),
      });
      seats.set(number, {
        seatNumber: number,
        state: 'held',
        heldByMe: true,
        expiresAt: hold.expiresAt,
      });
      log(`J'ai bloqué la place ${number}`);
    } else if (kind === 'mine') {
      await api(`/trips/${trip.id}/holds/${number}`, { method: 'DELETE' });
      seats.set(number, { seatNumber: number, state: 'free', heldByMe: false, expiresAt: null });
      log(`J'ai libéré la place ${number}`);
    }
    render();
  } catch (error) {
    log(`Erreur ${error.code ?? ''} : ${error.message}`);
    await reloadSeats();
  }
}

function connectSocket() {
  const socket = io();
  socket.on('connect', () => {
    $('status').textContent = 'en ligne';
    $('status').className = 'on';
    socket.emit('trip:join', trip.id);
    void reloadSeats(); // on a pu manquer des événements pendant une coupure
  });
  socket.on('disconnect', () => {
    $('status').textContent = 'hors ligne, mises à jour en pause';
    $('status').className = '';
  });
  socket.on('seat:held', (e) => {
    const current = seats.get(e.seatNumber);
    if (current?.heldByMe) return; // c'est mon propre blocage, déjà affiché
    seats.set(e.seatNumber, {
      seatNumber: e.seatNumber,
      state: 'held',
      heldByMe: false,
      expiresAt: e.expiresAt,
    });
    log(`Événement seat:held, place ${e.seatNumber}`);
    render();
  });
  socket.on('seat:released', (e) => {
    seats.set(e.seatNumber, {
      seatNumber: e.seatNumber,
      state: 'free',
      heldByMe: false,
      expiresAt: null,
    });
    log(`Événement seat:released, place ${e.seatNumber}`);
    render();
  });
  socket.on('seat:sold', (e) => {
    for (const n of e.seatNumbers)
      seats.set(n, { seatNumber: n, state: 'sold', heldByMe: false, expiresAt: null });
    log(`Événement seat:sold, places ${e.seatNumbers.join(', ')}`);
    render();
  });
}

(async () => {
  try {
    await ensureTraveler();
    trip = await pickTrip();
    const time = new Date(trip.departureAt).toLocaleString('fr-FR', { timeZone: 'UTC' });
    $('trip').textContent =
      `${trip.origin} → ${trip.destination}, ${time} (heure de Dakar), ${trip.priceFcfa} FCFA`;
    await reloadSeats();
    connectSocket();
    setInterval(render, 1000); // compte à rebours (affichage seulement : l'API reste la référence)
  } catch (error) {
    $('trip').textContent = `Erreur : ${error.message}`;
  }
})();
