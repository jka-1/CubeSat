import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactService, TEAM_RECIPIENTS, validateContact } from '../contact.mjs';

const body={name:'Review visitor',email:'visitor@example.org',message:'Please share the project documentation.'};
const request=(headers={})=>({headers:{host:'orbitaladdress.com',origin:'https://orbitaladdress.com','content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}});
test('contact validates email, names, message limits, and rejects header injection',()=>{
  assert.deepEqual(validateContact(body),body);
  for(const patch of [{email:'invalid'},{email:'visitor@example.org\r\nBcc: attacker@example.org'},{name:'Name\nBcc: injected'},{message:'   '},{message:'a'.repeat(5001)},{website:'spam'}])assert.throws(()=>validateContact({...body,...patch}),error=>[400,422].includes(error.statusCode));
});
test('contact permits only same-origin JSON and rate limits attempts without trusting forwarded IPs',()=>{
  let time=0;const service=new ContactService({env:{CONTACT_ORIGIN:'https://orbitaladdress.com'},now:()=>time});
  assert.throws(()=>service.authorize(request({origin:'https://other.example'})),{statusCode:403});
  assert.throws(()=>service.authorize(request({'content-type':'text/plain'})),{statusCode:415});
  for(let i=0;i<5;i++)service.authorize(request({'x-forwarded-for':`198.51.100.${i}`}));
  assert.throws(()=>service.authorize(request()),{statusCode:429});
  time=900001;assert.doesNotThrow(()=>service.authorize(request()));
});
test('contact addresses exactly the four team members and uses visitor as Reply-To only',async()=>{
  const messages=[];
  const service=new ContactService({env:{CONTACT_FROM:'verified@example.org'},transport:{sendMail:async message=>{messages.push(message);return{accepted:[...TEAM_RECIPIENTS]};}}});
  const result=await service.send({...body,to:'untrusted@example.org',from:'forged@example.org',attachments:['/private/file']});
  assert.deepEqual(result,{accepted:true});assert.equal(messages.length,1);
  assert.deepEqual(messages[0].to,['jaden.adkins@ucf.edu','wg@ucf.edu','it684690@ucf.edu','li053728@ucf.edu']);
  assert.equal(messages[0].from.address,'verified@example.org');assert.equal(messages[0].replyTo.address,body.email);
  assert.equal(messages[0].attachments,undefined);assert.ok(messages[0].text.includes(body.message));
});
test('contact never reports success without SMTP configuration or after rejection',async()=>{
  await assert.rejects(new ContactService({env:{}}).send(body),{statusCode:503});
  for(const transport of [{sendMail:async()=>{throw Error('Secret provider credentials');}},{sendMail:async()=>({accepted:TEAM_RECIPIENTS.slice(0,2)})}]){
    const service=new ContactService({env:{CONTACT_FROM:'verified@example.org'},transport});
    await assert.rejects(service.send(body),error=>error.statusCode===502&&!error.message.includes('Secret'));
  }
});
