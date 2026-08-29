// Seedexchange — client-side interactivity
document.addEventListener('DOMContentLoaded', () => {
  // Mobile menu toggle
  const nav = document.querySelector('.nav');
  const menuBtn = document.createElement('button');
  menuBtn.className = 'nav-toggle';
  menuBtn.setAttribute('aria-label', 'Toggle menu');
  menuBtn.innerHTML = '&#9776;';

  const navLinks = document.querySelector('.nav-links');
  if (navLinks && window.innerWidth < 768) {
    nav.insertBefore(menuBtn, navLinks);
    menuBtn.addEventListener('click', () => {
      navLinks.classList.toggle('nav-links--open');
      menuBtn.setAttribute('aria-expanded',
        navLinks.classList.contains('nav-links--open'));
    });
  }
});
