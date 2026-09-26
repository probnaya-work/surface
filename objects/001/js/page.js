// The EX– page behaviour: the card figure and the interest form. The public
// site owns the markup; this module owns what it does. It finds its elements
// by the ids below and does nothing where they are absent.

import { OBJECT, interestPayload, INTEREST_LIMITS } from './object.js';
import { lensAt, fromPointer, fromTilt, formatAngle, REST, FIRST, SECOND } from './card.js';

export const INTAKE_ENDPOINT = '/api/intake';

export function mountEx(doc = document) {
  mountCard(doc);
  mountInterest(doc);
}

// Event-driven: nothing here runs a frame loop. The card is turned by the
// pointer on a desktop, by the phone itself on a touch screen, and by the two
// state buttons anywhere.
export function mountCard(doc = document) {
  const plate = doc.getElementById('ex-plate');
  const card = doc.getElementById('ex-card');
  if (!plate || !card) return null;
  const readout = doc.getElementById('ex-readout');
  const labels = card.querySelectorAll('[data-ex-state]');
  const buttons = [doc.getElementById('ex-left'), doc.getElementById('ex-right')];
  const tiltButton = doc.getElementById('ex-tilt');
  const view = doc.defaultView;

  function set(t) {
    const lens = lensAt(t);
    card.style.setProperty('--b', lens.blend.toFixed(3));
    card.style.setProperty('--deg', lens.deg.toFixed(1) + 'deg');
    const word = OBJECT.states[lens.state].word;
    labels.forEach((el) => { el.textContent = word; });
    if (readout) readout.textContent = formatAngle(lens.deg);
    buttons.forEach((button, i) => {
      if (!button) return;
      const on = i === lens.state;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
      const dot = button.querySelector('.dot');
      if (dot) dot.textContent = on ? '●' : '○';
    });
  }

  plate.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = plate.getBoundingClientRect();
    set(fromPointer(e.clientX, r.left, r.width));
  });
  plate.addEventListener('pointerleave', () => set(REST));
  if (buttons[0]) buttons[0].addEventListener('click', () => set(FIRST));
  if (buttons[1]) buttons[1].addEventListener('click', () => set(SECOND));

  // Desktop browsers define the orientation API too, so a coarse pointer is
  // required before the card follows the device. iOS asks for permission, and
  // only from a tap, so its button appears only where that is needed.
  const onOrient = (e) => { if (e.gamma != null) set(fromTilt(e.gamma)); };
  const DOE = view && view.DeviceOrientationEvent;
  const touch = view && view.matchMedia && view.matchMedia('(pointer: coarse)').matches;
  if (touch && DOE && typeof DOE.requestPermission === 'function') {
    if (tiltButton) {
      tiltButton.hidden = false;
      tiltButton.addEventListener('click', async () => {
        try {
          if (await DOE.requestPermission() === 'granted') {
            view.addEventListener('deviceorientation', onOrient);
            tiltButton.hidden = true;
          }
        } catch (err) { /* permission refused: the buttons still work */ }
      });
    }
  } else if (touch && DOE) {
    view.addEventListener('deviceorientation', onOrient);
  }

  set(REST);
  return { set };
}

export function mountInterest(doc = document, fetchImpl) {
  const form = doc.getElementById('ex-form');
  if (!form) return null;
  const field = (id) => doc.getElementById(id);
  const receipt = field('ex-receipt');
  const receiptId = field('ex-receipt-id');
  const errorEl = field('ex-error');
  const submit = form.querySelector('button[type="submit"]');
  const send = fetchImpl || ((...args) => doc.defaultView.fetch(...args));

  const email = field('ex-email');
  if (email && !email.hasAttribute('maxlength')) email.setAttribute('maxlength', String(INTEREST_LIMITS.email));

  let pending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pending) return;
    pending = true;
    if (submit) submit.disabled = true;
    if (errorEl) errorEl.hidden = true;
    const payload = interestPayload({
      email: email.value,
      website: field('ex-hp') ? field('ex-hp').value : '',
    });
    try {
      const r = await send(INTAKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error('intake refused');
      if (receiptId) receiptId.textContent = data.id;
      form.hidden = true;
      if (receipt) receipt.hidden = false;
    } catch (err) {
      if (errorEl) errorEl.hidden = false;
      if (submit) submit.disabled = false;
    }
    pending = false;
  });
  return { form };
}
