/* Configuration Tailwind partagée par les pages compte/admin (même palette que index.html).
 * À charger APRÈS le script cdn.tailwindcss.com. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        parchment: '#fdfbf7',
        'parchment-dark': '#f4efe6',
        sepia: { 50: '#fbf9f5', 100: '#f5efdf', 200: '#e8dbbe', 700: '#685338', 800: '#4a3b32', 900: '#2d221c' },
        sage: { 100: '#eef2ed', 300: '#c5d3c1', 600: '#697d65', 800: '#3a4a37' },
        dustyrose: { 100: '#f8ecea', 300: '#ddb5ae', 600: '#b87368', 800: '#6b3d36' },
        softgold: '#d4af37'
      },
      fontFamily: {
        cinzel: ['Cinzel', 'serif'],
        lora: ['Lora', 'serif'],
        sans: ['Plus Jakarta Sans', 'sans-serif']
      }
    }
  }
};
