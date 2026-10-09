# Bookly

A small React appointment scheduler with host approval.

## How booking works

1. A visitor picks a time and submits the form. The booking is saved as **pending** and the time disappears for everyone else.
2. The visitor gets a "request received, not confirmed yet" email. The host gets a "new request" email with a link to the admin page.
3. The host opens `/#admin`, signs in with Google, and clicks **Confirm** (optionally adding a meeting link) or **Decline**.
4. The visitor gets a "confirmed" email (with the meeting link and Google / Outlook calendar links) or a "declined" email. Declining, or later cancelling, frees the time again.

Every booking also gets a private page at `/#manage/<code>`, linked from the visitor's emails and the success screen. It shows the live status and offers add-to-calendar buttons (including an `.ics` download for Apple Calendar) once the booking is confirmed. It also lets the visitor **cancel** the booking; the host is emailed and the time is released.

### Availability (admin > Settings)

Set weekly hours (per weekday, in 30-minute steps), days off, a buffer between meetings and a daily meeting limit. The booking page updates instantly. Weekly hours and days off are also enforced by `firestore.rules`. The buffer and the daily limit are only enforced by the booking page. Until you save settings once, the default is Mon–Fri, 9:00–17:00.

### Booking policy

- All times are in IST. Visitors in other time zones also see each time in their own zone.
- Bookings need at least **2 hours' notice** and can be at most **60 days ahead**.
- A pending request holds its time for **48 hours**. After that, anyone can book the time unless the host has confirmed it. The host can still confirm an expired request as long as nobody else has taken the time.

These numbers live in `src/booking.js` and are repeated in `firestore.rules`. Change both together and re-publish the rules.

## Run Locally

```bash
npm install
npm run dev
```

Without a `.env` the app runs in local mode: bookings are kept only in your browser's local storage, no emails are sent and the admin page is unavailable.

## Firebase setup

1. **Create the project.** Go to https://console.firebase.google.com, click *Add project* and follow the wizard (Google Analytics is optional).
2. **Register a web app.** In *Project settings > General > Your apps*, click the `</>` (Web) icon and register an app. Copy the `firebaseConfig` values it shows.
3. **Create Firestore.** Go to *Build > Firestore Database > Create database*, pick a location close to your users (it can't be changed later) and start in **production mode**.
4. **Publish the rules.** The committed `firestore.rules` uses the placeholder `host@example.com`. `npm run deploy:rules` (see [Deploy](#deploy)) fills in `VITE_ADMIN_EMAIL` from `.env`, writes the git-ignored `firestore.local.rules` and publishes it. To use the Firebase console instead, run `npm run rules`, then paste `firestore.local.rules` into *Firestore Database > Rules* and click **Publish**.
5. **Enable Google sign-in.** Go to *Build > Authentication > Get started > Sign-in method > Google > Enable* and save.
6. **Authorize the dev domain.** In *Authentication > Settings > Authorized domains*, add `127.0.0.1` (the dev server's host). Add your real domain too once you deploy.
7. **Fill in `.env`.** Copy `.env.example` to `.env` and fill in the `VITE_FIREBASE_*` values and `VITE_ADMIN_EMAIL` (the host's Google account, also used for the rules in step 4). Do this before step 4.

## EmailJS setup

1. Sign up at https://www.emailjs.com (the free tier allows 200 emails a month).
2. Under **Email Services**, add a service (for example Gmail with the host's account) and copy its **Service ID**.
3. Under **Email Templates**, create one template and set these fields:
   - **Subject:** `{{subject}}`
   - **Content:** `{{message}}`
   - **To Email** (Settings tab): `{{to_email}}`
   - **Reply To:** `{{reply_to}}`

   Save it and copy the **Template ID**.
4. Under **Account > General**, copy your **Public Key**.
5. Put the three values in `.env` as `VITE_EMAILJS_SERVICE_ID`, `VITE_EMAILJS_TEMPLATE_ID` and `VITE_EMAILJS_PUBLIC_KEY`.
6. Recommended: in **Account > Security**, restrict the allowed origins to your site's domains.

Restart `npm run dev` after editing `.env`.

## Spam protection (Firebase App Check)

1. Go to https://www.google.com/recaptcha/admin/create, choose **reCAPTCHA v3**, and add your domains (`127.0.0.1`, `localhost` and your live domain).
2. In the Firebase console, open *Build > App Check > Apps*, choose your web app, register it with **reCAPTCHA**, and paste the **secret key**.
3. Put the **site key** in `.env` as `VITE_RECAPTCHA_SITE_KEY` and restart `npm run dev`.
4. For local dev, open the browser console and copy the "App Check debug token" it prints. Add it under *App Check > Apps > ⋮ > Manage debug tokens*. To keep the same token every time, also set it as `VITE_APPCHECK_DEBUG_TOKEN`.
5. Watch *App Check > APIs > Cloud Firestore* for a day or two. When the requests are mostly "verified", click **Enforce**. From then on, requests that don't come from your site are rejected.

## Busy times and Google Calendar sync

On admin > Settings > **Busy times**, you can block a time range manually or sync your Google Calendar. Times that overlap a busy block (plus your buffer) disappear from the booking page. Pending requests that clash with one are flagged on the admin page.

- **What is read:** only free/busy times from your primary Google Calendar. Event titles, guests and details are never requested or stored. Busy blocks are public, but they only hold a date and a time range.
- **When it syncs:** when you click **Sync now**, then every 15 minutes while the admin page stays open. Re-sync after adding meetings. Fully automatic syncing needs a server (Firebase's paid Blaze plan).
- **Limits:** like the buffer and daily limit, busy blocks are enforced by the booking page, not the rules. You still approve every request, and clashes are flagged.

One-time setup:

1. Enable the Google Calendar API for the project: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=bookly-8b49e and click **Enable**.
2. Check *Google Auth Platform > Audience* in the same console (https://console.cloud.google.com/auth/audience?project=bookly-8b49e).
   - **In production** (the usual Firebase default): leave it as is. Don't click "Back to testing". The first sync shows "Google hasn't verified this app"; click **Advanced > Go to … (unsafe)**. It's your own app asking for your own free/busy times, and the warning appears only once.
   - **Testing:** add your Google account under **Test users**. Calendar access then expires every 7 days, so moving the app to production is easier.
3. On admin > Settings, click **Sync now** and allow **"See your free/busy"**.

## Deploy

The site is hosted on Firebase Hosting (free). `firebase.json` and `.firebaserc` are already set up for the `bookly-8b49e` project.

1. Log in once: `npx firebase-tools login` (this opens a browser).
2. Deploy the site and the rules: `npm run deploy`. To publish only the rules, run `npm run deploy:rules`.
3. Your site is live at `https://bookly-8b49e.web.app`. The admin page is at `https://bookly-8b49e.web.app/#admin`.
4. Add `bookly-8b49e.web.app` to:
   - Firebase: *Authentication > Settings > Authorized domains* (it's usually there already)
   - EmailJS: *Account > Security* allowed origins (if you restricted them)
   - reCAPTCHA: the site's domains (if you use App Check)

`.env` values are built into the site at deploy time, so re-run `npm run deploy` after changing them.

## Data model

- `slots/{YYYY-MM-DD_HHMM}`: public. Only the date, time, booking ID, `confirmed` flag and server `createdAt`, used to show availability and work out when a hold expires.
- `bookings/{autoId}`: private (host only). Name, email, notes, `status` (`pending` | `confirmed` | `declined` | `cancelled`), `cancelledBy`, `meetingLink`, `manageId`, `createdAt`, `decidedAt`.
- `manage/{secret code}`: the visitor's view of their booking (date, time, name, email, status, meeting link). Readable only by someone who knows the 32-character code, which is sent only to the visitor. Listing is blocked.
- `config/availability`: public. Weekly hours, days off, buffer and daily limit.
- `config/calendarSync`: public. When Google Calendar was last synced and how many busy blocks it produced.
- `blocks/{autoId}`: public. Busy times: `date`, `start`, `end` (host time, 30-minute steps, `24:00` = midnight) and `source` (`manual` | `google`).
