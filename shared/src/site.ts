import { z } from 'zod';

/*
 * The studio's own website, as one JSON document: theme, header/footer and pages made of
 * blocks. The builder edits a draft; publishing copies it to the live site.
 *
 * Every block type is described once here (its settings and defaults). The builder's
 * settings panel, the server's validation and the defaults all come from these
 * descriptions, so adding a block type means adding it here and giving it a renderer.
 * There is no raw HTML anywhere: text is plain with a tiny safe markup (see client
 * lib/richtext), links and images are checked, so a site can't break or inject anything.
 */

// ---------------------------------------------------------------------------
// Field descriptions
// ---------------------------------------------------------------------------

export type SiteField =
  | { key: string; label: string; kind: 'text'; max?: number; placeholder?: string; hint?: string; default?: string }
  | { key: string; label: string; kind: 'textarea' | 'rich'; max?: number; placeholder?: string; hint?: string; default?: string }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[]; hint?: string; default: string }
  | { key: string; label: string; kind: 'toggle'; hint?: string; default?: boolean }
  | { key: string; label: string; kind: 'number'; min: number; max: number; step?: number; unit?: string; hint?: string; default: number }
  | { key: string; label: string; kind: 'image'; hint?: string; default?: SiteImage | null }
  | { key: string; label: string; kind: 'link'; hint?: string; default?: string }
  | { key: string; label: string; kind: 'color'; hint?: string; default?: string }
  | { key: string; label: string; kind: 'list'; itemLabel: string; max: number; fields: SiteField[]; hint?: string; default?: Record<string, unknown>[] };

export interface SiteImage {
  /** "asset:<id>" for an uploaded image, or a built-in "site/<file>" image. */
  src: string;
  alt: string;
}

// ---------------------------------------------------------------------------
// Values: links, images, colours
// ---------------------------------------------------------------------------

/** Internal path, #anchor, https URL, mailto: or tel:. Never javascript: or data:. */
export const siteLinkSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) =>
      v === '' ||
      /^\/[A-Za-z0-9\-._~/?=&%#]*$/.test(v) ||
      /^#[A-Za-z0-9\-_]+$/.test(v) ||
      /^https?:\/\/[^\s<>"']+$/i.test(v) ||
      /^mailto:[^\s<>"']+$/i.test(v) ||
      /^tel:[+0-9 ()-]+$/i.test(v),
    'Use a page (/about), a section (#contact), a web address (https://…), mailto: or tel:',
  );

export const siteImageSrcSchema = z
  .string()
  .regex(/^(asset:[a-z0-9]{10,40}|site\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif))$/, 'Choose an image from the library');

export const siteImageSchema = z.object({ src: siteImageSrcSchema, alt: z.string().trim().max(200).default('') });

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #1a2b3c');

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

const opt = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

const BUTTON_FIELDS: SiteField[] = [
  { key: 'label', label: 'Label', kind: 'text', max: 60, default: 'Book now' },
  { key: 'link', label: 'Link', kind: 'link', default: '/book' },
  { key: 'style', label: 'Style', kind: 'select', options: opt(['primary', 'Main'], ['secondary', 'Secondary'], ['link', 'Text link']), default: 'primary' },
];

const buttonsField = (def: Record<string, unknown>[] = [{ label: 'Book now', link: '/book', style: 'primary' }]): SiteField => ({
  key: 'buttons',
  label: 'Buttons',
  kind: 'list',
  itemLabel: 'button',
  max: 4,
  fields: BUTTON_FIELDS,
  default: def,
});

/** Line icons a feature card can show (drawn by the client; see client site/icons). */
export const FEATURE_ICONS = opt(
  ['', 'None'],
  ['music', 'Music'],
  ['mic', 'Microphone'],
  ['speaker', 'Speaker'],
  ['headphones', 'Headphones'],
  ['calendar', 'Calendar'],
  ['clock', 'Clock'],
  ['star', 'Star'],
  ['check', 'Tick'],
  ['users', 'People'],
  ['map', 'Location'],
  ['car', 'Parking'],
  ['coffee', 'Refreshments'],
  ['wifi', 'Wi-Fi'],
  ['shield', 'Secure'],
  ['bolt', 'Power'],
  ['heart', 'Heart'],
);

const headingField = (def = ''): SiteField => ({ key: 'heading', label: 'Heading', kind: 'text', max: 160, default: def });
const eyebrowField: SiteField = { key: 'eyebrow', label: 'Small text above heading', kind: 'text', max: 80, default: '' };
const introField: SiteField = { key: 'intro', label: 'Intro text', kind: 'rich', max: 2000, default: '' };

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const BLOCK_CATEGORIES = ['Basics', 'Media', 'Content', 'Live from your bookings'] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

export interface BlockDef {
  label: string;
  description: string;
  category: BlockCategory;
  fields: SiteField[];
  /** Default look for a new block of this type. */
  style?: Partial<BlockStyle>;
}

export const BLOCKS = {
  hero: {
    label: 'Hero banner',
    description: 'Big heading with a background photo and buttons',
    category: 'Basics',
    fields: [
      eyebrowField,
      { key: 'heading', label: 'Heading', kind: 'text', max: 160, default: 'Welcome' },
      { key: 'text', label: 'Text', kind: 'rich', max: 1000, default: '' },
      buttonsField([
        { label: 'Book now', link: '/book', style: 'primary' },
        { label: 'Our rooms', link: '/rooms', style: 'secondary' },
      ]),
      { key: 'height', label: 'Height', kind: 'select', options: opt(['s', 'Short'], ['m', 'Medium'], ['l', 'Tall'], ['full', 'Full screen']), default: 'l' },
      { key: 'showToday', label: "Show today's opening hours", kind: 'toggle', default: true },
    ],
    style: { background: 'image', overlay: 55, align: 'left', width: 'full' },
  },
  heading: {
    label: 'Heading',
    description: 'A title with optional text under it',
    category: 'Basics',
    fields: [
      eyebrowField,
      headingField('Section heading'),
      { key: 'size', label: 'Size', kind: 'select', options: opt(['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Huge']), default: 'l' },
      { key: 'text', label: 'Text under it', kind: 'rich', max: 1000, default: '' },
    ],
  },
  text: {
    label: 'Text',
    description: 'Paragraphs, lists and links',
    category: 'Basics',
    fields: [
      { key: 'text', label: 'Text', kind: 'rich', max: 8000, default: 'Write something about your studio here.' },
      { key: 'columns', label: 'Columns', kind: 'select', options: opt(['1', 'One'], ['2', 'Two']), default: '1' },
      { key: 'large', label: 'Larger text', kind: 'toggle', default: false },
    ],
    style: { width: 'narrow' },
  },
  buttons: {
    label: 'Buttons',
    description: 'One or more buttons in a row',
    category: 'Basics',
    fields: [buttonsField()],
  },
  spacer: {
    label: 'Space',
    description: 'Empty space between sections',
    category: 'Basics',
    fields: [{ key: 'size', label: 'Height', kind: 'number', min: 8, max: 240, step: 8, unit: 'px', default: 48 }],
    style: { padding: 'none' },
  },
  divider: {
    label: 'Divider',
    description: 'A thin line',
    category: 'Basics',
    fields: [],
    style: { padding: 's' },
  },
  image: {
    label: 'Image',
    description: 'A single photo with an optional caption',
    category: 'Media',
    fields: [
      { key: 'image', label: 'Image', kind: 'image', default: null },
      { key: 'caption', label: 'Caption', kind: 'text', max: 200, default: '' },
      { key: 'shape', label: 'Shape', kind: 'select', options: opt(['auto', 'Original'], ['wide', 'Wide (16:9)'], ['classic', 'Classic (4:3)'], ['square', 'Square']), default: 'auto' },
      { key: 'link', label: 'Link when clicked', kind: 'link', default: '' },
    ],
  },
  imageText: {
    label: 'Image + text',
    description: 'A photo beside a heading, text and buttons',
    category: 'Media',
    fields: [
      { key: 'image', label: 'Image', kind: 'image', default: null },
      { key: 'imageSide', label: 'Image side', kind: 'select', options: opt(['left', 'Left'], ['right', 'Right']), default: 'left' },
      eyebrowField,
      headingField('About us'),
      { key: 'text', label: 'Text', kind: 'rich', max: 4000, default: 'Tell visitors who you are.' },
      buttonsField([]),
    ],
  },
  gallery: {
    label: 'Gallery',
    description: 'A grid of photos',
    category: 'Media',
    fields: [
      headingField(''),
      {
        key: 'images',
        label: 'Photos',
        kind: 'list',
        itemLabel: 'photo',
        max: 48,
        fields: [
          { key: 'image', label: 'Image', kind: 'image', default: null },
          { key: 'caption', label: 'Caption', kind: 'text', max: 160, default: '' },
        ],
        default: [],
      },
      { key: 'columns', label: 'Columns', kind: 'number', min: 2, max: 5, default: 3 },
      { key: 'layout', label: 'Layout', kind: 'select', options: opt(['grid', 'Grid'], ['strip', 'Single row (scrolls)']), default: 'grid' },
    ],
  },
  video: {
    label: 'Video',
    description: 'A YouTube or Vimeo video',
    category: 'Media',
    fields: [
      headingField(''),
      { key: 'url', label: 'YouTube or Vimeo link', kind: 'text', max: 300, placeholder: 'https://www.youtube.com/watch?v=…', default: '' },
      { key: 'caption', label: 'Caption', kind: 'text', max: 200, default: '' },
    ],
  },
  logos: {
    label: 'Logos',
    description: 'Clients, partners or press',
    category: 'Media',
    fields: [
      headingField('Our clients'),
      {
        key: 'items',
        label: 'Logos',
        kind: 'list',
        itemLabel: 'logo',
        max: 24,
        fields: [
          { key: 'image', label: 'Logo', kind: 'image', default: null },
          { key: 'link', label: 'Link', kind: 'link', default: '' },
        ],
        default: [],
      },
      { key: 'grayscale', label: 'Show in grey', kind: 'toggle', default: true },
    ],
  },
  features: {
    label: 'Feature cards',
    description: 'Short points in columns: what you offer, why you',
    category: 'Content',
    fields: [
      eyebrowField,
      headingField('Why rehearse with us'),
      introField,
      {
        key: 'items',
        label: 'Cards',
        kind: 'list',
        itemLabel: 'card',
        max: 12,
        fields: [
          { key: 'icon', label: 'Icon', kind: 'select', options: FEATURE_ICONS, default: '' },
          { key: 'image', label: 'Image (optional)', kind: 'image', default: null },
          { key: 'title', label: 'Title', kind: 'text', max: 100, default: 'Feature' },
          { key: 'text', label: 'Text', kind: 'rich', max: 600, default: '' },
          { key: 'link', label: 'Link (optional)', kind: 'link', default: '' },
        ],
        default: [
          { icon: 'music', image: null, title: 'Fully equipped', text: 'Backline, PA and drums in every room.', link: '' },
          { icon: 'speaker', image: null, title: 'Great sound', text: 'Treated rooms so you can hear yourselves.', link: '' },
          { icon: 'clock', image: null, title: 'Open late', text: 'Book online any time, day or night.', link: '' },
        ],
      },
      { key: 'columns', label: 'Columns', kind: 'number', min: 1, max: 4, default: 3 },
      { key: 'cards', label: 'Show as cards', kind: 'toggle', default: true },
    ],
  },
  stats: {
    label: 'Numbers',
    description: 'Big numbers with labels (e.g. 3 rooms, 20 years)',
    category: 'Content',
    fields: [
      headingField(''),
      {
        key: 'items',
        label: 'Numbers',
        kind: 'list',
        itemLabel: 'number',
        max: 6,
        fields: [
          { key: 'value', label: 'Number', kind: 'text', max: 20, default: '10+' },
          { key: 'label', label: 'Label', kind: 'text', max: 60, default: 'Years open' },
        ],
        default: [
          { value: '3', label: 'Rehearsal rooms' },
          { value: '15+', label: 'Years in business' },
          { value: '1000s', label: 'Bands through our doors' },
        ],
      },
    ],
  },
  testimonials: {
    label: 'Testimonials',
    description: 'Quotes from happy customers',
    category: 'Content',
    fields: [
      headingField('What people say'),
      {
        key: 'items',
        label: 'Quotes',
        kind: 'list',
        itemLabel: 'quote',
        max: 12,
        fields: [
          { key: 'quote', label: 'Quote', kind: 'textarea', max: 600, default: 'Best rehearsal rooms in town.' },
          { key: 'author', label: 'Name', kind: 'text', max: 80, default: '' },
          { key: 'role', label: 'Band / role', kind: 'text', max: 80, default: '' },
        ],
        default: [{ quote: 'Best rehearsal rooms in town.', author: 'A happy band', role: '' }],
      },
    ],
  },
  faq: {
    label: 'Questions & answers',
    description: 'Expandable FAQ list',
    category: 'Content',
    fields: [
      headingField('Frequently asked questions'),
      {
        key: 'items',
        label: 'Questions',
        kind: 'list',
        itemLabel: 'question',
        max: 30,
        fields: [
          { key: 'q', label: 'Question', kind: 'text', max: 200, default: 'Question?' },
          { key: 'a', label: 'Answer', kind: 'rich', max: 2000, default: 'Answer.' },
        ],
        default: [
          { q: 'Do I need to bring my own gear?', a: 'Every room has a PA, drum kit and amps. Bring your guitars, sticks and cymbals.' },
          { q: 'How do I cancel?', a: 'Use the link in your confirmation email.' },
        ],
      },
    ],
    style: { width: 'narrow' },
  },
  cta: {
    label: 'Call to action',
    description: 'A bold banner with a button',
    category: 'Content',
    fields: [
      headingField('Ready to play?'),
      { key: 'text', label: 'Text', kind: 'rich', max: 600, default: '' },
      buttonsField([{ label: 'Book a room', link: '/book', style: 'primary' }]),
    ],
    style: { background: 'dark', align: 'center' },
  },
  rooms: {
    label: 'Rooms & prices',
    description: 'Your bookable rooms, always up to date',
    category: 'Live from your bookings',
    fields: [
      eyebrowField,
      headingField('Our rooms'),
      introField,
      { key: 'layout', label: 'Layout', kind: 'select', options: opt(['cards', 'Cards'], ['detailed', 'Detailed (with prices by time)']), default: 'cards' },
      { key: 'showPrices', label: 'Show prices', kind: 'toggle', default: true },
      { key: 'showBook', label: 'Show "Book" buttons', kind: 'toggle', default: true },
    ],
  },
  equipment: {
    label: 'Equipment hire',
    description: 'Hire items and prices from your booking system',
    category: 'Live from your bookings',
    fields: [headingField('Equipment hire'), introField],
  },
  hours: {
    label: 'Opening hours',
    description: 'Your opening hours, always up to date',
    category: 'Live from your bookings',
    fields: [headingField('Opening hours'), { key: 'highlightToday', label: 'Highlight today', kind: 'toggle', default: true }],
    style: { width: 'narrow' },
  },
  contact: {
    label: 'Contact details',
    description: 'Address, phone, email and directions',
    category: 'Live from your bookings',
    fields: [
      headingField('Find us'),
      introField,
      { key: 'showMap', label: 'Show a map', kind: 'toggle', default: true },
      { key: 'showHours', label: 'Show opening hours', kind: 'toggle', default: true },
    ],
  },
  map: {
    label: 'Map',
    description: 'A Google map of your address',
    category: 'Live from your bookings',
    fields: [
      { key: 'address', label: 'Address', kind: 'text', max: 300, hint: 'Leave blank to use your address from Settings', default: '' },
      { key: 'height', label: 'Height', kind: 'number', min: 200, max: 700, step: 50, unit: 'px', default: 380 },
    ],
    style: { width: 'wide' },
  },
} satisfies Record<string, BlockDef>;

export type BlockType = keyof typeof BLOCKS;
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

// ---------------------------------------------------------------------------
// Block style (the same options on every block)
// ---------------------------------------------------------------------------

export const blockStyleSchema = z.object({
  background: z.enum(['none', 'surface', 'dark', 'primary', 'accent', 'image', 'custom']).default('none'),
  backgroundColor: z.union([hexColorSchema, z.literal('')]).default(''),
  backgroundImage: siteImageSchema.nullable().default(null),
  /** Darkening over a background image, 0–90 %. */
  overlay: z.number().int().min(0).max(90).default(40),
  padding: z.enum(['none', 's', 'm', 'l', 'xl']).default('m'),
  width: z.enum(['narrow', 'normal', 'wide', 'full']).default('normal'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Anchor for links like #contact. */
  anchor: z.union([z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Lowercase letters, numbers and dashes'), z.literal('')]).default(''),
  hidden: z.boolean().default(false),
  hideOnMobile: z.boolean().default(false),
});
export type BlockStyle = z.output<typeof blockStyleSchema>;

export const STYLE_FIELDS: SiteField[] = [
  {
    key: 'background',
    label: 'Background',
    kind: 'select',
    options: opt(['none', 'None'], ['surface', 'Light panel'], ['dark', 'Dark'], ['primary', 'Main colour'], ['accent', 'Accent colour'], ['image', 'Photo'], ['custom', 'Custom colour']),
    default: 'none',
  },
  { key: 'backgroundColor', label: 'Custom colour', kind: 'color', default: '' },
  { key: 'backgroundImage', label: 'Background photo', kind: 'image', default: null },
  { key: 'overlay', label: 'Darken photo', kind: 'number', min: 0, max: 90, step: 5, unit: '%', default: 40 },
  { key: 'padding', label: 'Space above & below', kind: 'select', options: opt(['none', 'None'], ['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']), default: 'm' },
  { key: 'width', label: 'Content width', kind: 'select', options: opt(['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide'], ['full', 'Edge to edge']), default: 'normal' },
  { key: 'align', label: 'Text alignment', kind: 'select', options: opt(['left', 'Left'], ['center', 'Centre'], ['right', 'Right']), default: 'left' },
  { key: 'anchor', label: 'Section link name', kind: 'text', max: 40, hint: 'e.g. "contact" lets buttons link to #contact', default: '' },
  { key: 'hideOnMobile', label: 'Hide on phones', kind: 'toggle', default: false },
  { key: 'hidden', label: 'Hide this section', kind: 'toggle', default: false },
];

// ---------------------------------------------------------------------------
// Validation built from the field descriptions
// ---------------------------------------------------------------------------

function fieldSchema(f: SiteField): z.ZodType {
  switch (f.kind) {
    case 'text':
    case 'textarea':
    case 'rich':
      return z.string().max(f.max ?? 2000).default(f.default ?? '');
    case 'select':
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]]).default(f.default);
    case 'toggle':
      return z.boolean().default(f.default ?? false);
    case 'number':
      return z.number().min(f.min).max(f.max).default(f.default);
    case 'image':
      return siteImageSchema.nullable().default(null);
    case 'link':
      return siteLinkSchema.default(f.default ?? '');
    case 'color':
      return z.union([hexColorSchema, z.literal('')]).default(f.default ?? '');
    case 'list':
      return z.array(objectSchema(f.fields)).max(f.max).default([]);
  }
}

function objectSchema(fields: SiteField[]) {
  return z.object(Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)])));
}

const BLOCK_PROP_SCHEMAS = Object.fromEntries(BLOCK_TYPES.map((t) => [t, objectSchema(BLOCKS[t].fields)])) as unknown as Record<BlockType, z.ZodType>;

export const siteBlockSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/),
    type: z.enum(BLOCK_TYPES as [BlockType, ...BlockType[]]),
    props: z.record(z.string(), z.unknown()).default({}),
    style: blockStyleSchema.default(blockStyleSchema.parse({})),
  })
  .transform((b, ctx) => {
    const r = BLOCK_PROP_SCHEMAS[b.type].safeParse(b.props);
    if (!r.success) {
      for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: ['props', ...issue.path] } as never);
      return z.NEVER;
    }
    return { ...b, props: r.data as Record<string, unknown> };
  });
export type SiteBlock = { id: string; type: BlockType; props: Record<string, unknown>; style: BlockStyle };

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const SITE_FONTS = {
  archivo: { label: 'Archivo (bold, modern)', stack: "'Archivo', 'IBM Plex Sans', system-ui, sans-serif" },
  plex: { label: 'IBM Plex Sans (clean)', stack: "'IBM Plex Sans', system-ui, sans-serif" },
  inter: { label: 'Inter (neutral)', stack: "'Inter', system-ui, sans-serif" },
  poppins: { label: 'Poppins (friendly)', stack: "'Poppins', system-ui, sans-serif" },
  montserrat: { label: 'Montserrat (geometric)', stack: "'Montserrat', system-ui, sans-serif" },
  spacegrotesk: { label: 'Space Grotesk (techy)', stack: "'Space Grotesk', system-ui, sans-serif" },
  oswald: { label: 'Oswald (tall, condensed)', stack: "'Oswald', 'Archivo', sans-serif" },
  playfair: { label: 'Playfair Display (elegant serif)', stack: "'Playfair Display', Georgia, serif" },
  dmserif: { label: 'DM Serif Display (classic serif)', stack: "'DM Serif Display', Georgia, serif" },
  lora: { label: 'Lora (readable serif)', stack: "'Lora', Georgia, serif" },
  system: { label: 'System default', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
} as const;
export type SiteFont = keyof typeof SITE_FONTS;
const fontEnum = z.enum(Object.keys(SITE_FONTS) as [SiteFont, ...SiteFont[]]);

export const themeColorsSchema = z.object({
  primary: hexColorSchema,
  onPrimary: hexColorSchema,
  accent: hexColorSchema,
  background: hexColorSchema,
  surface: hexColorSchema,
  text: hexColorSchema,
  muted: hexColorSchema,
  border: hexColorSchema,
  dark: hexColorSchema,
  onDark: hexColorSchema,
  headerBg: hexColorSchema,
  headerText: hexColorSchema,
  footerBg: hexColorSchema,
  footerText: hexColorSchema,
});
export type ThemeColors = z.output<typeof themeColorsSchema>;

export const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  primary: 'Main colour (buttons, highlights)',
  onPrimary: 'Text on main colour',
  accent: 'Accent colour',
  background: 'Page background',
  surface: 'Panels & cards',
  text: 'Text',
  muted: 'Secondary text',
  border: 'Lines & borders',
  dark: 'Dark sections',
  onDark: 'Text on dark sections',
  headerBg: 'Header background',
  headerText: 'Header text',
  footerBg: 'Footer background',
  footerText: 'Footer text',
};

export const siteThemeSchema = z.object({
  colors: themeColorsSchema,
  headingFont: fontEnum,
  bodyFont: fontEnum,
  headingCase: z.enum(['normal', 'upper']).default('normal'),
  textSize: z.enum(['s', 'm', 'l']).default('m'),
  radius: z.enum(['none', 's', 'm', 'l']).default('s'),
  buttonShape: z.enum(['square', 'rounded', 'pill']).default('square'),
  buttonStyle: z.enum(['solid', 'outline']).default('solid'),
  maxWidth: z.enum(['narrow', 'normal', 'wide']).default('normal'),
});
export type SiteTheme = z.output<typeof siteThemeSchema>;

const BASE_THEME = { headingCase: 'normal', textSize: 'm', radius: 's', buttonShape: 'square', buttonStyle: 'solid', maxWidth: 'normal' } as const;

export const THEME_PRESETS: Record<string, { label: string; theme: SiteTheme }> = {
  mono: {
    label: 'Studio mono',
    theme: {
      ...BASE_THEME,
      headingFont: 'archivo',
      bodyFont: 'plex',
      headingCase: 'upper',
      radius: 'none',
      colors: { primary: '#111111', onPrimary: '#ffffff', accent: '#c8102e', background: '#f4f4f2', surface: '#ffffff', text: '#111111', muted: '#5c5c5c', border: '#dadada', dark: '#111111', onDark: '#f4f4f2', headerBg: '#111111', headerText: '#f4f4f2', footerBg: '#e9e5db', footerText: '#333333' },
    },
  },
  midnight: {
    label: 'Midnight',
    theme: {
      ...BASE_THEME,
      headingFont: 'spacegrotesk',
      bodyFont: 'inter',
      radius: 'm',
      buttonShape: 'rounded',
      colors: { primary: '#6d4aff', onPrimary: '#ffffff', accent: '#22d3ee', background: '#0f1117', surface: '#181b24', text: '#eef0f6', muted: '#a3a9ba', border: '#2a2f3d', dark: '#06070b', onDark: '#eef0f6', headerBg: '#0b0d13', headerText: '#eef0f6', footerBg: '#0b0d13', footerText: '#a3a9ba' },
    },
  },
  warm: {
    label: 'Warm vinyl',
    theme: {
      ...BASE_THEME,
      headingFont: 'dmserif',
      bodyFont: 'lora',
      radius: 's',
      colors: { primary: '#b5532a', onPrimary: '#ffffff', accent: '#e8b04b', background: '#fbf6ee', surface: '#ffffff', text: '#2a1d14', muted: '#6e5a4b', border: '#e6d9c7', dark: '#2a1d14', onDark: '#fbf6ee', headerBg: '#2a1d14', headerText: '#fbf6ee', footerBg: '#f1e6d6', footerText: '#4a3a2e' },
    },
  },
  ocean: {
    label: 'Ocean',
    theme: {
      ...BASE_THEME,
      headingFont: 'montserrat',
      bodyFont: 'inter',
      radius: 'm',
      buttonShape: 'pill',
      colors: { primary: '#0b6bcb', onPrimary: '#ffffff', accent: '#14b8a6', background: '#f5f9fc', surface: '#ffffff', text: '#0f2233', muted: '#52677a', border: '#d6e2ec', dark: '#0f2233', onDark: '#f5f9fc', headerBg: '#ffffff', headerText: '#0f2233', footerBg: '#0f2233', footerText: '#c9d6e2' },
    },
  },
  forest: {
    label: 'Forest',
    theme: {
      ...BASE_THEME,
      headingFont: 'poppins',
      bodyFont: 'poppins',
      radius: 'l',
      buttonShape: 'rounded',
      colors: { primary: '#2f6b3f', onPrimary: '#ffffff', accent: '#d9a441', background: '#f6f7f2', surface: '#ffffff', text: '#1d2a20', muted: '#5b6b5e', border: '#dfe5d8', dark: '#1d2a20', onDark: '#f6f7f2', headerBg: '#f6f7f2', headerText: '#1d2a20', footerBg: '#1d2a20', footerText: '#cfd8cc' },
    },
  },
  neon: {
    label: 'Neon stage',
    theme: {
      ...BASE_THEME,
      headingFont: 'oswald',
      bodyFont: 'inter',
      headingCase: 'upper',
      radius: 'none',
      buttonStyle: 'outline',
      colors: { primary: '#d61f69', onPrimary: '#ffffff', accent: '#ffe600', background: '#111111', surface: '#1b1b1b', text: '#f5f5f5', muted: '#b0b0b0', border: '#333333', dark: '#000000', onDark: '#f5f5f5', headerBg: '#000000', headerText: '#f5f5f5', footerBg: '#000000', footerText: '#b0b0b0' },
    },
  },
};

// ---------------------------------------------------------------------------
// Header, footer, pages, the whole site
// ---------------------------------------------------------------------------

const navLinkSchema = z.object({ label: z.string().trim().min(1).max(40), link: siteLinkSchema });
const httpsUrl = z.union([z.literal(''), z.string().trim().max(300).regex(/^https:\/\/[^\s<>"']+$/i, 'A web address starting https://')]);

export const siteHeaderSchema = z.object({
  logo: siteImageSchema.nullable().default(null),
  logoHeight: z.number().int().min(20).max(120).default(40),
  showName: z.boolean().default(true),
  layout: z.enum(['left', 'center']).default('left'),
  sticky: z.boolean().default(false),
  showBookButton: z.boolean().default(true),
  bookLabel: z.string().trim().min(1).max(30).default('Book now'),
  extraLinks: z.array(navLinkSchema).max(6).default([]),
  announcement: z.string().trim().max(200).default(''),
  announcementLink: siteLinkSchema.default(''),
});

export const siteFooterSchema = z.object({
  text: z.string().max(1000).default(''),
  showContact: z.boolean().default(true),
  showHours: z.boolean().default(true),
  showLinks: z.boolean().default(true),
  showSocial: z.boolean().default(true),
});

export const siteSocialSchema = z.object({
  instagram: httpsUrl.default(''),
  facebook: httpsUrl.default(''),
  tiktok: httpsUrl.default(''),
  youtube: httpsUrl.default(''),
  x: httpsUrl.default(''),
});

/** Paths the booking system itself uses; pages can't take them. */
export const RESERVED_SLUGS = ['admin', 'api', 'book', 'booking', 'setup', 'terms', 'refunds', 'privacy', 'health', 'assets', 'site', 'preview'];

export const sitePageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/),
  /** '' = the home page. */
  slug: z.union([z.literal(''), z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, 'Lowercase letters, numbers and dashes')]),
  title: z.string().trim().min(1, 'Required').max(80),
  navLabel: z.string().trim().max(40).default(''),
  showInNav: z.boolean().default(true),
  seoTitle: z.string().trim().max(80).default(''),
  seoDescription: z.string().trim().max(300).default(''),
  blocks: z.array(siteBlockSchema).max(80),
});
export type SitePage = Omit<z.output<typeof sitePageSchema>, 'blocks'> & { blocks: SiteBlock[] };

export const siteDocSchema = z
  .object({
    v: z.literal(1),
    theme: siteThemeSchema,
    header: siteHeaderSchema,
    footer: siteFooterSchema,
    social: siteSocialSchema,
    pages: z.array(sitePageSchema).min(1).max(30),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.pages.forEach((p, i) => {
      if (seen.has(p.slug)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'slug'], message: `Two pages use the address /${p.slug}` });
      seen.add(p.slug);
      if (RESERVED_SLUGS.includes(p.slug)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'slug'], message: `/${p.slug} is used by the booking system` });
    });
    if (!seen.has('')) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'The site needs a home page' });
  });
export type SiteDoc = Omit<z.output<typeof siteDocSchema>, 'pages'> & { pages: SitePage[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function newId(): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function defaultsFor(fields: SiteField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.key, structuredClone(f.default ?? (f.kind === 'toggle' ? false : f.kind === 'list' ? [] : f.kind === 'image' ? null : ''))]));
}

export const listItemDefaults = (field: Extract<SiteField, { kind: 'list' }>) => defaultsFor(field.fields);

export function newBlock(type: BlockType): SiteBlock {
  const def = BLOCKS[type] as BlockDef;
  return { id: newId(), type, props: defaultsFor(def.fields), style: { ...blockStyleSchema.parse({}), ...(def.style ?? {}) } };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Every image a document uses (to warn before deleting an image that is in use). */
export function imagesInDoc(doc: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.src === 'string' && 'alt' in o) out.add(o.src);
      Object.values(o).forEach(walk);
    }
  };
  walk(doc);
  return out;
}
