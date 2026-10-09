/**
 * Photos for the public website, served from client/public/site. Paths are relative so
 * they work under any base path. Replace a file with one of the same name to change it;
 * room photos are set per room in Admin › Rooms.
 */
export const SITE_IMAGES = {
  hero: 'site/hero.jpg',
  story: 'site/story.jpg',
  about: 'site/about.jpg',
  communal: 'site/communal.jpg',
  gallery: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `site/gallery-${n}.jpg`),
  clients: [
    { src: 'site/client-happy-mondays.jpg', name: 'Happy Mondays' },
    { src: 'site/client-badly-drawn-boy.jpg', name: 'Badly Drawn Boy' },
    { src: 'site/client-airbourne.jpg', name: 'Airbourne' },
    { src: 'site/client-nm.jpg', name: 'Client logo' },
    { src: 'site/client-fs.jpg', name: 'Client logo' },
    { src: 'site/client-ab.jpg', name: 'Client logo' },
  ],
};
