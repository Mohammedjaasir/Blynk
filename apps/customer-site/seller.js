// "Sell with Blynk" application form on blynk.lk/seller (owner's brother, 2026-10-27: "one form inside
// blynk.lk saying apply for seller registration; once they submit we receive the application, then we
// contact them directly by phone").
//
// Posts the form as JSON to POST <API>/seller-applications (public, no account). The API answers
// { success: true, data: { received: true } } and refuses with a message per field (400), a rate limit
// (429, 5 an hour per address) or "not ready" (503, until its database update has run). Whatever goes
// wrong, the page offers the phone and WhatsApp links already on it (data-seller-fallback).
//
// The API address below is filled in by the Dockerfile from the API_BASE_URL build argument.
(function () {
  const API = '__BLYNK_API__';
  const form = document.querySelector('[data-seller-form]');
  if (!form) return;

  const FIELDS = ['shop_name', 'owner_name', 'phone', 'town', 'what_they_sell', 'email', 'message'];
  const status = document.querySelector('[data-seller-status]');
  const success = document.querySelector('[data-seller-success]');
  const fallback = document.querySelector('[data-seller-fallback]');
  const button = form.querySelector('button[type="submit"]');
  const errorNodes = Array.from(form.querySelectorAll('[data-error-for]'));
  let sending = false;

  const say = (text) => {
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
  };
  const showFallback = (on) => {
    if (fallback) fallback.hidden = !on;
  };
  const clearErrors = () => {
    for (const node of errorNodes) {
      node.textContent = '';
      node.hidden = true;
    }
    for (const name of FIELDS) {
      const el = form.elements[name];
      if (el && el.setAttribute) el.setAttribute('aria-invalid', 'false');
    }
    say('');
    showFallback(false);
  };
  const fieldError = (name, message) => {
    const node = errorNodes.find((n) => n.getAttribute('data-error-for') === name);
    if (!node) return false;
    node.textContent = message;
    node.hidden = false;
    const el = form.elements[name];
    if (el && el.setAttribute) el.setAttribute('aria-invalid', 'true');
    return true;
  };
  const busy = (on) => {
    sending = on;
    if (button) {
      button.disabled = on;
      button.textContent = on ? 'Sending…' : 'Send application';
    }
  };

  const value = (name) => {
    const el = form.elements[name];
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  };

  /** The JSON body: the required fields, the optional ones only when filled, and the honeypot as it stands. */
  const payload = () => {
    const body = {
      shop_name: value('shop_name'),
      owner_name: value('owner_name'),
      phone: value('phone'),
      town: value('town'),
      what_they_sell: value('what_they_sell'),
    };
    if (value('email')) body.email = value('email');
    if (value('message')) body.message = value('message');
    const trap = form.elements.website;
    if (trap && typeof trap.value === 'string' && trap.value !== '') body.website = trap.value;
    return body;
  };

  const issues = (err) => {
    const list = err && Array.isArray(err.details) ? err.details : [];
    return list
      .map((d) => ({ field: Array.isArray(d && d.path) ? String(d.path[0] || '') : String((d && d.field) || ''), message: d && d.message }))
      .filter((d) => typeof d.message === 'string' && d.message);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending) return;
    clearErrors();
    if (!/^https?:\/\//.test(API)) {
      say('We cannot take applications on this page right now.');
      showFallback(true);
      return;
    }
    busy(true);
    let httpStatus = 0;
    fetch(`${API}/seller-applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload()),
    })
      .then((res) => {
        httpStatus = res.status;
        return res.json().catch(() => null);
      })
      .then((json) => {
        if (httpStatus >= 200 && httpStatus < 300 && json && json.success !== false) {
          form.hidden = true;
          if (success) {
            success.hidden = false;
            if (typeof success.focus === 'function') success.focus();
          }
          return;
        }
        const err = json && json.error ? json.error : null;
        busy(false);
        if (httpStatus === 400) {
          const unplaced = [];
          for (const issue of issues(err)) if (!fieldError(issue.field, issue.message)) unplaced.push(issue.message);
          say(unplaced.length ? unplaced.join(' ') : 'Please check the highlighted fields.');
        } else if (httpStatus === 429) {
          say('Too many applications from this device. Please try again later.');
          showFallback(true);
        } else {
          say('We cannot take applications online right now.');
          showFallback(true);
        }
      })
      .catch(() => {
        busy(false);
        say('We could not send your application. Check your connection and try again.');
        showFallback(true);
      });
  });
})();
