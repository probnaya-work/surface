// The EX– page behaviour: the card figure, its configuration, the phone
// wallpaper slider and the interest form. The public site owns the markup;
// this module owns what it does. It finds its elements by the ids below and
// does nothing where they are absent.

import { OBJECT, CONFIG, normalizeConfig, configName, interestPayload, INTEREST_LIMITS } from './object.js';
import {
  lensAt, fromPointer, fromTilt, formatAngle, backDot, formatIssue, REST, FIRST, SECOND,
} from './card.js';

export const INTAKE_ENDPOINT = '/api/intake';
// The chosen ground and finish are kept on this device only.
export const CONFIG_KEY = 'probnaya:ex-config';

export function mountEx(doc = document) {
  mountCard(doc);
  const config = mountConfig(doc);
  mountSlides(doc);
  mountInterest(doc, undefined, config ? config.get : undefined);
}

// Event-driven: nothing here runs a frame loop. The card is turned by the
// pointer on a desktop, by the phone itself on a touch screen, and by the two
// state buttons anywhere. FRONT and BACK show a face; the state buttons always
// return to the front.
export function mountCard(doc = document, random = Math.random) {
  const plate = doc.getElementById('ex-plate');
  const card = doc.getElementById('ex-card');
  if (!plate || !card) return null;
  const readout = doc.getElementById('ex-readout');
  const labels = card.querySelectorAll('[data-ex-state]');
  const buttons = [doc.getElementById('ex-left'), doc.getElementById('ex-right')];
  const faces = [doc.getElementById('ex-front'), doc.getElementById('ex-back')];
  const dot = doc.getElementById('ex-dot');
  const issueEl = doc.getElementById('ex-no');
  const tiltButton = doc.getElementById('ex-tilt');
  const view = doc.defaultView;

  function set(t) {
    const lens = lensAt(t);
    card.style.setProperty('--b', lens.blend.toFixed(3));
    card.style.setProperty('--deg', lens.deg.toFixed(1) + 'deg');
    card.style.setProperty('--p', lens.highlight.toFixed(1) + '%');
    const word = OBJECT.states[lens.state].word;
    labels.forEach((el) => { el.textContent = word; });
    if (readout) readout.textContent = formatAngle(lens.deg);
    buttons.forEach((button, i) => {
      if (!button) return;
      const on = i === lens.state;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
      const mark = button.querySelector('.dot');
      if (mark) mark.textContent = on ? '●' : '○';
    });
  }

  // Each time the back is shown it stands for another card of the issue.
  function showIssue(issue) {
    const at = backDot(issue);
    if (dot) {
      dot.style.left = at.x.toFixed(2) + '%';
      dot.style.top = at.y.toFixed(2) + '%';
    }
    if (issueEl) issueEl.textContent = formatIssue(issue, OBJECT.issues);
  }

  function face(back) {
    if (back) showIssue(1 + Math.floor(random() * OBJECT.issues));
    card.classList.toggle('is-back', back);
    faces.forEach((button, i) => {
      if (!button) return;
      const on = (i === 1) === back;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }

  plate.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = plate.getBoundingClientRect();
    set(fromPointer(e.clientX, r.left, r.width));
  });
  plate.addEventListener('pointerleave', () => set(REST));
  if (buttons[0]) buttons[0].addEventListener('click', () => { face(false); set(FIRST); });
  if (buttons[1]) buttons[1].addEventListener('click', () => { face(false); set(SECOND); });
  if (faces[0]) faces[0].addEventListener('click', () => face(false));
  if (faces[1]) faces[1].addEventListener('click', () => face(true));

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
  return { set, face };
}

// Ground and finish. The buttons carry data-set (a CONFIG key) and data-v (one
// of its values); the card shows the choice as data-ground and data-finish,
// and every [data-ex-config] element reads it back by name.
export function mountConfig(doc = document, storage) {
  const buttons = [...doc.querySelectorAll('.ex-config [data-set]')]
    .filter((button) => Object.hasOwn(CONFIG, button.dataset.set));
  if (!buttons.length) return null;
  const card = doc.getElementById('ex-card');
  const echoes = doc.querySelectorAll('[data-ex-config]');
  const store = storage === undefined ? localStore(doc) : storage;

  let config = normalizeConfig(read(store));

  function apply() {
    if (card) {
      card.dataset.ground = config.ground;
      card.dataset.finish = config.finish;
    }
    buttons.forEach((button) => {
      const on = config[button.dataset.set] === button.dataset.v;
      button.classList.toggle('active', on);
      button.setAttribute('aria-checked', String(on));
    });
    const name = configName(config);
    echoes.forEach((el) => { el.textContent = name; });
  }

  buttons.forEach((button) => button.addEventListener('click', () => {
    config = normalizeConfig({ ...config, [button.dataset.set]: button.dataset.v });
    try { if (store) store.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (err) { /* not kept */ }
    apply();
  }));

  apply();
  return { get: () => ({ ...config }) };
}

function localStore(doc) {
  try { return doc.defaultView.localStorage; } catch (err) { return null; }
}

function read(store) {
  try { return JSON.parse((store && store.getItem(CONFIG_KEY)) || '{}'); } catch (err) { return {}; }
}

// Phone wallpapers, one at a time (the stylesheet shows the slider below
// 760 px only). The counter follows the snapped slide.
export function mountSlides(doc = document) {
  const slides = doc.getElementById('ex-slides');
  const counter = doc.getElementById('ex-slide-n');
  if (!slides || !counter || !slides.firstElementChild) return null;
  const last = slides.children.length - 1;
  const gap = () => parseFloat(doc.defaultView.getComputedStyle(slides).columnGap) || 0;
  slides.addEventListener('scroll', () => {
    const step = slides.firstElementChild.getBoundingClientRect().width + gap();
    const i = step > 0 ? Math.max(0, Math.min(last, Math.round(slides.scrollLeft / step))) : 0;
    counter.textContent = String(i + 1).padStart(2, '0');
  }, { passive: true });
  return { slides };
}

export function mountInterest(doc = document, fetchImpl, getConfig) {
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
      config: getConfig ? getConfig() : undefined,
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
