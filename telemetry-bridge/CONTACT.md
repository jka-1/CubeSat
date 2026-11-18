# Website contact form

The public website posts JSON to `/telemetry/contact`; the existing Apache telemetry proxy forwards it to Node's `/contact`. This route does not create sessions or grant dashboard access. No PHP is used.

Messages are addressed only to Jaden, William, Itzjac, and Liam at the four addresses supplied for this project. The visitor's validated address is used as Reply-To, never as the sender or an additional recipient. A success response means the SMTP provider accepted all four recipients; it does not guarantee inbox delivery.

Configure these values in the bridge's existing private environment when the team is ready to enable delivery:

```
CONTACT_ORIGIN=https://orbitaladdress.com
CONTACT_FROM=<verified sending email address>
CONTACT_SMTP_HOST=<SMTP provider host>
CONTACT_SMTP_PORT=587
CONTACT_SMTP_USER=<SMTP username>
CONTACT_SMTP_PASSWORD=<SMTP password or app password>
```

`CONTACT_ORIGIN` falls back to `AUTH_ORIGIN`. Port 587 requires STARTTLS; port 465 uses TLS immediately. Credentials and recipients are never sent to the browser. The route validates body sizes, names, email addresses, and message lengths, requires a matching Origin and JSON content type, and limits each direct peer to five attempts per fifteen minutes. Behind the current Apache proxy, this is a conservative shared limit for the proxy peer; untrusted forwarding headers are not used as identity.

Without a configured sender and SMTP host the form returns 503 with an honest unavailable state. Tests use an injected mail transport and never send messages. This overhaul does not change production configuration or deploy the site.

SMTP configuration follows [Nodemailer's transport documentation](https://nodemailer.com/smtp).
