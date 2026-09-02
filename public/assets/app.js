// Seedexchange client-side interactivity
document.addEventListener('DOMContentLoaded', () => {
  const menuButton = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('.nav-links');
  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
      const open = navigation.classList.toggle('nav-links--open');
      menuButton.setAttribute('aria-expanded', String(open));
    });
  }
});
