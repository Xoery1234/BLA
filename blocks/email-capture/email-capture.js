/**
 * Email Capture block — R1.B §4 item 3, TD-4, TD-5
 * Single-field email input + consent checkbox + inline success/error.
 * Anti-spam: honeypot field + timing check.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Email Capture")
 *   Row 2: CTA label (e.g., "Notify me")
 *   Row 3: Consent text (e.g., "I agree to receive marketing communications...")
 *   Row 4: Success message (e.g., "Thanks! We'll be in touch.")
 *   Row 5: Form action URL (link to webhook endpoint)
 */

const SUBMIT_COOLDOWN_MS = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function decorate(block) {
  const rows = [...block.children];
  const getText = (i) => (rows[i] ? rows[i].textContent.trim() : '');
  const getLink = () => {
    const link = block.querySelector('a[href]');
    return link ? link.href : '';
  };

  const ctaLabel = getText(0) || 'Notify me';
  const consentText = getText(1) || 'I agree to receive marketing communications.';
  const successMessage = getText(2) || 'Thanks for signing up!';
  const actionUrl = getLink();

  block.textContent = '';

  // Form
  const form = document.createElement('form');
  form.className = 'email-capture-form';
  form.setAttribute('novalidate', '');
  form.dataset.loadTime = Date.now().toString();

  // Honeypot (hidden from real users, bots fill it)
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'website';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.className = 'email-capture-hp';
  honeypot.setAttribute('aria-hidden', 'true');
  form.append(honeypot);

  // Email field group
  const fieldGroup = document.createElement('div');
  fieldGroup.className = 'email-capture-field-group';

  const emailLabel = document.createElement('label');
  emailLabel.setAttribute('for', 'email-capture-input');
  emailLabel.className = 'sr-only';
  emailLabel.textContent = 'Email address';

  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.id = 'email-capture-input';
  emailInput.name = 'email';
  emailInput.required = true;
  emailInput.placeholder = 'Enter your email';
  emailInput.autocomplete = 'email';
  emailInput.setAttribute('aria-describedby', 'email-capture-error');

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'button primary';
  submitBtn.textContent = ctaLabel;

  fieldGroup.append(emailLabel, emailInput, submitBtn);

  // Consent checkbox
  const consentGroup = document.createElement('div');
  consentGroup.className = 'email-capture-consent';

  const consentInput = document.createElement('input');
  consentInput.type = 'checkbox';
  consentInput.id = 'email-capture-consent';
  consentInput.name = 'consent';
  consentInput.required = true;

  const consentLabel = document.createElement('label');
  consentLabel.setAttribute('for', 'email-capture-consent');
  consentLabel.textContent = consentText;

  consentGroup.append(consentInput, consentLabel);

  // Error message (aria-live for screen readers)
  const errorMsg = document.createElement('p');
  errorMsg.id = 'email-capture-error';
  errorMsg.className = 'email-capture-error';
  errorMsg.setAttribute('role', 'alert');
  errorMsg.setAttribute('aria-live', 'polite');

  // Success state
  const successEl = document.createElement('div');
  successEl.className = 'email-capture-success';
  successEl.setAttribute('aria-live', 'polite');
  successEl.textContent = successMessage;

  // Assemble
  form.append(fieldGroup, consentGroup, errorMsg);
  block.append(form, successEl);

  // Validation on blur
  emailInput.addEventListener('blur', () => {
    if (emailInput.value && !EMAIL_RE.test(emailInput.value)) {
      emailInput.setAttribute('aria-invalid', 'true');
      errorMsg.textContent = 'Please enter a valid email address.';
    } else {
      emailInput.removeAttribute('aria-invalid');
      errorMsg.textContent = '';
    }
  });

  // Clear error on input
  emailInput.addEventListener('input', () => {
    if (emailInput.hasAttribute('aria-invalid') && EMAIL_RE.test(emailInput.value)) {
      emailInput.removeAttribute('aria-invalid');
      errorMsg.textContent = '';
    }
  });

  // Submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.textContent = '';

    // Honeypot check
    if (honeypot.value) return;

    // Timing check (bot fills instantly)
    const elapsed = Date.now() - parseInt(form.dataset.loadTime, 10);
    if (elapsed < SUBMIT_COOLDOWN_MS) return;

    // Client validation
    if (!EMAIL_RE.test(emailInput.value)) {
      emailInput.setAttribute('aria-invalid', 'true');
      errorMsg.textContent = 'Please enter a valid email address.';
      emailInput.focus();
      return;
    }

    if (!consentInput.checked) {
      errorMsg.textContent = 'Please agree to the terms to continue.';
      consentInput.focus();
      return;
    }

    // Disable form during submission
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      if (!actionUrl) {
        throw new Error('No form endpoint configured');
      }

      const payload = {
        email: emailInput.value,
        consent: consentInput.checked,
        timestamp: new Date().toISOString(),
        utm: Object.fromEntries(
          new URLSearchParams(window.location.search),
        ),
      };

      const response = await fetch(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });

      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }

      // Success: hide form, show success message
      form.setAttribute('aria-hidden', 'true');
      successEl.classList.add('visible');
    } catch (error) {
      errorMsg.textContent = 'Something went wrong. Please try again.';
      // eslint-disable-next-line no-console
      console.error('[email-capture]', error);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = ctaLabel;
    }
  });
}
