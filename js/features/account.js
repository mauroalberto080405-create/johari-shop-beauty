/**
 * Cuenta: registro, inicio y cierre de sesión, recuperación de contraseña.
 */
import { ACTIVE_MODE, CONFIG } from '../config.js';
import { $, h, setKids, Validate } from '../core/utils.js';
import { services, state, emit } from '../state.js';
import { Modal, Toast } from '../ui/feedback.js';
import { friendlyError } from '../services/errors.js';

const demoNote = () => (ACTIVE_MODE === 'demo'
  ? h('div', { class: 'notice' }, 'Modo demostración: las cuentas se guardan solo en este navegador y el acceso es una simulación local, sin verificación de identidad ni seguridad real.')
  : null);

function field(id, label, type, autocomplete, extra = {}) {
  return h('div', { class: 'field' },
    h('label', { for: id, class: 'field__label' }, label),
    h('input', { id, name: id, type, autocomplete, required: true, class: 'input', 'aria-describedby': `${id}-err`, ...extra }),
    h('p', { id: `${id}-err`, class: 'field__error', hidden: true }));
}

function showError(id, message) {
  const error = document.getElementById(`${id}-err`);
  const input = document.getElementById(id);
  error.textContent = message || '';
  error.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function setAlert(message, ok = false) {
  setKids($('#authAlert'), message ? h('p', { class: `notice ${ok ? 'notice--success' : 'notice--error'}` }, message) : null);
}

function busy(button, on, text) {
  button.disabled = on;
  button.textContent = on ? 'Procesando…' : text;
}

function tabs(active) {
  const options = [['login', 'Ingresar'], ['register', 'Crear cuenta']];
  if (services.auth.supportsReset) options.push(['reset', 'Recuperar']);
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Opciones de cuenta' },
    options.map(([key, text]) => h('button', {
      type: 'button',
      'aria-pressed': String(active === key),
      onclick: () => {
        render(key);
        $('#authContent [aria-pressed="true"]')?.focus();
      }
    }, text)));
}

function accountView(user) {
  $('#authTitle').textContent = 'Mi cuenta';
  const verify = ACTIVE_MODE === 'firebase' && !user.emailVerified
    ? h('div', { class: 'notice' },
      h('p', null, 'Tu correo aún no está verificado. Revisa tu bandeja de entrada (y spam).'),
      h('button', {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await services.auth.resendVerification();
            Toast.show('Te enviamos un nuevo correo de verificación.', 'success');
          } catch (error) {
            Toast.show(friendlyError(error), 'error');
          } finally {
            button.disabled = false;
          }
        }
      }, 'Reenviar correo de verificación'))
    : null;

  const logout = h('button', {
    type: 'button',
    class: 'btn btn--primary btn--block',
    onclick: async (event) => {
      const button = event.currentTarget;
      busy(button, true);
      try {
        await services.auth.logout();
        Toast.show('Sesión cerrada.', 'info');
        Modal.close('authDialog');
      } catch (error) {
        Toast.show(friendlyError(error), 'error');
        busy(button, false, 'Cerrar sesión');
      }
    }
  }, 'Cerrar sesión');

  setKids($('#authContent'),
    demoNote(),
    h('dl', { class: 'account-info' },
      h('div', null, h('dt', null, 'Nombre'), h('dd', null, user.name)),
      h('div', null, h('dt', null, 'Correo'), h('dd', null, user.email)),
      h('div', null, h('dt', null, 'Rol'), h('dd', null, user.roleLabel))),
    verify,
    user.isAdmin ? h('button', {
      type: 'button',
      class: 'btn btn--outline btn--block',
      onclick: () => {
        Modal.close('authDialog');
        emit('admin:open', $('#fabAdmin'));
      }
    }, 'Abrir Panel Administrador') : null,
    logout);
}

function loginView() {
  $('#authTitle').textContent = 'Ingresar';
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Ingresar');
  const form = h('form', { class: 'stack', novalidate: true },
    field('loginEmail', 'Correo electrónico', 'email', 'email', { maxlength: '120' }),
    field('loginPassword', 'Contraseña', 'password', 'current-password', { maxlength: '128' }),
    h('div', { id: 'authAlert', role: 'alert' }),
    submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    showError('loginEmail', Validate.email(email) ? '' : 'Ingresa un correo válido.');
    showError('loginPassword', password ? '' : 'Ingresa tu contraseña.');
    if (!Validate.email(email)) return $('#loginEmail').focus();
    if (!password) return $('#loginPassword').focus();
    busy(submit, true);
    setAlert('');
    try {
      await services.auth.login(email, password);
      Toast.show('Sesión iniciada.', 'success');
      Modal.close('authDialog');
    } catch (error) {
      setAlert(friendlyError(error));
      busy(submit, false, 'Ingresar');
      $('#loginPassword').focus();
    }
    return undefined;
  });
  setKids($('#authContent'), demoNote(), tabs('login'), form);
}

function registerView() {
  $('#authTitle').textContent = 'Crear cuenta';
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Crear cuenta');
  const form = h('form', { class: 'stack', novalidate: true },
    field('regName', 'Nombre', 'text', 'name', { maxlength: '80' }),
    field('regEmail', 'Correo electrónico', 'email', 'email', { maxlength: '120' }),
    field('regPassword', 'Contraseña (mínimo 8 caracteres)', 'password', 'new-password', { maxlength: '128', minlength: '8' }),
    h('div', { id: 'authAlert', role: 'alert' }),
    submit,
    h('p', { class: 'muted small' }, 'No necesitas una cuenta para comprar: puedes hacer tu pedido como visitante.'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#regName').value.trim();
    const email = $('#regEmail').value.trim();
    const password = $('#regPassword').value;
    const errors = {
      regName: name.length >= 2 ? '' : 'Ingresa tu nombre.',
      regEmail: Validate.email(email) ? '' : 'Ingresa un correo válido.',
      regPassword: password.length >= 8 ? '' : 'La contraseña debe tener al menos 8 caracteres.'
    };
    Object.entries(errors).forEach(([id, message]) => showError(id, message));
    const first = Object.keys(errors).find((id) => errors[id]);
    if (first) return document.getElementById(first).focus();
    busy(submit, true);
    setAlert('');
    try {
      const result = await services.auth.register(name, email, password);
      Toast.show(result.needsVerification ? 'Cuenta creada. Te enviamos un correo para verificar tu dirección.' : 'Cuenta creada. ¡Bienvenida!', 'success', 6000);
      Modal.close('authDialog');
    } catch (error) {
      setAlert(friendlyError(error));
      busy(submit, false, 'Crear cuenta');
    }
    return undefined;
  });
  setKids($('#authContent'), demoNote(), tabs('register'), form);
}

function resetView() {
  $('#authTitle').textContent = 'Recuperar contraseña';
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Enviar enlace de recuperación');
  const form = h('form', { class: 'stack', novalidate: true },
    field('resetEmail', 'Correo de tu cuenta', 'email', 'email', { maxlength: '120' }),
    h('div', { id: 'authAlert', role: 'alert' }),
    submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#resetEmail').value.trim();
    if (!Validate.email(email)) {
      showError('resetEmail', 'Ingresa un correo válido.');
      return $('#resetEmail').focus();
    }
    showError('resetEmail', '');
    busy(submit, true);
    try {
      await services.auth.resetPassword(email);
      setAlert('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.', true);
    } catch (error) {
      setAlert(friendlyError(error));
    } finally {
      busy(submit, false, 'Enviar enlace de recuperación');
    }
    return undefined;
  });
  setKids($('#authContent'), tabs('reset'), form);
}

function render(view) {
  if (state.user) return accountView(state.user);
  if (view === 'register') return registerView();
  if (view === 'reset') return resetView();
  return loginView();
}

/** Actualiza el encabezado y los permisos visibles cuando cambia la sesión. */
export function onUserChange(user) {
  state.user = user;
  $('#accountLabel').textContent = user ? `Hola, ${user.name.split(' ')[0]}` : 'Ingresar';
  $('#accountBtn').setAttribute('aria-label', user ? `Mi cuenta (${user.name})` : 'Ingresar o crear cuenta');
  $('#fabAdmin').hidden = !user?.isAdmin;
  if (Modal.isOpen('authDialog')) render();
  emit('user', user);
}

export function initAccount() {
  $('#accountBtn').addEventListener('click', (event) => {
    render();
    Modal.open('authDialog', event.currentTarget);
  });
  // Recordatorio para la persona que prueba la demo (no aparece en el modo Firebase).
  if (ACTIVE_MODE === 'demo') console.info(`Demo · cuenta de la dueña: ${CONFIG.OWNER_EMAIL} / ${CONFIG.DEMO_OWNER_PASSWORD}`);
}
