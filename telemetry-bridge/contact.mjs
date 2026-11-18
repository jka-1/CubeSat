import nodemailer from 'nodemailer';

export const TEAM_RECIPIENTS = Object.freeze([
  'jaden.adkins@ucf.edu', 'wg@ucf.edu', 'it684690@ucf.edu', 'li053728@ucf.edu'
]);
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const fail = (statusCode, message, fields) => Object.assign(new Error(message), {statusCode, fields});

export function validateContact(body) {
  const fields = {};
  const name=typeof body?.name==='string'?body.name.trim():'';
  const email=typeof body?.email==='string'?body.email.trim():'';
  const message=typeof body?.message==='string'?body.message.trim():'';
  if (!name || name.length>100 || /[\r\n\x00-\x1f]/.test(name)) fields.name='Enter your name (up to 100 characters).';
  if (email.length>254 || !EMAIL.test(email) || /[\r\n]/.test(email)) fields.email='Enter a valid email address.';
  if (message.length<10 || message.length>5000 || message.includes('\0')) fields.message='Write a message between 10 and 5,000 characters.';
  if (body?.website) throw fail(400,'Unable to submit this message.');
  if (Object.keys(fields).length) throw fail(422,'Check the highlighted fields.',fields);
  return {name,email,message};
}

// Recipient and sender configuration is server-owned; form values cannot add recipients.
export class ContactService {
  constructor({env=process.env, transport, now=Date.now}={}) {
    this.now=now;this.attempts=new Map();this.origin=env.CONTACT_ORIGIN||env.AUTH_ORIGIN||'';
    this.from=env.CONTACT_FROM||'';
    this.transport=transport||null;
    if (!this.transport && env.CONTACT_SMTP_HOST && EMAIL.test(this.from)) {
      const port=Number(env.CONTACT_SMTP_PORT||587);
      if (!Number.isInteger(port)||port<1||port>65535) return;
      this.transport=nodemailer.createTransport({
        host:env.CONTACT_SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
        ...(env.CONTACT_SMTP_USER?{auth:{user:env.CONTACT_SMTP_USER,pass:env.CONTACT_SMTP_PASSWORD||''}}:{}),
        connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,
        disableFileAccess:true,disableUrlAccess:true
      });
    }
  }
  authorize(request) {
    // Browser submissions must come from this site, independently of sign-in state.
    let expected;
    try {expected=new URL(this.origin || `http://${request.headers.host}`).origin;}
    catch {throw fail(503,'Contact service configuration is incomplete.');}
    if (request.headers.origin!==expected) throw fail(403,'Submit the contact form from the KnightEPS website.');
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type']||'')) throw fail(415,'Send the contact form as JSON.');
    const key=request.socket.remoteAddress||'unknown',now=this.now();
    for(const [ip,record] of this.attempts)if(now-record.start>=900000)this.attempts.delete(ip);
    let record=this.attempts.get(key);
    if(!record){record={start:now,count:0};this.attempts.set(key,record);}
    if(record.count>=5)throw fail(429,'Too many messages. Please try again in 15 minutes.');
    record.count++;
  }
  async send(body) {
    const value=validateContact(body);
    if(!this.transport||!EMAIL.test(this.from))throw fail(503,'The contact service is not configured yet. Please try again later.');
    let result;
    try {
      result=await this.transport.sendMail({
        from:{name:'KnightEPS website',address:this.from},to:[...TEAM_RECIPIENTS],
        replyTo:{name:value.name,address:value.email},subject:'KnightEPS website enquiry',
        text:`From: ${value.name}\nEmail: ${value.email}\n\n${value.message}`,
        disableFileAccess:true,disableUrlAccess:true
      });
    } catch {throw fail(502,'Your message could not be sent. Please try again later.');}
    // A partial SMTP rejection is never reported as successful delivery to the whole team.
    const accepted=new Set((result?.accepted||[]).map(v=>String(v).toLowerCase()));
    if(TEAM_RECIPIENTS.some(v=>!accepted.has(v)))throw fail(502,'The mail service could not accept the message for the whole team. Please try again later.');
    return {accepted:true};
  }
}
