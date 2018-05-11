document.querySelectorAll('head')[0].insertAdjacentHTML(
  'afterbegin',
  `<meta http-equiv="Content-Security-Policy" content="default-src *; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plaudit.glitch.me/">`
);

const doi = document.querySelectorAll('meta[name="citation_doi"]')[0].getAttribute('content');
const articleTools = document.querySelectorAll('.pane-biorxiv-art-tools .pane-content')[0];

const widget = document.createElement('iframe');
widget.setAttribute('src', `https://plaudit.glitch.me/widget?doi=${doi}`);
widget.setAttribute('width', '50');
widget.setAttribute('height', '50');

articleTools.insertAdjacentElement('afterbegin', widget);