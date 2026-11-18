import { initScrollHero } from './scroll-hero.mjs?v=20261118-telemetry';

let dispose = null;
export function destroyPublicPage() { dispose?.(); dispose = null; }
export function initPublicPage(route) {
  destroyPublicPage();
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let destroyHero = null, resourceLayout = null;
  if (route === 'home') destroyHero = initScrollHero();
  if (route === 'resources') {
    const header = document.querySelector('.site-header');
    const index = document.querySelector('.resource-index');
    const buttons = [...index.querySelectorAll('[data-scroll-target]')];
    const sections = buttons.map(button => document.getElementById(button.dataset.scrollTarget));
    const updateIndex = () => {
      const headerHeight = header.getBoundingClientRect().height;
      const indexHeight = index.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--resource-header-height', `${headerHeight}px`);
      document.documentElement.style.setProperty('--resource-index-height', `${indexHeight}px`);
      let active = 0;
      sections.forEach((section, i) => {
        if (section.getBoundingClientRect().top <= headerHeight + indexHeight + 24) active = i;
      });
      buttons.forEach((button, i) => i === active ? button.setAttribute('aria-current', 'location') : button.removeAttribute('aria-current'));
    };
    resourceLayout = new ResizeObserver(updateIndex);
    resourceLayout.observe(header);
    resourceLayout.observe(index);
    window.addEventListener('scroll', updateIndex, {...options, passive:true});
    updateIndex();
    buttons.forEach(button => button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.scrollTarget);
      target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'start'});
      target?.focus({preventScroll:true});
    }, options));
    const track = document.getElementById('resourceGallery');
    document.querySelectorAll('[data-gallery-direction]').forEach(button => button.addEventListener('click', () => {
      track.scrollBy({left:Number(button.dataset.galleryDirection)*Math.max(280,track.clientWidth*.75),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }, options));
    const frame = document.getElementById('softwareArchitecture');
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'knight-software-height') return;
      const height = Number(event.data.height);
      if (Number.isFinite(height) && height >= 600 && height <= 1600) frame.style.height = `${Math.ceil(height)+2}px`;
    }, options);
  }
  if (route === 'contact') {
    const form = document.getElementById('contactForm');
    const status = document.getElementById('contactStatus');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = document.getElementById('contactSubmit');
      const fields = {name:'contactName',email:'contactEmail',message:'contactMessage'};
      for (const id of Object.values(fields)) { document.getElementById(`${id}Error`).textContent=''; document.getElementById(id).removeAttribute('aria-invalid'); }
      button.disabled=true;button.textContent='Sending…';status.textContent='';status.className='contact-status';
      try {
        const response = await fetch('/telemetry/contact', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form))),signal:controller.signal});
        const data = await response.json().catch(() => ({error:'The contact service is unavailable. Please try again later.'}));
        if (!response.ok) {
          let first = null;
          for (const [key,message] of Object.entries(data.fields || {})) {
            const id=fields[key];if (!id) continue;
            document.getElementById(`${id}Error`).textContent=message;
            document.getElementById(id).setAttribute('aria-invalid','true');first ||= id;
          }
          if (first) document.getElementById(first).focus();
          throw new Error(data.error || 'Your message could not be sent. Please try again.');
        }
        status.classList.add('success');status.textContent='Your message was accepted for delivery to the KnightEPS team.';form.reset();
      } catch (error) {
        if (error.name !== 'AbortError') status.textContent=error.message === 'Failed to fetch' ? 'Cannot reach the contact service. Check your connection and try again.' : error.message;
      } finally {button.disabled=false;button.textContent='Send message';}
    }, options);
  }
  dispose = () => {controller.abort(); resourceLayout?.disconnect(); document.documentElement.style.removeProperty('--resource-header-height'); document.documentElement.style.removeProperty('--resource-index-height');destroyHero?.();};
}
