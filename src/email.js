import emailjs from '@emailjs/browser';

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

export const hasEmailConfig = Boolean(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY);

// Sends through a single generic EmailJS template that uses {{to_email}}, {{subject}}, {{message}} and {{reply_to}}.
// Never throws: a failed email must not undo a booking that was already saved. Returns true when sent.
export const sendEmail = async ({ toEmail, subject, message, replyTo = '' }) => {
  if (!hasEmailConfig) {
    console.warn('EmailJS is not configured; skipping email:', subject);
    return false;
  }

  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      { to_email: toEmail, subject, message, reply_to: replyTo },
      { publicKey: PUBLIC_KEY }
    );
    return true;
  } catch (error) {
    console.error('Unable to send email:', error);
    return false;
  }
};
