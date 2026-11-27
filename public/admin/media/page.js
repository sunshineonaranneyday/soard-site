// /admin/media/: Photos & Videos on its own page (../media.js MediaPage)
import { h, render } from '../vendor.js';
import { MediaPage } from '../media.js';

const root = document.getElementById('app');
// (the page's own "loading" goes: Preact draws beside what's there, never over it)
root.textContent = '';
render(h(MediaPage), root);
