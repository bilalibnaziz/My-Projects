import urllib.request, json, os, re

url = 'https://raw.githubusercontent.com/jonathantneal/google-fonts-complete/master/google-fonts.json'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=15) as resp:
    raw = json.loads(resp.read().decode('utf-8'))

# Read existing 1,000 fonts from SkillVector
with open('/Users/Apple/Desktop/my projects /SkillVector/src/core/googleFonts.ts', 'r') as f:
    orig = f.read()

m = re.search(r'export const WORLD_BEST_FONTS: GoogleFontEntry\[\] = JSON\.parse\((\".*?\")\);', orig)
if m:
    existing = json.loads(json.loads(m.group(1)))
else:
    existing = []

TECH = set([
    'Orbitron', 'Audiowide', 'Exo', 'Exo 2', 'Rajdhani', 'Michroma', 'Oxanium', 'Chakra Petch',
    'Bruno Ace', 'Bruno Ace SC', 'Electrolize', 'Syne Tactile', 'Nova Square', 'Nova Mono',
    'Nova Flat', 'Nova Round', 'Share Tech', 'Share Tech Mono', 'Saira', 'Saira Stencil One',
    'Black Ops One', 'Russo One', 'Quantico', 'Jura', 'Geo', 'Allerta Stencil', 'Wallpoet',
    'Geostar', 'Geostar Fill', 'Major Mono Display', 'Silkscreen', 'Press Start 2P', 'VT323',
    'DotGothic16', 'Teko', 'Aldrich'
])

VINTAGE = set([
    'Abril Fatface', 'Shrikhand', 'Rye', 'Bungee Shade', 'Bungee Inline', 'Bungee Outline',
    'Monoton', 'Megrim', 'Sancreek', 'Creepster', 'Special Elite', 'Fredericka the Great',
    'Ultra', 'Vast Shadow', 'Smokum', 'Limelight', 'Eater', 'Fascinate', 'Fascinate Inline',
    'Nosifer', 'Trade Winds', 'Kranky', 'Fontdiner Swanky', 'Ribeye', 'Ribeye Marrow',
    'Asset', 'Faster One', 'Plaster', 'Bungee', 'Stint Ultra Expanded', 'Stint Ultra Condensed'
])

LUXURY = set([
    'Cormorant', 'Cormorant Garamond', 'Cormorant SC', 'Cormorant Infant', 'Cormorant Upright',
    'Italiana', 'Bodoni Moda', 'Cinzel', 'Cinzel Decorative', 'Playfair Display',
    'Playfair Display SC', 'Bellefair', 'Tenor Sans', 'Forum', 'Prata', 'Marcellus',
    'Marcellus SC', 'Julius Sans One', 'Federo', 'Castoro', 'Castoro Titling', 'Rozha One',
    'Elsie', 'Elsie Swash Caps', 'Yeseva One'
])

WORLD = set([
    'Amiri', 'Amiri Quran', 'Cairo', 'Cairo Play', 'Tajawal', 'Almarai', 'Readex Pro', 'Vazirmatn',
    'Noto Sans JP', 'Noto Serif JP', 'Zen Kaku Gothic New', 'Zen Maru Gothic', 'Zen Antique',
    'Shippori Mincho', 'Shippori Mincho B1', 'Shippori Antique', 'Noto Sans KR', 'Black Han Sans',
    'Do Hyeon', 'Jua', 'Sunflower', 'Song Myung', 'Noto Sans SC', 'Noto Serif SC', 'Noto Sans TC',
    'Noto Serif TC', 'Noto Sans HK', 'Ma Shan Zheng', 'Zhi Mang Xing', 'ZCOOL XiaoWei',
    'ZCOOL QingKe HuangYou', 'ZCOOL KuaiLe', 'Noto Sans Devanagari', 'Noto Serif Devanagari',
    'Rozha One', 'Kalam', 'Yatra One', 'Tiro Devanagari Hindi', 'Rubik', 'Heebo', 'Varela Round',
    'Assistant', 'Frank Ruhl Libre', 'Noto Sans Thai', 'Noto Serif Thai', 'Kanit', 'Prompt',
    'Mitr', 'Mali', 'Sriracha', 'Chakra Petch', 'Pridi', 'Taviraj', 'Pattaya', 'Krub',
    'KoHo', 'Fahkwang', 'Charm', 'Charmonman'
])

all_fonts = []
seen = set()

for i, item in enumerate(existing):
    fam = item['family']
    seen.add(fam)
    cat = item['category']
    if fam in TECH: cat = 'tech'
    elif fam in LUXURY: cat = 'luxury'
    elif fam in VINTAGE: cat = 'vintage'
    elif fam in WORLD: cat = 'world'
    all_fonts.append({'family': fam, 'category': cat, 'popularRank': i + 1})

cat_map = {
    'sans-serif': 'sans',
    'serif': 'serif',
    'display': 'display',
    'handwriting': 'script',
    'monospace': 'mono'
}

for fam, info in raw.items():
    if fam in seen: continue
    seen.add(fam)
    c = cat_map.get(info.get('category', ''), 'sans')
    if fam in TECH: c = 'tech'
    elif fam in LUXURY: c = 'luxury'
    elif fam in VINTAGE: c = 'vintage'
    elif fam in WORLD: c = 'world'
    all_fonts.append({'family': fam, 'category': c})

collections = [
    {
        "id": "classics",
        "name": "World's Top 50 Classics",
        "badge": "🏆",
        "description": "Timeless masterpieces of international design & typography history",
        "families": [
            "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway", "Nunito",
            "Playfair Display", "Merriweather", "Lora", "Oswald", "Bebas Neue", "PT Sans", "PT Serif",
            "EB Garamond", "Bodoni Moda", "Baskerville", "Georgia", "Times New Roman", "Garamond",
            "Futura", "Helvetica Neue", "Avenir", "Gill Sans", "JetBrains Mono", "Fira Code",
            "Source Code Pro", "Consolas", "Dancing Script", "Pacifico", "Great Vibes", "Caveat",
            "Anton", "Impact", "Bungee", "Righteous", "Cinzel", "Cormorant Garamond", "Orbitron",
            "Work Sans", "DM Sans", "Plus Jakarta Sans", "Outfit", "Syne", "Archivo Black",
            "Manrope", "Space Grotesk", "Urbanist", "Cabinet Grotesk"
        ]
    },
    {
        "id": "modern-ui",
        "name": "Modern UI & Tech",
        "badge": "⚡",
        "description": "Sleek, geometric and neo-grotesque typefaces tailored for digital apps & SaaS",
        "families": [
            "Inter", "Plus Jakarta Sans", "Outfit", "Manrope", "Space Grotesk", "DM Sans",
            "Urbanist", "Satoshi", "General Sans", "Lexend", "Syne", "Figtree", "Albert Sans",
            "Public Sans", "Cabinet Grotesk", "Geist", "Roboto", "Open Sans", "Montserrat",
            "Poppins", "Work Sans", "Quicksand", "Mulish", "Jost", "Cabin", "Nunito Sans",
            "Red Hat Display", "Overpass", "Karla", "Epilogue", "Archivo"
        ]
    },
    {
        "id": "luxury",
        "name": "Luxury & High Fashion",
        "badge": "🏛",
        "description": "Haute couture, Vogue editorial, refined serifs and high-contrast Didones",
        "families": [
            "Playfair Display", "Bodoni Moda", "Cormorant Garamond", "Cinzel", "Didot", "Italiana",
            "Bellefair", "Tenor Sans", "Forum", "Prata", "Marcellus", "Julius Sans One", "Federo",
            "Castoro", "Rozha One", "Cormorant", "Cinzel Decorative", "Elsie", "Yeseva One",
            "Newsreader", "Fraunces", "Spectral", "Domine", "Cormorant SC", "Marcellus SC"
        ]
    },
    {
        "id": "cinematic",
        "name": "Cinematic Titles & Posters",
        "badge": "🎬",
        "description": "Bold, impactful display faces made for Hollywood titles and YouTube thumbnails",
        "families": [
            "Bebas Neue", "Anton", "Oswald", "Archivo Black", "Impact", "Monument Extended",
            "Thunder", "Syne", "Black Han Sans", "Bungee", "Titan One", "Faster One",
            "Righteous", "Alfa Slab One", "Phosphate", "DIN Condensed", "Haettenschweiler",
            "Stencil", "Black Ops One", "Russo One", "Abril Fatface"
        ]
    },
    {
        "id": "signatures",
        "name": "Signatures & Calligraphy",
        "badge": "🖋",
        "description": "Elegant cursive, bespoke signatures, wedding stationery and artistic scripts",
        "families": [
            "Great Vibes", "Alex Brush", "Dancing Script", "Sacramento", "Allura", "Caveat",
            "Parisienne", "Tangerine", "Satisfy", "Rochester", "Damion", "Kaushan Script",
            "Marck Script", "Kalam", "Yellowtail", "Shadows Into Light", "Bad Script",
            "Snell Roundhand", "Brush Script MT", "Marker Felt", "Petit Formal Script"
        ]
    },
    {
        "id": "developer",
        "name": "Developer Code & Terminal",
        "badge": "💻",
        "description": "Precision monospaced fonts with ligature support for developers and IDEs",
        "families": [
            "JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro", "Roboto Mono",
            "IBM Plex Mono", "Space Mono", "Inconsolata", "Cascadia Mono", "Ubuntu Mono",
            "DM Mono", "Anonymous Pro", "Cousine", "Oxygen Mono", "Share Tech Mono",
            "Menlo", "Monaco", "Consolas", "Major Mono Display", "Nova Mono", "PT Mono"
        ]
    },
    {
        "id": "cyberpunk",
        "name": "Cyberpunk & Sci-Fi",
        "badge": "🚀",
        "description": "Futuristic HUDs, aerospace telemetry, synthwave and neon cyberpunk graphics",
        "families": [
            "Orbitron", "Audiowide", "Exo", "Exo 2", "Rajdhani", "Michroma", "Oxanium",
            "Chakra Petch", "Bruno Ace", "Bruno Ace SC", "Electrolize", "Syne Tactile",
            "Nova Square", "Share Tech", "Saira", "Black Ops One", "Russo One", "Quantico",
            "Jura", "Silkscreen", "Press Start 2P", "VT323", "DotGothic16", "Aldrich"
        ]
    },
    {
        "id": "vintage",
        "name": "Retro & Vintage Groovy",
        "badge": "📻",
        "description": "60s/70s funk, 80s arcade, slab serifs, rustic letterpress and vintage nostalgia",
        "families": [
            "Abril Fatface", "Shrikhand", "Rye", "Bungee Shade", "Monoton", "Megrim",
            "Sancreek", "Creepster", "Special Elite", "Fredericka the Great", "Ultra",
            "Vast Shadow", "Smokum", "Limelight", "Faster One", "Righteous", "Alfa Slab One",
            "Bungee Inline", "Fontdiner Swanky", "Ribeye", "Nosifer"
        ]
    },
    {
        "id": "world",
        "name": "Global & Multilingual",
        "badge": "🌍",
        "description": "World-class typography across Arabic, Japanese, Korean, Chinese, Devanagari, Hebrew & Thai",
        "families": [
            "Amiri", "Cairo", "Tajawal", "Almarai", "Readex Pro", "Vazirmatn", "Noto Sans JP",
            "Noto Serif JP", "Zen Kaku Gothic New", "Shippori Mincho", "Noto Sans KR",
            "Black Han Sans", "Do Hyeon", "Noto Sans SC", "Noto Serif SC", "Ma Shan Zheng",
            "Rozha One", "Kalam", "Rubik", "Heebo", "Kanit", "Prompt", "Mitr", "Yatra One"
        ]
    }
]

compact_json = json.dumps(json.dumps(all_fonts))

ts_content = f'''// Auto-generated Catalog of {len(all_fonts)}+ Free Google & World Best Fonts
// Categorized into Sans-Serif, Serif, Display, Script, Monospace, Tech, Vintage, Luxury, World

export type GoogleFontCategory =
  | 'sans'
  | 'serif'
  | 'display'
  | 'script'
  | 'mono'
  | 'tech'
  | 'vintage'
  | 'luxury'
  | 'world';

export interface GoogleFontEntry {{
  family: string;
  category: GoogleFontCategory;
  tags?: string[];
  popularRank?: number;
}}

export interface FontCollection {{
  id: string;
  name: string;
  badge: string;
  description: string;
  families: string[];
}}

export const PREBUILT_COLLECTIONS: FontCollection[] = {json.dumps(collections, indent=2)};

export const WORLD_BEST_FONTS: GoogleFontEntry[] = JSON.parse({compact_json});

/** Backward-compatible export */
export const TOP_1000_GOOGLE_FONTS = WORLD_BEST_FONTS;

const loadedFonts = new Set<string>();

const SYSTEM_FONTS = new Set([
  'Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'SF Pro Display', 'SF Pro Text', 'SF Mono',
  'Avenir', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Segoe UI', 'Calibri', 'Candara', 'Corbel', 'Franklin Gothic Medium',
  'Lucida Grande', 'Geneva', 'Georgia', 'Times New Roman', 'Times', 'Baskerville',
  'Didot', 'Bodoni 72', 'Garamond', 'Palatino', 'Palatino Linotype', 'Hoefler Text',
  'Big Caslon', 'Charter', 'Iowan Old Style', 'Cambria', 'Constantia', 'Book Antiqua',
  'Rockwell', 'Impact', 'Copperplate', 'Menlo', 'Monaco', 'Courier New', 'Courier',
  'Consolas', 'Lucida Console', 'Snell Roundhand', 'Brush Script MT', 'Marker Felt',
  'Noteworthy', 'Chalkboard SE', 'Bradley Hand', 'Apple Chancery', 'Zapfino'
]);

/**
 * Dynamically loads a Google Font into the browser document on demand.
 * Injects Google Fonts stylesheet link and invokes FontFace loading.
 */
export function loadGoogleFont(family: string): Promise<boolean> {{
  if (typeof document === 'undefined') return Promise.resolve(false);
  const cleanFamily = family.trim();
  if (loadedFonts.has(cleanFamily)) {{
    return Promise.resolve(true);
  }}

  if (SYSTEM_FONTS.has(cleanFamily)) {{
    loadedFonts.add(cleanFamily);
    return Promise.resolve(true);
  }}

  return new Promise((resolve) => {{
    try {{
      const linkId = 'gf-' + cleanFamily.toLowerCase().replace(/[^a-z0-9]/g, '-');
      if (document.getElementById(linkId)) {{
        loadedFonts.add(cleanFamily);
        resolve(true);
        return;
      }}

      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      const familyQuery = cleanFamily.replace(/ (Condensed|Expanded|Semi Condensed|Semi Bold|Extra Light|Thin|Medium|Black|Light)$/, '');
      const encoded = encodeURIComponent(familyQuery);
      link.href = `https://fonts.googleapis.com/css2?family=${{encoded}}:wght@400;600;700&display=swap`;

      link.onload = () => {{
        loadedFonts.add(cleanFamily);
        if (document.fonts) {{
          document.fonts.load(`16px "${{cleanFamily}}"`).then(() => resolve(true)).catch(() => resolve(true));
        }} else {{
          resolve(true);
        }}
      }};
      link.onerror = () => {{
        loadedFonts.add(cleanFamily);
        resolve(false);
      }};

      document.head.appendChild(link);
    }} catch {{
      resolve(false);
    }}
  }});
}}
'''

# Write to all 3 apps!
targets = [
    '/Users/Apple/Desktop/my projects /SkillVector/src/core/googleFonts.ts',
    '/Users/Apple/Desktop/my projects /SkillPhoto/src/core/googleFonts.ts',
    '/Users/Apple/Desktop/my projects /SkillMotion/src/fx/googleFonts.ts'
]

for t in targets:
    os.makedirs(os.path.dirname(t), exist_ok=True)
    with open(t, 'w') as f:
        f.write(ts_content)
    print(f'Wrote {len(all_fonts)} fonts to {t}')

