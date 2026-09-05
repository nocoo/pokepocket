const origin = 'https://pokemon.hexly.ai';
const paths = [
  '/',
  '/api/catalog',
  '/art/rayquaza.png',
  '/emulator/2.5.1/mgba.wasm',
  '/roms/pokeemerald.gba',
];

for (const path of paths) {
  let protectedPath = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await fetch(`${origin}${path}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      const location = response.headers.get('Location');
      const login = location ? new URL(location, origin) : null;
      protectedPath =
        [302, 303, 307].includes(response.status) &&
        login?.hostname === 'nocoo.cloudflareaccess.com' &&
        login.pathname.startsWith('/cdn-cgi/access/login/');
      await response.body?.cancel();
      console.log(`${path}: ${response.status}${protectedPath ? ' → Access sign-in' : ''}`);
      if (protectedPath) break;
    } catch (error) {
      console.error(`${path}: ${error.message}`);
    }
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!protectedPath) throw new Error(`Cloudflare Access did not protect ${path}`);
}
